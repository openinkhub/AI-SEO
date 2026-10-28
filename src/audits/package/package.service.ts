import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditsService } from '../audits.service';
import { AuditTask } from '../audit-task.entity';
import { AuditRunStatus } from '../audit-run.entity';
import { AuditEvidence } from '../evidence/audit-evidence.entity';
import { TOOL_SECTIONS } from '../evidence/aitdk-rules';
import { CustomersService } from '../../customers/customers.service';
import { CustomerApisService } from '../../customer-apis/customer-apis.service';
import { API_PROVIDERS } from '../../customer-apis/api-catalog';
import { AuditPackage } from './audit-package.entity';
import { buildPackageHtml } from './package-builder';
import {
  generateStrategyWithAi,
  normalizeStrategy,
  ruleBasedStrategy,
  Strategy,
  StrategyInput,
  strategyAiConfigured,
} from './strategy-generator';

export interface Gate {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  items?: Array<{ label: string; ok: boolean; detail: string }>;
}

@Injectable()
export class PackageService {
  constructor(
    @InjectRepository(AuditPackage) private readonly repo: Repository<AuditPackage>,
    @InjectRepository(AuditTask) private readonly taskRepo: Repository<AuditTask>,
    @InjectRepository(AuditEvidence) private readonly evidenceRepo: Repository<AuditEvidence>,
    private readonly audits: AuditsService,
    private readonly customers: CustomersService,
    private readonly apis: CustomerApisService,
  ) {}

