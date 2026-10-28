import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { enrichRun } from './sources/enrich';
import { SOURCE_API, SOURCE_LABEL, TASK_SOURCE, taskState } from './sources/task-map';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { mozAuthority } from '../customer-apis/moz';
import { ahrefsDomainRating } from '../customer-apis/ahrefs';
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
export class AuditsService implements OnModuleInit {
  private readonly log = new Logger(AuditsService.name);

  // Research runs inside this process (fire-and-forget). A deploy/restart kills it silently, which used to leave the
  // run showing "collecting…" forever. On boot nothing can still be running, so any 'running' row is marked interrupted.
  async onModuleInit(): Promise<void> {
    try {
      const stuck = await this.runRepo.find({ where: { enrichStatus: 'running' } });
      for (const r of stuck) {
        r.enrichStatus = 'interrupted';
        r.enrichNote = 'The server restarted while research was running (last step: ' + (r.enrichNote || 'n/a') + '). Press Run research to continue.';
      }
      if (stuck.length) {
        await this.runRepo.save(stuck);
        this.log.warn(`Marked ${stuck.length} research run(s) as interrupted after restart`);
      }
    } catch (e) {
      this.log.error(`Could not recover stuck research runs: ${e instanceof Error ? e.message : e}`);
    }
  }

