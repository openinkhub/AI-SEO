import { mangoolsGet } from '../customer-apis/mangools/client';
import { normKw } from './layer11.service';

// Pure helpers shared by Layers 11-AAA, 12, 13 and 14 (ports of the plugin's weighted_available, layer12_geekflare_facts,
// SerpApi competitor matching and Mangools location resolve).

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
};
// min(100, log10(v + 1) * k); null stays null (the KPI is not available).
export const logScore = (v: number | null, k: number): number | null => (v === null ? null : Math.min(100, Math.log10(Math.max(1, v) + 1) * k));

// Weighted average over the KPIs that are available; a missing KPI's weight is redistributed, never counted as zero.
export function weightedAvailable(metrics: Record<string, [number | null, number]>): { score: number | null; used: Record<string, number> } {
  let sum = 0;
  let w = 0;
  const used: Record<string, number> = {};
  for (const [name, [v, wt]] of Object.entries(metrics)) {
    if (v === null || v === undefined || !isFinite(v) || wt <= 0) continue;
    sum += Math.max(0, Math.min(100, v)) * wt;
    w += wt;
    used[name] = wt;
  }
  return { score: w ? round2(sum / w) : null, used };
}

export function competitorStrength(count: number | null, best: number | null, pageStrength: number | null): number | null {
  if (count === null) return null;
  return Math.min(100, count * 15 + (best !== null ? Math.max(0, 40 - Math.min(40, best)) : 0) + (pageStrength !== null ? pageStrength * 0.35 : 0));
}

export interface SerpMatch { count: number; best: number | null; avg: number | null; domains: string[]; bestUrl: string | null }

// Which of the customer's competitor sites appear in the Google results of one keyword, and where.
export function matchCompetitors(organic: any[], hosts: string[]): SerpMatch {
  const matched = new Set<string>();
  const positions = new Map<string, number>();
  let bestUrl = '';
  let bestPos = Infinity;
  for (const o of Array.isArray(organic) ? organic : []) {
    const link = String(o?.link ?? '');
    const low = link.toLowerCase();
    const pos = parseInt(String(o?.position ?? 0), 10) || 0;
    for (const h of hosts) {
      if (h && low.includes(h)) {
        matched.add(h);
        if (pos > 0 && !positions.has(h)) positions.set(h, pos);
        if (pos > 0 && pos < bestPos) {
          bestPos = pos;
          bestUrl = link;
        }
      }
    }
  }
  const ps = [...positions.values()];
  return { count: matched.size, best: ps.length ? Math.min(...ps) : null, avg: ps.length ? round2(ps.reduce((a, b) => a + b, 0) / ps.length) : null, domains: [...matched], bestUrl: bestUrl || null };
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const isUrl = (s: string): boolean => /^https?:\/\/\S+$/i.test(s);

// Factual extraction of one competitor page from a Geekflare web-scraping response (port of layer12_geekflare_facts).
export function geekflareFacts(json: any, url: string): Record<string, any> {
  if (!json || typeof json !== 'object') return {};
  const strings: string[] = [];
  const heads: Record<string, string[]> = { h1: [], h2: [], h3: [] };
  const links: string[] = [];
  let schema = false;
  let author = '';
  let title = '';
  let meta = '';
  let canonical = '';
  let contentType = '';
  let body = '';
  const walk = (x: any, depth: number) => {
    if (!x || typeof x !== 'object' || depth > 10) return;
    for (const [k, v0] of Object.entries(x)) {
      const lk = k.toLowerCase();
      if (typeof v0 === 'string') {
        const v = stripTags(v0);
        if (!v) continue;
        if (!title && ['title', 'page_title', 'pagetitle'].includes(lk)) title = v;
        if (!meta && ['description', 'meta_description', 'metadescription'].includes(lk)) meta = v;
        if (!canonical && lk.includes('canonical') && isUrl(v)) canonical = v;
        if (!author && lk.includes('author')) author = v;
        if (!contentType && ['content_type', 'type', 'pagetype'].includes(lk)) contentType = v;
        if (lk === 'h1' || lk === 'h2' || lk === 'h3') heads[lk].push(v);
        if ((lk.includes('url') || lk.includes('link')) && isUrl(v)) links.push(v);
        if (!body && ['content', 'text', 'body', 'main_content', 'article'].includes(lk) && v.length > 200) body = v;
        strings.push(v);
      } else if (v0 && typeof v0 === 'object') {
        if (lk.includes('schema') || lk.includes('jsonld') || lk.includes('json_ld')) schema = true;
        walk(v0, depth + 1);
      }
    }
  };
  walk(json, 0);
  const text = body || strings.slice(0, 80).join(' ');
  const words = text ? text.split(/\s+/).filter(Boolean).length : null;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* ignore */ }
  let internal = 0;
  let external = 0;
  for (const l of new Set(links)) {
    let h = '';
    try { h = new URL(l).hostname.toLowerCase(); } catch { /* ignore */ }
    if (!h || h === host) internal++;
    else external++;
  }
  const parts: Array<[number | null, number]> = [
    [title ? 100 : null, 10], [meta ? 100 : null, 10], [heads.h1.length ? 100 : null, 15], [heads.h2.length || heads.h3.length ? 100 : null, 15],
    [words !== null ? Math.min(100, words / 12) : null, 25], [schema ? 100 : null, 10], [author ? 100 : null, 5], [links.length > 0 ? Math.min(100, links.length * 10) : null, 10],
  ];
  let score = 0;
  let den = 0;
  for (const [v, w] of parts) if (v !== null) { score += v * w; den += w; }
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    url, canonical: canonical || null, title: title || null, meta_description: meta || null, h1: uniq(heads.h1), h2: uniq(heads.h2), h3: uniq(heads.h3),
    word_count: words, reading_time_minutes: words !== null ? Math.round((words / 220) * 10) / 10 : null, content_type: contentType || null,
    internal_link_count: internal, external_link_count: external, schema_present: schema ? 'Yes' : 'No', author: author || null,
    content_excerpt: text ? text.slice(0, 1200) : null, page_strength_score: den ? round2(score / den) : null, source: 'Geekflare factual page extraction',
  };
}

