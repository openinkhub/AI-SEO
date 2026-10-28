import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { AuditTask } from '../audit-task.entity';
import { AuditEvidence } from '../evidence/audit-evidence.entity';
import { LIVE_SOURCES, SOURCE_LABEL, SourceKey, TASK_SOURCE } from './task-map';
import { Research, ResearchInput, runCompetitorResearch, runKeywordResearch, runLocalResearch } from './runners';
import { writeTasks } from './task-writer';

// Evidence rows that feed each source (the Mangools function cards are produced earlier in the run).
const FEEDS: Partial<Record<SourceKey, string[]>> = {
  keywords: ['research_keywords'],
  competitors: ['research_competitors', 'mangools_sp_competitors', 'ahrefs_domain_rating', 'moz_authority'],
  backlinks: ['moz_authority', 'ahrefs_domain_rating', 'mangools_sp_overview', 'mangools_sp_backlinks', 'mangools_sp_top_content', 'mangools_linkminer'],
  visibility: ['mangools_ai_watcher'],
  local: ['research_local'],
};

export interface EnrichDeps {
  taskRepo: Repository<AuditTask>;
  evidenceRepo: Repository<AuditEvidence>;
}

async function saveResearch(deps: EnrichDeps, customerId: string, runId: string, r: Research): Promise<void> {
  const sha = createHash('sha256').update(`${r.type}:${runId}`).digest('hex');
  await deps.evidenceRepo.delete({ auditRunId: runId, sha256: sha });
  await deps.evidenceRepo.save(
    deps.evidenceRepo.create({
      customerId, auditRunId: runId, kind: 'text', section: 'auto', tool: r.tool, evidenceType: r.type,
      fileName: `${r.label} (automatic)`, sha256: sha, includeInReport: true, status: 'approved', extracted: r.data,
    }),
  );
}

// Collects the live research sources for this run, then writes each task's finding from its own source.
// Returns a short note listing what could not be done.
export async function enrichRun(deps: EnrichDeps, customerId: string, runId: string, input: ResearchInput, site: string): Promise<string[]> {
  const notes: string[] = [];
  const runners: Array<[SourceKey, () => Promise<Research[]>]> = [
    ['keywords', () => runKeywordResearch(input)],
    ['competitors', () => runCompetitorResearch(input)],
    ['local', () => runLocalResearch(input)],
  ];
  const failed = new Map<SourceKey, string>();
  for (const [key, run] of runners) {
    try {
      for (const r of await run()) await saveResearch(deps, customerId, runId, r);
    } catch (e: any) {
      failed.set(key, String(e?.message ?? e).slice(0, 220));
      notes.push(`${SOURCE_LABEL[key]}: ${failed.get(key)}`);
    }
  }
  const evidence = await deps.evidenceRepo.find({ where: { customerId, auditRunId: runId } });
  const tasks = await deps.taskRepo.find({ where: { auditRunId: runId } });
  for (const src of LIVE_SOURCES) {
    const group = tasks.filter((t) => TASK_SOURCE[t.skillId] === src && !t.isAutomated);
    if (!group.length) continue;
    const rows = evidence.filter((e) => (FEEDS[src] ?? []).includes(e.evidenceType) && e.status === 'approved' && e.extracted);
    if (!rows.length) {
      const why = failed.get(src) ?? `${SOURCE_LABEL[src]} produced no data for this run (key not set, function switched off, or the call failed - see the research section).`;
      group.forEach((t) => {
        t.finding = `Not run: ${why}`;
      });
      await deps.taskRepo.save(group);
      continue;
    }
    const data = Object.fromEntries(rows.map((r) => [r.evidenceType, r.extracted]));
    try {
      const written = await writeTasks(SOURCE_LABEL[src], data, group.map((t) => ({ id: t.id, skill: t.skillId, finds: t.finds, actionOutput: t.actionOutput })), site);
      for (const t of group) {
        const w = written.get(t.id);
        if (w) {
          t.finding = w.finding;
          t.suggestion = w.suggestion;
          t.isAutomated = true;
        } else t.finding = `Research data was collected (${SOURCE_LABEL[src]}) but the task write-up did not finish. Run the enrichment again.`;
      }
    } catch (e: any) {
      notes.push(`${SOURCE_LABEL[src]} write-up: ${String(e?.message ?? e).slice(0, 160)}`);
      group.forEach((t) => {
        t.finding = `Research data was collected (${SOURCE_LABEL[src]}) but the write-up failed: ${String(e?.message ?? e).slice(0, 120)}`;
      });
    }
    await deps.taskRepo.save(group);
  }
  return notes;
}