  private async row(customerId: string, runId: string): Promise<AuditPackage> {
    await this.audits.findOne(customerId, runId);
    const existing = await this.repo.findOne({ where: { auditRunId: runId } });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ customerId, auditRunId: runId, strategyStatus: 'none', signedOff: false }));
  }

  // The five gates that must all be green before the package can be compiled.
  async gates(customerId: string, runId: string, pkg?: AuditPackage): Promise<Gate[]> {
    const run = await this.audits.findOne(customerId, runId);
    const row = pkg ?? (await this.row(customerId, runId));

    const auditOk = run.status === AuditRunStatus.COMPLETED && !run.failureReason && !(run.enrichStatus === 'running' && Date.now() - new Date(run.updatedAt).getTime() < 20 * 60 * 1000);
    const audit: Gate = {
      key: 'audit',
      label: 'Internal SEO Audit completed',
      ok: auditOk,
      detail: auditOk
        ? `Completed${run.monthCode ? ` (${run.monthCode})` : ''}.`
        : run.enrichStatus === 'running' && Date.now() - new Date(run.updatedAt).getTime() < 20 * 60 * 1000
          ? 'Research is still being collected for this audit (keywords, competitors, local). Wait a few minutes, then refresh.'
          : run.failureReason
          ? `The run did not finish cleanly: ${run.failureReason}`
          : `Run status is "${run.status}".`,
    };

    let keys: Record<string, unknown> = {};
    try {
      keys = await this.apis.getKeys(customerId);
    } catch {
      keys = {};
    }
    const required = API_PROVIDERS.filter((p) => p.required);
    const apiItems = required.map((p) => ({ label: p.label, ok: !!keys[p.key], detail: keys[p.key] ? 'Configured' : 'Not configured (Profile > Account > API settings)' }));
    const apis: Gate = {
      key: 'apis',
      label: 'Customer APIs configured',
      ok: apiItems.every((i) => i.ok),
      detail: apiItems.every((i) => i.ok) ? 'All required APIs are configured.' : `Missing: ${apiItems.filter((i) => !i.ok).map((i) => i.label).join(', ')}`,
      items: apiItems,
    };

    const evidence = await this.evidenceRepo.find({ where: { customerId, auditRunId: runId } });
    const sections = TOOL_SECTIONS.filter((s) => s.key !== 'auto' && s.key !== 'other');
    const upItems = sections.map((s) => {
      // Mangools runs automatically (customer API), so its automatic cards also satisfy the Mangools section.
      const rows = evidence.filter((r) => r.section === s.key || (s.key === 'mangools' && r.section === 'auto' && r.tool === 'mangools'));
      const approved = rows.filter((r) => r.status === 'approved').length;
      const unread = rows.filter((r) => r.status === 'uploaded').length;
      const waiting = rows.filter((r) => r.status === 'extracted').length;
      const failed = rows.filter((r) => r.status === 'failed').length;
      const ok = approved >= 1 && unread === 0;
      let detail = `${approved} approved`;
      if (waiting) detail += `, ${waiting} waiting for approval`;
      if (unread) detail += `, ${unread} not read yet (press Complete)`;
      if (failed) detail += `, ${failed} failed`;
      if (!rows.length) detail = 'Nothing uploaded';
      else if (approved === 0) detail += ' - approve at least one';
      return { label: s.label, ok, detail };
    });
    const uploads: Gate = {
      key: 'uploads',
      label: 'Every tool section has uploads (read and approved)',
      ok: upItems.every((i) => i.ok),
      detail: upItems.every((i) => i.ok) ? 'All sections are ready.' : `${upItems.filter((i) => !i.ok).length} section(s) still need attention.`,
      items: upItems,
    };

    const strategy: Gate = {
      key: 'strategy',
      label: 'Strategy approved',
      ok: row.strategyStatus === 'approved',
      detail: row.strategyStatus === 'approved' ? 'Approved.' : row.strategyStatus === 'draft' ? 'Draft written - review and approve it.' : 'Not written yet - generate the draft.',
    };
    const signoff: Gate = {
      key: 'signoff',
      label: 'Admin sign-off',
      ok: row.signedOff,
      detail: row.signedOff ? `Signed off${row.signedOffAt ? ` on ${new Date(row.signedOffAt).toISOString().slice(0, 10)}` : ''}.` : 'Tick the sign-off once you have checked everything.',
    };
    return [audit, apis, uploads, strategy, signoff];
  }

  async state(customerId: string, runId: string) {
    const row = await this.row(customerId, runId);
    const gates = await this.gates(customerId, runId, row);
    return {
      runId,
      strategy: row.strategy,
      strategyStatus: row.strategyStatus,
      strategySource: row.strategySource,
      strategyNote: row.strategyNote,
      strategyApprovedAt: row.strategyApprovedAt,
      signedOff: row.signedOff,
      signedOffAt: row.signedOffAt,
      compiledAt: row.compiledAt,
      compiled: !!row.html,
      aiConfigured: strategyAiConfigured(),
      gates,
      canCompile: gates.every((g) => g.ok),
    };
  }

  private async buildInput(customerId: string, runId: string): Promise<StrategyInput> {
    const run = await this.audits.findOne(customerId, runId);
    const customer = await this.customers.findOne(customerId);
    const cycle = await this.audits.cycleForRun(run);
    const tasks = await this.taskRepo.find({ where: { auditRunId: runId } });
    const seen = new Set<string>();
    const findings = tasks
      .filter((t) => t.isAutomated && t.finding)
      .filter((t) => {
        const k = `${t.finding}|${t.suggestion ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((t) => ({ finding: t.finding as string, suggestion: t.suggestion ?? null }));
    const evidenceRows = await this.evidenceRepo.find({ where: { customerId, auditRunId: runId }, order: { createdAt: 'ASC' } });
    const evidence = evidenceRows
      .filter((r) => (r.status === 'approved' || r.status === 'extracted') && r.extracted)
      .map((r) => ({ tool: r.tool ?? r.section ?? 'tool', type: r.evidenceType ?? 'unknown', summary: JSON.stringify(r.extracted).slice(0, 1400) }));
    return {
      companyName: customer.companyName,
      website: run.website || customer.website || '',
      industry: customer.industry,
      description: customer.description,
      competitors: Array.isArray(customer.competitors) ? customer.competitors.join(', ') : null,
      monthCode: cycle.monthCode,
      monthIndex: cycle.monthIndex,
      findings,
      evidence,
    };
  }

  // Writes (or rewrites) the DRAFT strategy. Uses the model when ANTHROPIC_API_KEY is set, otherwise a
  // rules-based first draft. Either way it stays a draft until the admin approves it.
  async generateStrategy(customerId: string, runId: string) {
    const row = await this.row(customerId, runId);
    const input = await this.buildInput(customerId, runId);
    let strategy: Strategy;
    let source = 'ai';
    let note: string | null = null;
    if (strategyAiConfigured()) {
      try {
        strategy = await generateStrategyWithAi(input);
      } catch (err) {
        strategy = ruleBasedStrategy(input);
        source = 'rules';
        note = `AI draft failed (${err instanceof Error ? err.message : 'error'}); a rules-based draft was used instead.`.slice(0, 240);
      }
    } else {
      strategy = ruleBasedStrategy(input);
      source = 'rules';
      note = 'ANTHROPIC_API_KEY is not set, so this is a rules-based draft built from the audit findings.';
    }
    row.strategy = strategy as unknown as Record<string, any>;
    row.strategyStatus = 'draft';
    row.strategySource = source;
    row.strategyNote = note;
    row.strategyApprovedAt = null;
    await this.repo.save(row);
    return this.state(customerId, runId);
  }

  // Admin edits arrive as one JSON string (the hosting edge rejects bodies with many separate fields).
  async saveStrategy(customerId: string, runId: string, strategyJson: string) {
    const row = await this.row(customerId, runId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(strategyJson);
    } catch {
      throw new BadRequestException('The strategy is not valid JSON.');
    }
    const s = normalizeStrategy(parsed);
    if (!s.executiveSummary) throw new BadRequestException('The strategy needs an executive summary.');
    if (s.priorities.length === 0) throw new BadRequestException('The strategy needs at least one priority.');
    row.strategy = s as unknown as Record<string, any>;
    row.strategyStatus = 'draft'; // any edit needs approving again
    row.strategyApprovedAt = null;
    if (!row.strategySource) row.strategySource = 'manual';
    await this.repo.save(row);
    return this.state(customerId, runId);
  }

  async setStrategyApproved(customerId: string, runId: string, approved: boolean) {
    const row = await this.row(customerId, runId);
    if (!row.strategy) throw new BadRequestException('Generate the strategy draft first.');
    row.strategyStatus = approved ? 'approved' : 'draft';
    row.strategyApprovedAt = approved ? new Date() : null;
    await this.repo.save(row);
    return this.state(customerId, runId);
  }

  async setSignedOff(customerId: string, runId: string, signedOff: boolean) {
    const row = await this.row(customerId, runId);
    row.signedOff = signedOff;
    row.signedOffAt = signedOff ? new Date() : null;
    await this.repo.save(row);
    return this.state(customerId, runId);
  }

  private async render(customerId: string, runId: string, strategy: Strategy, preview: boolean, signedAt: Date = new Date()): Promise<string> {
    const run = await this.audits.findOne(customerId, runId);
    const customer = await this.customers.findOne(customerId);
    const cycle = await this.audits.cycleForRun(run);
    const tasks = await this.taskRepo.find({ where: { auditRunId: runId } });
    const evidence = await this.evidenceRepo.find({ where: { customerId, auditRunId: runId }, order: { createdAt: 'ASC' } });
    return buildPackageHtml({
      customerName: customer.companyName,
      website: run.website || customer.website || '',
      monthCode: cycle.monthCode,
      monthIndex: cycle.monthIndex,
      run,
      tasks,
      evidence,
      pages: await this.audits.reportPages(customerId),
      aiKeywords: await this.audits.reportAiKeywords(customerId),
      strategy,
      preview,
      signedAt,
    });
  }

  async compile(customerId: string, runId: string) {
    const row = await this.row(customerId, runId);
    const gates = await this.gates(customerId, runId, row);
    const bad = gates.filter((g) => !g.ok);
    if (bad.length) throw new BadRequestException(`Cannot compile yet: ${bad.map((g) => `${g.label} (${g.detail})`).join(' | ')}`.slice(0, 900));
    const now = new Date();
    row.html = await this.render(customerId, runId, normalizeStrategy(row.strategy), false, now);
    row.compiledAt = now;
    await this.repo.save(row);
    return this.state(customerId, runId);
  }

  // What the customer will get: the compiled document if there is one, else a live preview.
  async previewHtml(customerId: string, runId: string): Promise<string> {
    const row = await this.row(customerId, runId);
    if (row.html) return row.html;
    const strategy = row.strategy ? normalizeStrategy(row.strategy) : ruleBasedStrategy(await this.buildInput(customerId, runId));
    return this.render(customerId, runId, strategy, true);
  }
}