// Mangools KWFinder location for a place name (first active result), 0 when none.
export async function resolveMangoolsLocation(apiKey: string, query: string): Promise<number> {
  const r = await mangoolsGet(apiKey, 'mangools/locations', { query });
  const items: any[] = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : Array.isArray(r?.locations) ? r.locations : Array.isArray(r?.items) ? r.items : [];
  const hit = items.find((i) => i && i.active && Number(i._id) > 0);
  return hit ? Number(hit._id) : 0;
}

// Rows of a Mangools keyword-imports response keyed by normalised keyword.
export function mangoolsRows(r: any): Map<string, any> {
  const arr: any[] = Array.isArray(r?.keywords) ? r.keywords : Array.isArray(r?.data?.keywords) ? r.data.keywords : Array.isArray(r) ? r : [];
  const m = new Map<string, any>();
  for (const x of arr) {
    const k = normKw(String(x?.kw ?? x?.keyword ?? ''));
    if (k) m.set(k, x);
  }
  return m;
}

// Intent from the wording of a keyword, used only when no AI-platform intent exists for it (Layer 4-A keywords carry their own).
export function inferIntent(kw: string): string {
  const k = ' ' + kw.toLowerCase() + ' ';
  if (/\b(buy|price|prices|pricing|cost|cheap|hire|book|order|quote|near me|service|services|agency|company|consultant|shop|for sale|discount|rates?)\b/.test(k)) return 'Transactional';
  if (/\b(best|top|vs|versus|review|reviews|compare|comparison|alternatives?|affordable|which)\b/.test(k)) return 'Commercial';
  if (/\b(how|what|why|when|who|guide|tips|ideas|examples?|meaning|definition|tutorial|learn|benefits)\b/.test(k)) return 'Informational';
  return 'Commercial';
}
