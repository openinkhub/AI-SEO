import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditRun, AuditRunStatus } from './audit-run.entity';
import { AuditTask, AuditTaskStatus } from './audit-task.entity';
import { LayerPush, LayerPushStatus } from './layer-push.entity';
import { CustomersService } from '../customers/customers.service';
import { getAllAuditSkills, AUTOMATED_SKILL_IDS } from './audit-skills.catalog';
import { analyzeWebsite, TechnicalAnalysis } from './technical-analyzer';
import { buildAutomatedFinding } from './findings-builder';
import { buildBrandedReportHtml } from './report-builder';
import { CreateAuditRunDto } from './dto/create-audit-run.dto';

@Injectable()
export class AuditsService {
  constructor(
    @InjectRepository(AuditRun) private readonly runRepo: Repository<AuditRun>,
    @InjectRepository(AuditTask) private readonly taskRepo: Repository<AuditTask>,
    @InjectRepository(LayerPush) private readonly pushRepo: Repository<LayerPush>,
    private readonly customersService: CustomersService,
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

    const skills = getAllAuditSkills();
    let run = this.runRepo.create({
      customerId,
      website,
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
    run.reportHtml = buildBrandedReportHtml(run, savedTasks, customer.companyName);
    run.reportGeneratedAt = run.completedAt;
    return this.runRepo.save(run);
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
