import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { AuditTask } from '../audit-task.entity';
import { AuditEvidence } from '../evidence/audit-evidence.entity';
import { LIVE_SOURCES, SOURCE_LABEL, SourceKey, TASK_SOURCE } from './task-map';
import { crawlSite } from './site-crawl';
import { Research, ResearchInput, runCompetitorResearch, runFetchResearch, runGscResearch, runKeywordResearch, runLocalResearch } from './runners';
import { writeTasks } from './task-writer';
import { auditLocationPages } from './location-pages';
import { PARAM_BY_ID } from './page-params';
import { buildPromptSet } from '../package/ai-roadmap';
import { collectMetrics, metricsSummary } from '../evidence/metrics';

// Evidence rows that feed each source (the Mangools function cards are produced earlier in the run).
// Approved screenshots / exports uploaded by the admin feed the same tasks as the matching API data; a task fed by
// both sees both (each labelled by its evidence type) and reports each source's own numbers.
const FEEDS: Partial<Record<SourceKey, string[]>> = {
  site_ai: ['site_crawl', 'site_root_audit', 'pagespeed_report', 'aitdk_meta', 'aitdk_technical', 'aitdk_density', 'aitdk_social', 'aitdk_structured_data', 'seoquake_audit', 'seoanalyzer_summary', 'seoanalyzer_tab', 'ppcblogpro_summary', 'ppcblogpro_report', 'digispot_dashboard', 'digispot_report', 'seomator_geo_audit'],
  keywords: ['research_keywords', 'aitdk_density', 'aitdk_serp'],
  competitors: ['research_competitors', 'mangools_sp_competitors', 'ahrefs_domain_rating', 'moz_authority', 'mangools_siteprofiler'],
  backlinks: ['backlink_tracker', 'moz_authority', 'ahrefs_domain_rating', 'mangools_sp_overview', 'mangools_sp_backlinks', 'mangools_sp_top_content', 'mangools_linkminer', 'mangools_siteprofiler', 'aitdk_backlinks', 'aitdk_traffic'],
  visibility: ['ai_prompt_tracker', 'research_ai_prompts', 'mangools_ai_watcher', 'frase_ai_visibility', 'aitdk_geo_section', 'seomator_geo_audit'],
  local: ['research_local', 'research_location_pages', 'location_links', 'location_monthly', 'location_checklist'],
  pagespeed: ['pagespeed_report'],
  fetch: ['site_crawl', 'screenshots'],
  gsc: ['gsc_performance'],
};

export interface EnrichDeps {
  taskRepo: Repository<AuditTask>;
  evidenceRepo: Repository<AuditEvidence>;
}

async function saveResearch(deps: EnrichDeps, customerId: string, runId: string, r: Research): Promise<void> {
  const sha = createHash('sha256').update(r.key ? `${r.type}:${r.key}:${runId}` : `${r.type}:${runId}`).digest('hex');
  if (r.type === 'site_page_audit' && r.key === 'part-1') await deps.evidenceRepo.delete({ auditRunId: runId, evidenceType: 'site_page_audit' }); // drop chunks of an earlier crawl
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

const asArr = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]+/) : []).map((x) => String(x).trim()).filter(Boolean);

// Cities / service areas on the customer profile (comma separated or a list).
function locationsOf(i: ResearchInput): string[] {
  const p = i.profile ?? {};
  return [...new Set([p.city, p.target_location, p.service_area, p.service_areas, p.locations].flatMap(asArr))].filter((x) => x.length > 1).slice(0, 12);
}

// The customer's own set of buyer prompts (from the AI Visibility Prompt Tracker library) for the monthly AI answer test.
function promptSetResearch(i: ResearchInput): Research[] {
  const p = i.profile ?? {};
  const service = [...asArr(p.products_services), ...asArr(p.seed_keywords), ...(i.industry ? [i.industry] : [])][0] ?? '';
  const city = locationsOf(i)[0] ?? '';
  if (!i.companyName || !service) return [];
  const prompts = buildPromptSet({ brand: i.companyName, service, city, audience: asArr(p.target_audience ?? p.audience)[0] ?? '', problem: asArr(p.main_problem ?? p.customer_problem)[0] ?? '', competitors: i.competitors });
  return [{ type: 'research_ai_prompts', tool: 'tracker', label: 'AI visibility prompt set', data: { brand: i.companyName, service, city, prompts, how: 'Run these prompts every month on ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews and Copilot. Record each answer (mentioned, cited, position, sentiment, competitors, sources) in the AI Visibility Prompt Tracker, then upload that sheet as a .csv to add the results to this audit.' } }];
}

// The write-up needs the crawl's summary, scores, issues and site checks, not 500 page rows (cost and size).
function forWriter(type: string, d: any): any {
  if (type === 'site_root_audit' && d && Array.isArray(d.root)) {
    return {
      scores: d.scores,
      pagesAudited: d.pagesAudited,
      failingParameters: d.root
        .filter((r: any) => r.s === 'f' || r.s === 'w')
        .slice(0, 28)
        .map((r: any) => ({ id: r.id, name: PARAM_BY_ID.get(r.id)?.name, status: r.s, found: String(r.v).slice(0, 140), fix: String(r.f ?? '').slice(0, 160), pages: r.n ? r.n.f + r.n.w : undefined, examples: (r.ex ?? []).slice(0, 2) })),
    };
  }
  if (type !== 'site_crawl' || !d || !Array.isArray(d.issues)) return d;
  return { ...d, pages: undefined, brokenLinks: (d.brokenLinks ?? []).slice(0, 10), issues: d.issues.slice(0, 25).map((i: any) => ({ ...i, examples: (i.examples ?? []).slice(0, 2) })) };
}

