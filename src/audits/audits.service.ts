import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditRun, AuditRunStatus } from './audit-run.entity';
import { AuditTask, AuditTaskStatus } from './audit-task.entity';
import { LayerPush, LayerPushStatus } from './layer-push.entity';
import { CustomersService } from '../customers/customers.service';
import { getAllAuditSkills, AUTOMATED_SKILL_IDS } from './audit-skills.catalog';
import { analyzeWebsite, TechnicalAnalysis } from './technical-analyzer';
import { buildAutomatedFinding } from './findings-builder';
import { buildBrandedReportHtml, buildCustomerReportHtml } from './report-builder';
import { CreateAuditRunDto } from './dto/create-audit-run.dto';
import { AuditEvidence } from './evidence/audit-evidence.entity';
import { CustomerApisService } from '../customer-apis/customer-apis.service';
import { runMangools } from '../customer-apis/mangools/run';
import { runPageSpeed } from '../customer-apis/pagespeed';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { AuditPackage } from './package/audit-package.entity';
import { pendingCustomerPageHtml } from './package/package-builder';
import { createHash } from 'crypto';

// YYYY-MM-DD from a DATE column value (string, or Date on some drivers).
const ymd = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
};
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));

// The SEO Audit runs once per month cycle, from Day 3 of the cycle (Day 1 = monthStartDate).
// A run that failed or could not scan the site does not use up the cycle, so it can be retried.
export interface AuditRuleStatus {
  enforced: boolean;
  today: string;
  projectId: string | null;
  monthCode: string | null;
  monthIndex: number | null;
  monthStart: string | null;
  monthEnd: string | null;
  unlockDate: string | null;
  unlocked: boolean;
  runExists: boolean;
  existingRunId: string | null;
  canRun: boolean;
  reason: string;
}

