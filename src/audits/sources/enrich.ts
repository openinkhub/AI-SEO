import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { AuditTask } from '../audit-task.entity';
import { AuditEvidence } from '../evidence/audit-evidence.entity';
import { LIVE_SOURCES, SOURCE_LABEL, SourceKey, TASK_SOURCE } from './task-map';
import { crawlSite } from './site-crawl';
import { Research, ResearchInput, runCompetitorResearch, runFetchResearch, runGscResearch, runKeywordResearch, runLocalResearch } from './runners';
import { writeTasks } from './task-writer';
import { collectMetrics, metricsSummary } from '../evidence/metrics';

// Evidence rows that feed each source (the Mangools function cards are produced earlier in the run).
// Approved screenshots / exports uploaded by the admin feed the same tasks as the matching API data; a task fed by
// both sees both (each labelled by its evidence type) and reports each source's own numbers.
const FEEDS: Partial<Record<SourceKey, string[]>> = {
  site_ai: ['site_crawl', 'pagespeed_report', 'aitdk_meta', 'aitdk_technical', 'aitdk_density', 'aitdk_social', 'aitdk_structured_data', 'seoquake_audit', 'seoanalyzer_summary', 'seoanalyzer_tab', 'ppcblogpro_summary', 'ppcblogpro_report', 'digispot_dashboard', 'digispot_report', 'seomator_geo_audit'],
  keywords: ['research_keywords', 'aitdk_density', 'aitdk_serp'],
  competitors: ['research_competitors', 'mangools_sp_competitors', 'ahrefs_domain_rating', 'moz_authority', 'mangools_siteprofiler'],
  backlinks: ['moz_authority', 'ahrefs_domain_rating', 'mangools_sp_overview', 'mangools_sp_backlinks', 'mangools_sp_top_content', 'mangools_linkminer', 'mangools_siteprofiler', 'aitdk_backlinks', 'aitdk_traffic'],
  visibility: ['mangools_ai_watcher', 'frase_ai_visibility', 'aitdk_geo_section', 'seomator_geo_audit'],
  local: ['research_local'],
  pagespeed: ['pagespeed_report'],
  fetch: ['site_crawl', 'screenshots'],
  gsc: ['gsc_performance'],
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
// A hung upstream call (crawl, SerpApi, Mangools, the AI write-up) must never freeze the whole run: each step gets
// a hard time limit and is reported as failed ("timed out") so the rest of the run can finish.
const STEP_TIMEOUT_MS = Number(process.env.ENRICH_STEP_TIMEOUT_MS) || 4 * 60 * 1000;
function withTimeout<T>(p: Promise<T>, label: string, ms = STEP_TIMEOUT_MS): Promise<T> {
  let t: NodeJS.Timeout;
  const timer = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

export type EnrichProgress = (message: string) => Promise<void> | void;

export async function enrichRun(deps: EnrichDeps, customerId: string, runId: string, input: ResearchInput, site: string, onProgress?: EnrichProgress): Promise<string[]> {
  const notes: string[] = [];
  const progress = async (m: string) => {
    try {
      await onProgress?.(m);
    } catch {
      // progress is best-effort only
    }
  };
  const runners: Array<[SourceKey, () => Promise<Research[]>]> = [
    ['site_ai', async () => [{ type: 'site_crawl', tool: 'sitescan', label: 'Website crawl', data: (await crawlSite(site)) as unknown as Record<string, any> }]],
    ['keywords', () => runKeywordResearch(input)],
    ['competitors', () => runCompetitorResearch(input)],
    ['local', () => runLocalResearch(input)],
    ['fetch', () => runFetchResearch(input)],
    ['gsc', () => runGscResearch(input)],
  ];
  const failed = new Map<SourceKey, string>();
  let step = 0;
  for (const [key, run] of runners) {
    step += 1;
    await progress(`step ${step}/${runners.length + LIVE_SOURCES.length}: collecting ${SOURCE_LABEL[key]}`);
    try {
      for (const r of await withTimeout(run(), SOURCE_LABEL[key])) await saveResearch(deps, customerId, runId, r);
    } catch (e: any) {
      failed.set(key, String(e?.message ?? e).slice(0, 220));
      notes.push(`${SOURCE_LABEL[key]}: ${failed.get(key)}`);
    }
  }
  const evidence = await deps.evidenceRepo.find({ where: { customerId, auditRunId: runId } });
  const tasks = await deps.taskRepo.find({ where: { auditRunId: runId } });
  for (const src of LIVE_SOURCES) {
    const group = tasks.filter((t) => TASK_SOURCE[t.skillId] === src && !t.isAutomated);
    step += 1;
    if (!group.length) continue;
    await progress(`step ${step}/${runners.length + LIVE_SOURCES.length}: writing ${SOURCE_LABEL[src]} (${group.length} tasks)`);
    const isAi = src === 'ai';
    const rows = isAi
      ? evidence.filter((e) => e.status === 'approved' && e.extracted)
      : evidence.filter((e) => (FEEDS[src] ?? []).includes(e.evidenceType) && e.status === 'approved' && e.extracted);
    if (!rows.length) {
      const why = failed.get(src) ?? `${SOURCE_LABEL[src]} produced no data for this run (key not set, function switched off, or the call failed - see the research section).`;
      group.forEach((t) => {
        t.finding = `Not run: ${why}`;
      });
      await deps.taskRepo.save(group);
      continue;
    }
    let data: Record<string, any> = isAi
      ? {
          client: { company: input.companyName, website: site, industry: input.industry, about: (input.description ?? '').slice(0, 400), competitors: input.competitors.slice(0, 6) },
          evidence: Object.fromEntries(rows.map((r) => [r.evidenceType, JSON.stringify(r.extracted).slice(0, 1800)])),
          taskResults: tasks.filter((t) => t.isAutomated && t.finding && TASK_SOURCE[t.skillId] !== 'ai').slice(0, 45).map((t) => `${t.skill}: ${String(t.finding).slice(0, 180)}`),
        }
      : Object.fromEntries(rows.map((r) => [r.evidenceType, r.extracted]));
    // Authority / traffic / backlink numbers from every source side by side, so the write-up quotes each one by name.
    if (!isAi && (src === 'backlinks' || src === 'competitors')) {
      const cmp = metricsSummary(collectMetrics(rows));
      if (cmp.length) data = { metricComparison: cmp, ...data }; // first, so the size limit can never cut it
    }
    try {
      const written = await withTimeout(
        writeTasks(SOURCE_LABEL[src], data, group.map((t) => ({ id: t.id, skill: t.skillId, finds: t.finds, actionOutput: t.actionOutput })), site, isAi ? { maxChars: 16000, planning: true } : {}),
        `${SOURCE_LABEL[src]} write-up`,
        15 * 60 * 1000,
      );
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