export type EnrichProgress = (message: string) => Promise<void> | void;

export interface EnrichOptions {
  // Collect only the sources that still have an unfinished task; finished tasks keep their result and their sources are not re-fetched.
  blockedOnly?: boolean;
}

export async function enrichRun(deps: EnrichDeps, customerId: string, runId: string, input: ResearchInput, site: string, onProgress?: EnrichProgress, opts: EnrichOptions = {}): Promise<string[]> {
  const notes: string[] = [];
  const pendingSources = new Set<string>();
  if (opts.blockedOnly) {
    for (const t of await deps.taskRepo.find({ where: { auditRunId: runId } })) if (!t.isAutomated && TASK_SOURCE[t.skillId]) pendingSources.add(TASK_SOURCE[t.skillId]);
    if (!pendingSources.size) notes.push('Nothing blocked - no source needed collecting.');
  }
  const progress = async (m: string) => {
    try {
      await onProgress?.(m);
    } catch {
      // progress is best-effort only
    }
  };
  const runners: Array<[SourceKey, () => Promise<Research[]>]> = [
    [
      'site_ai',
      async () => {
        const crawl = await crawlSite(site);
        const { pageAudit, ...crawlOnly } = crawl;
        const out: Research[] = [{ type: 'site_crawl', tool: 'sitescan', label: 'Website crawl', data: crawlOnly as unknown as Record<string, any> }];
        if (pageAudit) {
          const { pages: auditPages, ...rootAudit } = pageAudit;
          out.push({ type: 'site_root_audit', tool: 'sitescan', label: 'Root domain audit (70 parameters)', data: rootAudit as unknown as Record<string, any> });
          const SIZE = 40;
          const parts = Math.max(1, Math.ceil(auditPages.length / SIZE));
          for (let i = 0; i < parts; i++) {
            const slice = auditPages.slice(i * SIZE, (i + 1) * SIZE);
            out.push({ type: 'site_page_audit', key: `part-${i + 1}`, tool: 'sitescan', label: `Page-wise audit ${i + 1} of ${parts}`, data: { part: i + 1, parts, from: i * SIZE + 1, to: i * SIZE + slice.length, total: auditPages.length, site: pageAudit.site, pages: slice } });
          }
        }
        const locs = locationsOf(input);
        if (locs.length) out.push({ type: 'research_location_pages', tool: 'sitescan', label: 'Location pages', data: auditLocationPages(crawl.pages, locs) as unknown as Record<string, any> });
        return out;
      },
    ],
    ['visibility', async () => promptSetResearch(input)],
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
    if (opts.blockedOnly && !pendingSources.has(key)) continue; // all its tasks are finished: do not fetch it again
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
    const isAi = src === 'ai';
    const rows = isAi
      ? evidence.filter((e) => e.status === 'approved' && e.extracted)
      : evidence.filter((e) => (FEEDS[src] ?? []).includes(e.evidenceType) && e.status === 'approved' && e.extracted);
    // A task is (re)written when it has no result yet, OR when any evidence feeding it - API data or an uploaded
    // screenshot approved since - is newer than the task's last write. Without this, a task finished in an earlier run
    // never picked up screenshots uploaded / approved afterwards.
    const newest = rows.reduce((m, e) => Math.max(m, new Date(e.updatedAt).getTime()), 0);
    const group = tasks.filter((t) => TASK_SOURCE[t.skillId] === src && (!t.isAutomated || newest > new Date(t.updatedAt).getTime()));
    step += 1;
    if (!group.length) continue;
    await progress(`step ${step}/${runners.length + LIVE_SOURCES.length}: writing ${SOURCE_LABEL[src]} (${group.length} tasks)`);
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
      : Object.fromEntries(rows.map((r) => [r.evidenceType, forWriter(r.evidenceType, r.extracted)]));
    // Authority / traffic / backlink numbers from every source side by side, so the write-up quotes each one by name.
    if (!isAi && (src === 'backlinks' || src === 'competitors')) {
      const cmp = metricsSummary(collectMetrics(rows));
      if (cmp.length) data = { metricComparison: cmp, ...data }; // first, so the size limit can never cut it
    }
    try {
      const written = await withTimeout(
        writeTasks(SOURCE_LABEL[src], data, group.map((t) => ({ id: t.id, skill: t.skillId, finds: t.finds, actionOutput: t.actionOutput })), site, isAi ? { maxChars: 16000, planning: true } : src === 'site_ai' ? { maxChars: 22000 } : {}),
        `${SOURCE_LABEL[src]} write-up`,
        15 * 60 * 1000,
      );
      for (const t of group) {
        const w = written.get(t.id);
        if (w) {
          t.finding = w.finding;
          t.suggestion = w.suggestion;
          t.isAutomated = true;
        } else if (!t.isAutomated) t.finding = `Research data was collected (${SOURCE_LABEL[src]}) but the task write-up did not finish. Run the enrichment again.`;
        // an already-finished task keeps its earlier result when a refresh does not complete
      }
    } catch (e: any) {
      notes.push(`${SOURCE_LABEL[src]} write-up: ${String(e?.message ?? e).slice(0, 160)}`);
      group.filter((t) => !t.isAutomated).forEach((t) => {
        t.finding = `Research data was collected (${SOURCE_LABEL[src]}) but the write-up failed: ${String(e?.message ?? e).slice(0, 120)}`;
      });
    }
    await deps.taskRepo.save(group);
  }
  return notes;
}