@Injectable()
export class AuditsService {
  constructor(
    @InjectRepository(AuditRun) private readonly runRepo: Repository<AuditRun>,
    @InjectRepository(AuditTask) private readonly taskRepo: Repository<AuditTask>,
    @InjectRepository(LayerPush) private readonly pushRepo: Repository<LayerPush>,
    @InjectRepository(AuditEvidence) private readonly evidenceRepo: Repository<AuditEvidence>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AuditPackage) private readonly packageRepo: Repository<AuditPackage>,
    private readonly customersService: CustomersService,
    private readonly apis: CustomerApisService,
  ) {}

  // Layer 69 — "complete website audit with all SEO Matrix 140 skills":
  // snapshots the full catalog into AuditTask rows, runs the one live
  // technical scan the Engine can do today, fills in real findings for the
  // skills in AUTOMATED_SKILL_IDS and honest "pending data source"
  // placeholders for the rest, generates the branded report, and computes
  // (but does not yet deliver — see LayerPush) every layer-wise push.
  async createRun(customerId: string, dto: CreateAuditRunDto): Promise<AuditRun> {
    const customer = await this.customersService.findOne(customerId);
    const website = dto.website ?? customer.website ?? '';
    const rule = await this.ruleStatus(customerId);
    if (!rule.canRun) throw new ForbiddenException(rule.reason);

    const skills = getAllAuditSkills();
    let run = this.runRepo.create({
      customerId,
      website,
      projectId: rule.projectId,
      monthCode: rule.monthCode,
      status: AuditRunStatus.RUNNING,
      totalSkills: skills.length,
      startedAt: new Date(),
    });
    run = await this.runRepo.save(run);

    let analysis: TechnicalAnalysis | null = null;
    let failureReason: string | null = null;
    if (website) {
      try {
        analysis = await analyzeWebsite(website);
      } catch (err) {
        failureReason = err instanceof Error ? err.message : 'Unknown error during site scan';
      }
    } else {
      failureReason = 'No website on file for this customer — automated checks skipped.';
    }

    const tasks: AuditTask[] = [];
    for (const def of skills) {
      const isAutomated = AUTOMATED_SKILL_IDS.has(def.id);
      let finding: string | null = null;
      let suggestion: string | null = null;

      if (isAutomated && analysis) {
        const result = buildAutomatedFinding(def.id, analysis);
        finding = result.finding;
        suggestion = result.suggestion;
      } else if (!isAutomated) {
        finding = `Automated check not yet wired for this skill — requires ${describeDataSource(def.plugin)} integration. Task is scaffolded and ready to run once that integration exists.`;
      } else {
        finding = failureReason ?? 'Site scan unavailable.';
      }

      const task = this.taskRepo.create({
        auditRunId: run.id,
        skillId: def.id,
        group: def.group,
        plugin: def.plugin,
        skill: def.skill,
        finds: def.finds,
        actionOutput: def.actionOutput,
        resultNature: def.resultNature,
        implementationType: def.implementationType,
        actionType: def.actionType,
        layerMappingRaw: def.layerMappingRaw,
        layerNumbers: def.layerNumbers,
        isAutomated,
        status: AuditTaskStatus.COMPLETED,
        finding,
        suggestion,
        startedAt: run.startedAt,
        completedAt: new Date(),
      });
      tasks.push(task);
    }
    const savedTasks = await this.taskRepo.save(tasks);
    const autoEvidence = await this.runCustomerApis(customerId, run.id, website);

    // Only tasks with a REAL (automated) finding get pushed to their
    // mapped layer(s) — pushing every scaffolded "not yet wired" placeholder
    // would just flood each layer's findings feed with noise. One LayerPush
    // row per (task x layer), since a single skill can map to several
    // layers (e.g. Layers 26/27/29/69).
    const pushable = savedTasks.filter((t) => t.isAutomated && t.layerNumbers.length > 0);
    const pushes: LayerPush[] = [];
    for (const task of pushable) {
      for (const layerNumber of task.layerNumbers) {
        pushes.push(
          this.pushRepo.create({
            auditTaskId: task.id,
            auditRunId: run.id,
            customerId,
            layerNumber,
            finding: task.finding ?? '',
            suggestion: task.suggestion,
            status: LayerPushStatus.PENDING_INTEGRATION,
            responseNote:
              'WP↔Engine push endpoint not yet wired (Admin panel still on the WP plugin side) — recorded and queryable here, delivery pending.',
          }),
        );
      }
    }
    const savedPushes = pushes.length > 0 ? await this.pushRepo.save(pushes) : [];

    run.status = AuditRunStatus.COMPLETED;
    run.completedSkills = savedTasks.length;
    run.automatedSkills = savedTasks.filter((t) => t.isAutomated).length;
    run.pendingLayerPushes = savedPushes.length;
    run.failureReason = failureReason;
    run.completedAt = new Date();
    run.reportHtml = buildBrandedReportHtml(run, savedTasks, customer.companyName, autoEvidence);
    run.customerReportHtml = buildCustomerReportHtml(run, savedTasks, customer.companyName, autoEvidence);
    run.reportGeneratedAt = run.completedAt;
    return this.runRepo.save(run);
  }

  async ruleStatus(customerId: string): Promise<AuditRuleStatus> {
    await this.customersService.findOne(customerId);
    const enforced = process.env.AUDIT_ENFORCE_CYCLE_RULE !== 'off';
    const today = todayInTz();
    const projects = await this.projectRepo.find({ where: { customerId } });
    const cur = projects.find((p) => {
      const a = ymd(p.monthStartDate);
      const b = ymd(p.monthEndDate);
      return !!a && !!b && a <= today && today <= b;
    });
    const base = { enforced, today, projectId: null, monthCode: null, monthIndex: null, monthStart: null, monthEnd: null, unlockDate: null, unlocked: false, runExists: false, existingRunId: null as string | null };
    if (!cur) {
      return {
        ...base,
        canRun: !enforced,
        reason: projects.length
          ? 'Today is not inside any of this customer’s month cycles, so the SEO Audit cannot run.'
          : 'This customer has no month cycles yet. Create the month cycles first; the SEO Audit runs once per cycle.',
      };
    }
    const monthStart = ymd(cur.monthStartDate) as string;
    const monthEnd = ymd(cur.monthEndDate) as string;
    const unlockDate = addDays(monthStart, 2);
    const unlocked = today >= unlockDate;
    const runs = await this.runRepo.find({ where: { customerId }, order: { createdAt: 'DESC' } });
    const used = runs.find((r) => {
      if (r.status === AuditRunStatus.FAILED || r.failureReason) return false;
      if (r.projectId) return r.projectId === cur.id;
      const d = dateInTz(r.createdAt);
      return d >= monthStart && d <= monthEnd;
    });
    let reason = `${cur.monthCode}: the SEO Audit can run now (once per cycle).`;
    if (used) reason = `The SEO Audit for ${cur.monthCode} has already been run. It runs once per month cycle; the next one unlocks on Day 3 of the next cycle.`;
    else if (!unlocked) reason = `The SEO Audit for ${cur.monthCode} unlocks on ${unlockDate} (Day 3 of the cycle).`;
    return {
      enforced,
      today,
      projectId: cur.id,
      monthCode: cur.monthCode,
      monthIndex: cur.monthIndex,
      monthStart,
      monthEnd,
      unlockDate,
      unlocked,
      runExists: !!used,
      existingRunId: used?.id ?? null,
      canRun: !enforced || (unlocked && !used),
      reason: enforced ? reason : `${reason} (cycle rule is switched off on the server)`,
    };
  }

  // Which month cycle a run belongs to (runs made before the rule are matched by date).
  async cycleForRun(run: AuditRun): Promise<{ monthCode: string | null; monthIndex: number | null }> {
    const projects = await this.projectRepo.find({ where: { customerId: run.customerId } });
    const d = dateInTz(run.createdAt);
    const p =
      projects.find((x) => run.projectId && x.id === run.projectId) ??
      projects.find((x) => {
        const a = ymd(x.monthStartDate);
        const b = ymd(x.monthEndDate);
        return !!a && !!b && a <= d && d <= b;
      });
    return { monthCode: p?.monthCode ?? run.monthCode ?? null, monthIndex: p ? p.monthIndex : null };
  }

  // Uses the customer's own API settings (Layer 2 > API settings in the admin panel). Today only
  // PageSpeed is wired; the result is stored as pre-approved evidence so it flows through the same
  // report rendering as uploaded tool data. A failure is recorded, never thrown - the audit still runs.
  private async runCustomerApis(customerId: string, runId: string, website: string): Promise<AuditEvidence[]> {
    const out: AuditEvidence[] = [];
    if (!website) return out;
    let keys: Record<string, Record<string, string>> = {};
    try {
      keys = await this.apis.getKeys(customerId);
    } catch {
      return out;
    }
    if (keys.pagespeed) {
      const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
      const row = this.evidenceRepo.create({
        customerId,
        auditRunId: runId,
        kind: 'text',
        section: 'auto',
        tool: 'pagespeed',
        evidenceType: 'pagespeed_report',
        fileName: 'Google PageSpeed (automatic)',
        sha256: createHash('sha256').update(`pagespeed:${runId}`).digest('hex'),
        includeInReport: true,
        status: 'approved',
      });
      try {
        row.extracted = (await runPageSpeed(url, keys.pagespeed.apiKey)) as unknown as Record<string, any>;
      } catch (err) {
        row.status = 'failed';
        row.error = `PageSpeed: ${err instanceof Error ? err.message : 'failed'}`.slice(0, 250);
      }
      out.push(await this.evidenceRepo.save(row));
    }
    if (keys.mangools?.apiKey) {
      // Each Mangools function is its own evidence card with its own limit (customer API settings).
      for (const r of await runMangools(keys.mangools, website)) {
        const row = this.evidenceRepo.create({
          customerId,
          auditRunId: runId,
          kind: 'text',
          section: 'auto',
          tool: 'mangools',
          evidenceType: r.def.evidenceType,
          fileName: `Mangools - ${r.def.label} (automatic)`,
          sha256: createHash('sha256').update(`mangools:${r.def.key}:${runId}`).digest('hex'),
          includeInReport: true,
          status: r.ok ? 'approved' : 'failed',
        });
        if (r.ok) row.extracted = r.data as Record<string, any>;
        else row.error = (r.error ?? 'failed').slice(0, 250);
        out.push(await this.evidenceRepo.save(row));
      }
    }
    return out;
  }

  findAllForCustomer(customerId: string): Promise<AuditRun[]> {
    return this.runRepo.find({ where: { customerId }, order: { createdAt: 'DESC' } });
  }

  async findOne(customerId: string, runId: string): Promise<AuditRun> {
    const run = await this.runRepo.findOne({ where: { id: runId, customerId } });
    if (!run) throw new NotFoundException(`Audit run ${runId} not found`);
    return run;
  }

  async listTasks(customerId: string, runId: string): Promise<AuditTask[]> {
    await this.findOne(customerId, runId);
    return this.taskRepo.find({ where: { auditRunId: runId }, order: { group: 'ASC', skill: 'ASC' } });
  }

  async getReportHtml(customerId: string, runId: string): Promise<string> {
    const run = await this.findOne(customerId, runId);
    if (!run.reportHtml) throw new NotFoundException('Report not generated yet for this run');
    return run.reportHtml;
  }

  // Customer-facing report = the compiled package (SEO Report + Strategy + Deliverables + T&C).
  // Until the admin compiles it the customer only sees a "being prepared" page.
  async getCustomerReportHtml(customerId: string, runId: string): Promise<string> {
    await this.findOne(customerId, runId);
    const pkg = await this.packageRepo.findOne({ where: { auditRunId: runId } });
    if (pkg?.html) return pkg.html;
    const customer = await this.customersService.findOne(customerId);
    return pendingCustomerPageHtml(customer.companyName);
  }

  // Rebuilds both reports (admin + customer) from the run's tasks and its current tool evidence.
  async rebuildReports(customerId: string, runId: string): Promise<void> {
    const run = await this.findOne(customerId, runId);
    const customer = await this.customersService.findOne(customerId);
    const tasks = await this.taskRepo.find({ where: { auditRunId: runId } });
    const evidence = await this.evidenceRepo.find({ where: { auditRunId: runId }, order: { createdAt: 'ASC' } });
    run.reportHtml = buildBrandedReportHtml(run, tasks, customer.companyName, evidence);
    run.customerReportHtml = buildCustomerReportHtml(run, tasks, customer.companyName, evidence);
    await this.runRepo.save(run);
  }

  async listPushes(customerId: string, runId: string): Promise<LayerPush[]> {
    await this.findOne(customerId, runId);
    return this.pushRepo.find({ where: { auditRunId: runId }, order: { layerNumber: 'ASC' } });
  }
}

// Best-effort human label for which external tool a non-automated skill's
// real execution depends on — shown in the task's placeholder finding so
// it reads as a roadmap item, not a dead end.
function describeDataSource(plugin: string): string {
  const map: Record<string, string> = {
    'seo-skills': 'SE Ranking',
    ubersuggest: 'Ubersuggest',
    harborrank: 'HarborRank',
    'seo-gsc-wizard': 'Google Search Console / GA4',
    mangools: 'Mangools',
    'brightdata-plugin': 'Bright Data',
    serpapi: 'SerpApi',
    search1api: 'Search1API',
    'aeo-brand-scan': 'an AI-search monitoring',
    'content-intelligence': 'Content Intelligence (Adology)',
  };
  return map[plugin] ?? `the ${plugin} tool's`;
}