  constructor(
    @InjectRepository(AuditRun) private readonly runRepo: Repository<AuditRun>,
    @InjectRepository(AuditTask) private readonly taskRepo: Repository<AuditTask>,
    @InjectRepository(LayerPush) private readonly pushRepo: Repository<LayerPush>,
    @InjectRepository(AuditEvidence) private readonly evidenceRepo: Repository<AuditEvidence>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AuditPackage) private readonly packageRepo: Repository<AuditPackage>,
    private readonly customersService: CustomersService,
    private readonly apis: CustomerApisService,
    private readonly globals: GlobalApisService,
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
        const srcKey = TASK_SOURCE[def.id];
        finding = srcKey === 'na'
          ? 'Not an SEO audit task (advisory, setup or non-SEO tool) - nothing to measure.'
          : `Pending: this task is fed by ${srcKey ? SOURCE_LABEL[srcKey] : describeDataSource(def.plugin)}, which has not run for this audit yet.`;
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
        dataSource: TASK_SOURCE[def.id] ? SOURCE_LABEL[isAutomated ? 'site' : TASK_SOURCE[def.id]] : null,
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
    run.enrichStatus = failureReason ? null : 'running';
    const saved = await this.runRepo.save(run);
    if (saved.enrichStatus === 'running') void this.enrich(customerId, saved.id);
    return saved;
  }

  // Keyword / competitor / local research + per-task write-ups. Runs in the background after the audit is saved
  // (many sequential calls), and can be run again for an existing run (the audit itself is once per cycle).
  async startEnrich(customerId: string, runId: string): Promise<AuditRun> {
    const run = await this.findOne(customerId, runId);
    run.enrichStatus = 'running';
    run.enrichNote = this.stamp('starting');
    const saved = await this.runRepo.save(run);
    void this.enrich(customerId, runId);
    return saved;
  }

  // "14:05 · message" so the dashboard shows when the last step started.
  private stamp(message: string): string {
    const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());
    return `${t} · ${message}`;
  }

  private async enrich(customerId: string, runId: string): Promise<void> {
    let status = 'done';
    let note: string | null = null;
    try {
      const run = await this.findOne(customerId, runId);
      const customer = await this.customersService.findOne(customerId);
      let keys: Record<string, Record<string, string>> = {};
      try {
        keys = await this.apis.getKeys(customerId);
      } catch {
        keys = {};
      }
      const site = run.website || customer.website || '';
      const domain = site.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '');
      // Moz DA / Ahrefs DR / PageSpeed / Mangools are only collected when a tool has none yet for this run — so keys
      // added after the audit was created are picked up here, without repeating paid calls that already succeeded.
      const skipped: string[] = [];
      try {
        const apiTools = ['pagespeed', 'mangools', 'moz', 'ahrefs'];
        const existing = await this.evidenceRepo.find({ where: { auditRunId: runId, section: 'auto', tool: In(apiTools) } });
        const have = new Set(existing.filter((e) => e.status === 'approved').map((e) => e.tool));
        const failedRows = existing.filter((e) => !have.has(e.tool));
        if (failedRows.length) await this.evidenceRepo.remove(failedRows);
        await this.runRepo.update({ id: runId }, { enrichNote: this.stamp('collecting Moz DA / Ahrefs DR / PageSpeed / Mangools').slice(0, 300) });
        await this.runCustomerApis(customerId, runId, site, skipped, have);
      } catch (e) {
        skipped.push(`API refresh failed: ${e instanceof Error ? e.message : 'error'}`.slice(0, 200));
      }
      const notes = await enrichRun(
        { taskRepo: this.taskRepo, evidenceRepo: this.evidenceRepo },
        customerId,
        runId,
        {
          domain,
          companyName: customer.companyName,
          industry: customer.industry,
          description: customer.description,
          competitors: Array.isArray(customer.competitors) ? customer.competitors : [],
          profile: (customer.profile ?? {}) as Record<string, any>,
          mangools: keys.mangools,
          serpApiKey: keys.serpapi?.apiKey,
        },
        site,
        async (message) => {
          await this.runRepo.update({ id: runId }, { enrichNote: this.stamp(message).slice(0, 300) });
        },
      );
      const all = [...skipped, ...notes];
      note = all.length ? all.join(' | ').slice(0, 900) : null;
    } catch (err) {
      status = 'failed';
      note = (err instanceof Error ? err.message : 'Enrichment failed').slice(0, 400);
    }
    try {
      const run = await this.findOne(customerId, runId);
      run.enrichStatus = status;
      run.enrichNote = note;
      await this.runRepo.save(run);
      await this.rebuildReports(customerId, runId);
    } catch {
      // the run may have been removed; nothing to update
    }
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
  // `have` = tools that already produced approved evidence for this run (skipped, so paid calls are not repeated);
  // `skipped` collects the reason a tool produced nothing (key not set, switched off) so it can be shown to the admin.
  private async runCustomerApis(customerId: string, runId: string, website: string, skipped: string[] = [], have: Set<string> = new Set()): Promise<AuditEvidence[]> {
    const out: AuditEvidence[] = [];
    if (!website) return out;
    let keys: Record<string, Record<string, string>> = {};
    try {
      keys = await this.apis.getKeys(customerId);
    } catch {
      keys = {};
    }
    if (!keys.pagespeed && !have.has('pagespeed')) skipped.push('PageSpeed: no API key set for this customer');
    if (keys.pagespeed && !have.has('pagespeed')) {
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
    if (!keys.mangools?.apiKey && !have.has('mangools')) skipped.push('Mangools: no API key set for this customer');
    if (keys.mangools?.apiKey && !have.has('mangools')) {
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
    let globalKeys: Record<string, Record<string, string>> = {};
    try {
      globalKeys = await this.globals.getKeys();
    } catch {
      globalKeys = {};
    }
    const moz = globalKeys.moz;
    if (!have.has('moz')) {
      if (!moz || !(moz.apiToken || (moz.accessId && moz.secretKey))) skipped.push('Moz DA: no Moz key in the global API settings');
      else if ((moz.mzAuthority ?? '').trim() === '0') skipped.push('Moz DA: switched off in the global API settings');
    }
    if (!have.has('moz') && moz && (moz.apiToken || (moz.accessId && moz.secretKey)) && (moz.mzAuthority ?? '').trim() !== '0') {
      const row = this.evidenceRepo.create({
        customerId,
        auditRunId: runId,
        kind: 'text',
        section: 'auto',
        tool: 'moz',
        evidenceType: 'moz_authority',
        fileName: 'Moz Domain Authority (automatic)',
        sha256: createHash('sha256').update(`moz:da:${runId}`).digest('hex'),
        includeInReport: true,
        status: 'approved',
      });
      try {
        const customer = await this.customersService.findOne(customerId);
        const rawMax = (moz.mzCompetitors ?? '').trim();
        const max = rawMax === '' ? 5 : Math.min(Math.max(parseInt(rawMax, 10) || 0, 0), 20);
        const comps = Array.isArray(customer.competitors) ? customer.competitors.slice(0, max) : [];
        row.extracted = (await mozAuthority({ apiToken: moz.apiToken, accessId: moz.accessId, secretKey: moz.secretKey }, website, comps)) as unknown as Record<string, any>;
      } catch (err) {
        row.status = 'failed';
        row.error = `Moz: ${err instanceof Error ? err.message : 'failed'}`.slice(0, 250);
      }
      out.push(await this.evidenceRepo.save(row));
    }
    if (!have.has('ahrefs')) {
      if (!keys.ahrefs?.apiKey) skipped.push('Ahrefs DR: no Ahrefs key set for this customer');
      else if ((keys.ahrefs.ahDomainRating ?? '').trim() === '0') skipped.push('Ahrefs DR: switched off in this customer\'s API settings');
    }
    if (!have.has('ahrefs') && keys.ahrefs?.apiKey && (keys.ahrefs.ahDomainRating ?? '').trim() !== '0') {
      const row = this.evidenceRepo.create({
        customerId,
        auditRunId: runId,
        kind: 'text',
        section: 'auto',
        tool: 'ahrefs',
        evidenceType: 'ahrefs_domain_rating',
        fileName: 'Ahrefs Domain Rating (automatic)',
        sha256: createHash('sha256').update(`ahrefs:dr:${runId}`).digest('hex'),
        includeInReport: true,
        status: 'approved',
      });
      try {
        const customer = await this.customersService.findOne(customerId);
        const rawMax = (keys.ahrefs.ahDrCompetitors ?? '').trim();
        const max = rawMax === '' ? 5 : Math.min(Math.max(parseInt(rawMax, 10) || 0, 0), 20);
        const comps = Array.isArray(customer.competitors) ? customer.competitors.slice(0, max) : [];
        row.extracted = (await ahrefsDomainRating(keys.ahrefs.apiKey, website, comps)) as unknown as Record<string, any>;
      } catch (err) {
        row.status = 'failed';
        row.error = `Ahrefs: ${err instanceof Error ? err.message : 'failed'}`.slice(0, 250);
      }
      out.push(await this.evidenceRepo.save(row));
    }
    return out;
  }

  async findAllForCustomer(customerId: string): Promise<AuditRun[]> {
    const runs = await this.runRepo.find({ where: { customerId }, order: { createdAt: 'DESC' } });
    // A 'running' research that has not reported a step for 20 minutes is treated as stalled (every step has its own
    // time limit, so a healthy run always moves on well before this).
    const limit = Number(process.env.ENRICH_STALL_MINUTES) || 20;
    for (const r of runs) {
      if (r.enrichStatus === 'running' && Date.now() - new Date(r.updatedAt).getTime() > limit * 60000) {
        r.enrichStatus = 'stalled';
        r.enrichNote = `No progress for ${limit}+ minutes (last: ${r.enrichNote || 'n/a'}). Press Run research to start again.`;
        await this.runRepo.save(r);
      }
    }
    // Real progress per run (the stored completedSkills is always 140 because every row is saved at audit start).
    if (runs.length) {
      const tasks = await this.taskRepo.find({ where: { auditRunId: In(runs.map((r) => r.id)) }, select: ['id', 'auditRunId', 'skillId', 'isAutomated', 'finding'] });
      for (const r of runs) {
        const p = { done: 0, waiting: 0, blocked: 0, notBuilt: 0, notApplicable: 0, total: 0 };
        for (const t of tasks.filter((x) => x.auditRunId === r.id)) {
          p.total += 1;
          const s = taskState(t);
          if (s === 'done') p.done += 1;
          else if (s === 'waiting') p.waiting += 1;
          else if (s === 'blocked') p.blocked += 1;
          else if (s === 'not_built') p.notBuilt += 1;
          else p.notApplicable += 1;
        }
        (r as any).progress = p;
      }
    }
    return runs;
  }

  async findOne(customerId: string, runId: string): Promise<AuditRun> {
    const run = await this.runRepo.findOne({ where: { id: runId, customerId } });
    if (!run) throw new NotFoundException(`Audit run ${runId} not found`);
    return run;
  }

  // Each task with its research source, the API/key behind it and an honest state (done / waiting / blocked / not built / n/a).
  async listTasks(customerId: string, runId: string): Promise<any[]> {
    await this.findOne(customerId, runId);
    const tasks = await this.taskRepo.find({ where: { auditRunId: runId }, order: { group: 'ASC', skill: 'ASC' } });
    return tasks.map((t) => {
      const src = TASK_SOURCE[t.skillId] ?? 'na';
      return { ...t, source: src, sourceLabel: SOURCE_LABEL[src], api: SOURCE_API[src].api, apiKey: SOURCE_API[src].key, apiWired: SOURCE_API[src].wired, state: taskState(t) };
    });
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
