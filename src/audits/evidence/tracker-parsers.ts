
// Readers for the three Openink Hub tracker workbooks, exported one sheet at a time as CSV:
//   - Backlink Audit Tracker   -> 'backlink_tracker'   (live check, link attribute, index evidence, quality rating, anchor mix)
//   - AI Visibility Prompt Tracker -> 'ai_prompt_tracker' (mention / citation rate per platform, share of voice, sources)
//   - Location Page Ranking Tracker -> 'location_links' (outreach + anchor mix), 'location_monthly' (rank trend), 'location_checklist' (progress)
// Fixed rules, no AI. The backlink sheet can also be verified live against the pages (see verifyBacklinks).
import { parseCsv } from './ppcblogpro-parser';
import { fetchPage } from '../sources/crawl-http';

type Row = Record<string, string>;

function table(text: string, headerHint: string[]): { head: string[]; rows: Row[] } | null {
  const all = parseCsv(text);
  // the real header row may sit below a title block (the workbooks have 3-4 title rows)
  const at = all.findIndex((r) => headerHint.every((h) => r.some((c) => c.trim().toLowerCase().includes(h))));
  if (at < 0) return null;
  const head = all[at].map((h) => h.trim());
  const rows = all.slice(at + 1).map((r) => {
    const o: Row = {};
    head.forEach((h, i) => (o[h.toLowerCase()] = (r[i] ?? '').trim()));
    return o;
  });
  return { head, rows };
}

const col = (r: Row, ...names: string[]): string => {
  for (const n of names) for (const k of Object.keys(r)) if (k.includes(n)) return r[k];
  return '';
};
const n0 = (v: string): number | null => {
  const m = String(v).replace(/[%,]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const domainOf = (u: string): string => {
  try {
    return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};
const yes = (v: string) => /^(yes|y|true|live|published)$/i.test(v.trim());
const head1 = (text: string): string => text.replace(/^﻿/, '').split(/\r?\n/).slice(0, 14).join('\n').toLowerCase();

// ---- Backlink Audit Tracker ---------------------------------------------------------------------------------

export function looksLikeBacklinkTracker(text: string): boolean {
  const h = head1(text);
  return h.includes('backlink page url') && h.includes('anchor text') && h.includes('link live');
}

export type AnchorClass = 'Branded/URL' | 'Partial/Natural' | 'Keyword';
export const ANCHOR_TARGET = { 'Branded/URL': 50, 'Partial/Natural': 30, Keyword: 20 } as const;

export function classifyAnchor(anchor: string, brand: string): AnchorClass {
  const a = anchor.trim().toLowerCase();
  if (!a) return 'Partial/Natural';
  if (/^(https?:\/\/|www\.)/.test(a) || /\.[a-z]{2,}(\/|$)/.test(a) || (brand && a.replace(/[^a-z0-9]/g, '').includes(brand.replace(/[^a-z0-9]/g, '')))) return 'Branded/URL';
  if (/^(click here|here|read more|visit|website|this site|this link|source|link|more|learn more)$/.test(a)) return 'Partial/Natural';
  return a.split(/\s+/).length >= 5 ? 'Partial/Natural' : 'Keyword';
}

export function qualityRating(live: string, attr: string, indexed: string, relevance: string, spam: number | null): 'Strong' | 'Moderate' | 'Review' {
  if (/^yes$/i.test(live) && /^dofollow$/i.test(attr) && /^yes$/i.test(indexed) && /^high$/i.test(relevance) && (spam ?? 0) <= 5) return 'Strong';
  if (/^no$/i.test(live) || /no evidence/i.test(indexed) || /^low$/i.test(relevance) || (spam ?? 0) > 20) return 'Review';
  return 'Moderate';
}

export interface BacklinkRow {
  pageUrl: string;
  targetUrl: string;
  anchor: string;
  domain: string;
  live: string;
  attribute: string;
  indexed: string;
  da: number | null;
  dr: number | null;
  spam: number | null;
  relevance: string;
  quality: string;
  anchorClass: AnchorClass;
  notes: string;
  check?: { live: boolean; status: number | null; attribute: string | null; anchorFound: string | null; note: string };
}

export interface BacklinkTracker {
  tool: 'backlink_tracker';
  rows: BacklinkRow[];
  totals: Record<string, number>;
  anchorMix: Array<{ type: AnchorClass; count: number; actualPct: number; targetPct: number; gap: number }>;
  topDomains: Array<{ domain: string; links: number }>;
  findings: string[];
  verified: boolean;
}

export function summariseBacklinks(rows: BacklinkRow[]): Pick<BacklinkTracker, 'totals' | 'anchorMix' | 'topDomains' | 'findings'> {
  const cnt = (f: (r: BacklinkRow) => boolean) => rows.filter(f).length;
  const dom = new Map<string, number>();
  rows.forEach((r) => r.domain && dom.set(r.domain, (dom.get(r.domain) ?? 0) + 1));
  const total = rows.length;
  const totals = {
    entered: total,
    live: cnt((r) => yes(r.live)),
    notLive: cnt((r) => /^no$/i.test(r.live)),
    doFollow: cnt((r) => /^dofollow$/i.test(r.attribute)),
    noFollow: cnt((r) => /^nofollow$/i.test(r.attribute)),
    sponsored: cnt((r) => /^sponsored$/i.test(r.attribute)),
    ugc: cnt((r) => /^ugc$/i.test(r.attribute)),
    indexed: cnt((r) => /^yes$/i.test(r.indexed)),
    noIndexEvidence: cnt((r) => /no evidence/i.test(r.indexed)),
    strong: cnt((r) => r.quality === 'Strong'),
    moderate: cnt((r) => r.quality === 'Moderate'),
    review: cnt((r) => r.quality === 'Review'),
    referringDomains: dom.size,
  };
  const published = rows.filter((r) => !/^no$/i.test(r.live));
  const anchorMix = (Object.keys(ANCHOR_TARGET) as AnchorClass[]).map((type) => {
    const count = published.filter((r) => r.anchorClass === type).length;
    const actualPct = published.length ? Math.round((count / published.length) * 100) : 0;
    return { type, count, actualPct, targetPct: ANCHOR_TARGET[type], gap: actualPct - ANCHOR_TARGET[type] };
  });
  const findings: string[] = [];
  if (total && totals.notLive) findings.push(`${totals.notLive} of ${total} backlinks are not live: ask for them to be restored or replace them.`);
  if (total && totals.review) findings.push(`${totals.review} backlinks are rated "Review" (not live, no index evidence, low relevance or spam score above 20).`);
  for (const a of anchorMix) if (published.length >= 5 && a.gap > 15) findings.push(`Anchor text is over-weighted to "${a.type}" (${a.actualPct}% against a ${a.targetPct}% target): vary the anchors.`);
  const top = [...dom.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && total >= 5 && top[1] / total > 0.3) findings.push(`${top[0]} supplies ${top[1]} of ${total} links: spread links across more referring domains.`);
  if (total && totals.doFollow === 0 && totals.noFollow + totals.sponsored + totals.ugc > 0) findings.push('None of the links are DoFollow.');
  return { totals, anchorMix, topDomains: [...dom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([domain, links]) => ({ domain, links })), findings };
}

export function parseBacklinkTracker(text: string, brandHint = ''): BacklinkTracker {
  const t = table(text, ['backlink page url', 'anchor text']);
  if (!t) throw new Error('This is not the Backlink Audit Tracker sheet (header "Backlink Page URL" not found).');
  const brand = brandHint.toLowerCase();
  const rows: BacklinkRow[] = t.rows
    .filter((r) => /^https?:\/\//i.test(col(r, 'backlink page url')) && !/example\.(com|org)|example row/i.test(col(r, 'backlink page url') + col(r, 'notes')))
    .map((r) => {
      const spam = n0(col(r, 'spam'));
      const live = col(r, 'link live');
      const attr = col(r, 'link attribute');
      const idx = col(r, 'google indexed');
      const rel = col(r, 'topical relevance');
      const anchor = col(r, 'anchor text');
      return {
        pageUrl: col(r, 'backlink page url'),
        targetUrl: col(r, 'target url'),
        anchor,
        domain: domainOf(col(r, 'backlink page url')),
        live, attribute: attr, indexed: idx,
        da: n0(col(r, 'da')), dr: n0(col(r, 'dr')), spam,
        relevance: rel,
        quality: col(r, 'quality rating') || qualityRating(live, attr, idx, rel, spam),
        anchorClass: classifyAnchor(anchor, brand),
        notes: col(r, 'notes'),
      };
    });
  return { tool: 'backlink_tracker', rows, ...summariseBacklinks(rows), verified: false };
}

// Opens every listed backlink page and checks the link for real: is the page up, does it still link to the target
// domain, and is the link follow / nofollow / sponsored / ugc. The sheet's own columns stay, the check sits beside them.
export async function verifyBacklinks(bt: BacklinkTracker, targetHost: string, max = 30): Promise<BacklinkTracker> {
  const host = targetHost.replace(/^www\./, '').toLowerCase();
  const todo = bt.rows.slice(0, max);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, todo.length) }, async () => {
      while (i < todo.length) {
        const row = todo[i++];
        const r = await fetchPage(row.pageUrl, { timeout: 8000 });
        if (!r || r.status >= 400) {
          row.check = { live: false, status: r?.status ?? null, attribute: null, anchorFound: null, note: r ? `Page answers ${r.status}` : 'Page did not respond' };
          continue;
        }
        let found: { attr: string; text: string } | null = null;
        for (const m of r.text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
          const href = m[1].match(/href=["']([^"']+)["']/i)?.[1];
          if (!href) continue;
          let h = '';
          try {
            h = new URL(href, r.url).hostname.replace(/^www\./, '').toLowerCase();
          } catch {
            continue;
          }
          if (h !== host) continue;
          const rel = (m[1].match(/rel=["']([^"']*)["']/i)?.[1] ?? '').toLowerCase();
          const attr = /sponsored/.test(rel) ? 'Sponsored' : /ugc/.test(rel) ? 'UGC' : /nofollow/.test(rel) ? 'NoFollow' : 'DoFollow';
          const textOnly = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (!found || (found.attr !== 'DoFollow' && attr === 'DoFollow')) found = { attr, text: textOnly };
        }
        row.check = found
          ? { live: true, status: r.status, attribute: found.attr, anchorFound: found.text.slice(0, 80), note: r.hops.length ? `Page redirects (${r.hops.length})` : '' }
          : { live: false, status: r.status, attribute: null, anchorFound: null, note: `Page loads but no link to ${host} was found` };
      }
    }),
  );
  const mismatches = todo.filter((r) => r.check && yes(r.live) && !r.check.live).length;
  const attrDiff = todo.filter((r) => r.check?.live && r.attribute && r.check.attribute && r.check.attribute.toLowerCase() !== r.attribute.toLowerCase()).length;
  const deadNow = todo.filter((r) => r.check && !r.check.live).length;
  bt.verified = true;
  bt.findings = [
    ...(deadNow ? [`Live check: ${deadNow} of ${todo.length} pages no longer show a link to ${host}.`] : [`Live check: all ${todo.length} pages checked still link to ${host}.`]),
    ...(mismatches ? [`${mismatches} link(s) are marked "Live: Yes" in the sheet but were not found on the page.`] : []),
    ...(attrDiff ? [`${attrDiff} link(s) have a different follow attribute on the page than in the sheet.`] : []),
    ...bt.findings,
  ];
  if (bt.rows.length > max) bt.findings.push(`Only the first ${max} of ${bt.rows.length} links were checked live.`);
  return bt;
}

// ---- AI Visibility Prompt Tracker ---------------------------------------------------------------------------

export function looksLikePromptTracker(text: string): boolean {
  const h = head1(text);
  return h.includes('date tested') && h.includes('platform') && h.includes('mentioned?') && h.includes('cited');
}

export interface PromptTracker {
  tool: 'ai_prompt_tracker';
  platforms: Array<{ platform: string; tested: number; mentions: number; citations: number; mentionRate: number; citationRate: number; positive: number; neutral: number; negative: number }>;
  overall: { tested: number; mentions: number; citations: number; mentionRate: number; citationRate: number };
  shareOfVoice: Array<{ brand: string; mentions: number; share: number }>;
  topSources: Array<{ domain: string; count: number }>;
  gaps: Array<{ promptId: string; prompt: string; competitors: string }>;
  dates: { first: string; last: string };
  findings: string[];
}

export function parsePromptTracker(text: string, brand = ''): PromptTracker {
  const t = table(text, ['date tested', 'platform', 'mentioned?']);
  if (!t) throw new Error('This is not the AI Visibility Prompt Tracker sheet (header "Date tested / Platform / Mentioned?" not found).');
  const rows = t.rows.filter((r) => col(r, 'platform') && col(r, 'mentioned?') && !/^ex$/i.test(r['id'] ?? '') && !/example row/i.test(col(r, 'notes')));
  const by = new Map<string, Row[]>();
  rows.forEach((r) => by.set(col(r, 'platform'), [...(by.get(col(r, 'platform')) ?? []), r]));
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const platforms = [...by.entries()].map(([platform, rs]) => {
    const mentions = rs.filter((r) => yes(col(r, 'mentioned?'))).length;
    const citations = rs.filter((r) => yes(col(r, 'cited'))).length;
    const sent = (s: string) => rs.filter((r) => col(r, 'sentiment').toLowerCase() === s).length;
    return { platform, tested: rs.length, mentions, citations, mentionRate: rate(mentions, rs.length), citationRate: rate(citations, rs.length), positive: sent('positive'), neutral: sent('neutral'), negative: sent('negative') };
  });
  const sum = (k: 'tested' | 'mentions' | 'citations') => platforms.reduce((s, p) => s + p[k], 0);
  const overall = { tested: sum('tested'), mentions: sum('mentions'), citations: sum('citations'), mentionRate: rate(sum('mentions'), sum('tested')), citationRate: rate(sum('citations'), sum('tested')) };
  const comp = new Map<string, number>();
  rows.forEach((r) => col(r, 'competitors named').split(/[,;]+/).map((x) => x.trim()).filter(Boolean).forEach((c) => comp.set(c, (comp.get(c) ?? 0) + 1)));
  const total = overall.mentions + [...comp.values()].reduce((a, b) => a + b, 0);
  const shareOfVoice = [{ brand: brand || 'This brand', mentions: overall.mentions, share: rate(overall.mentions, total) }, ...[...comp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b, m]) => ({ brand: b, mentions: m, share: rate(m, total) }))];
  const src = new Map<string, number>();
  rows.forEach((r) => col(r, 'source urls').split(/[,;\s]+/).map((x) => domainOf(x)).filter(Boolean).forEach((d) => src.set(d, (src.get(d) ?? 0) + 1)));
  const byPrompt = new Map<string, Row[]>();
  rows.forEach((r) => byPrompt.set(col(r, 'prompt id') || col(r, 'prompt text'), [...(byPrompt.get(col(r, 'prompt id') || col(r, 'prompt text')) ?? []), r]));
  const gaps = [...byPrompt.entries()]
    .filter(([, rs]) => rs.every((r) => !yes(col(r, 'mentioned?'))))
    .slice(0, 12)
    .map(([promptId, rs]) => ({ promptId, prompt: col(rs[0], 'prompt text').slice(0, 140), competitors: [...new Set(rs.flatMap((r) => col(r, 'competitors named').split(/[,;]+/).map((x) => x.trim()).filter(Boolean)))].slice(0, 5).join(', ') }));
  const dates = rows.map((r) => col(r, 'date tested')).filter(Boolean).sort();
  const findings: string[] = [];
  if (overall.tested) findings.push(`The brand is mentioned in ${overall.mentionRate}% of ${overall.tested} tested answers and cited (linked) in ${overall.citationRate}%.`);
  const best = [...platforms].sort((a, b) => b.mentionRate - a.mentionRate)[0];
  const worst = [...platforms].sort((a, b) => a.mentionRate - b.mentionRate)[0];
  if (platforms.length > 1) findings.push(`Strongest platform: ${best.platform} (${best.mentionRate}% mention rate). Weakest: ${worst.platform} (${worst.mentionRate}%).`);
  if (gaps.length) findings.push(`${gaps.length} prompts never mention the brand on any platform: these are the content gaps to close first.`);
  if (platforms.some((p) => p.negative > 0)) findings.push('Some answers frame the brand negatively: review those answers and the sources they cite.');
  return { tool: 'ai_prompt_tracker', platforms, overall, shareOfVoice, topSources: [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, count]) => ({ domain, count })), gaps, dates: { first: dates[0] ?? '', last: dates[dates.length - 1] ?? '' }, findings };
}

// ---- Location Page Ranking Tracker --------------------------------------------------------------------------

export type LocationKind = 'location_links' | 'location_monthly' | 'location_checklist';
export function looksLikeLocation(text: string): LocationKind | null {
  const h = head1(text);
  if (h.includes('pitch sent') && h.includes('anchor type')) return 'location_links';
  if (h.includes('rank (main keyword)') && h.includes('impressions')) return 'location_monthly';
  if (h.includes('phase') && h.includes('task') && h.includes('owner') && h.includes('status') && h.includes('due date')) return 'location_checklist';
  return null;
}

export function parseLocationSheet(text: string, kind: LocationKind): Record<string, any> {
  if (kind === 'location_links') {
    const t = table(text, ['pitch sent', 'anchor type'])!;
    const rows = t.rows.filter((r) => col(r, 'site') && !/example/i.test(col(r, 'site') + col(r, 'notes')));
    const status = new Map<string, number>();
    rows.forEach((r) => status.set(col(r, 'status') || 'Unknown', (status.get(col(r, 'status') || 'Unknown') ?? 0) + 1));
    const published = rows.filter((r) => /published|live/i.test(col(r, 'status')));
    const mix = (Object.keys(ANCHOR_TARGET) as AnchorClass[]).map((type) => {
      const count = published.filter((r) => new RegExp(type.split('/')[0], 'i').test(col(r, 'anchor type'))).length;
      const actualPct = published.length ? Math.round((count / published.length) * 100) : 0;
      return { type, count, actualPct, targetPct: ANCHOR_TARGET[type], gap: actualPct - ANCHOR_TARGET[type] };
    });
    const findings: string[] = [];
    if (rows.length) findings.push(`${published.length} of ${rows.length} prospects have a published link; ${rows.length - published.length} are still being pitched or waiting.`);
    for (const a of mix) if (published.length >= 5 && a.gap > 15) findings.push(`Anchor mix is over-weighted to "${a.type}" (${a.actualPct}% against ${a.targetPct}%).`);
    return { tool: 'location_tracker', kind, prospects: rows.length, byStatus: Object.fromEntries(status), published: published.length, dofollow: published.filter((r) => /do/i.test(col(r, 'follow')) && !/no/i.test(col(r, 'follow'))).length, anchorMix: mix, findings, rows: rows.slice(0, 40).map((r) => ({ site: col(r, 'site'), type: col(r, 'type'), status: col(r, 'status'), liveUrl: col(r, 'live url'), anchorType: col(r, 'anchor type'), follow: col(r, 'follow') })) };
  }
  if (kind === 'location_monthly') {
    const t = table(text, ['rank (main keyword)', 'impressions'])!;
    const rows = t.rows.filter((r) => /^\d{4}-\d{2}/.test(col(r, 'month')) && !/example row/i.test(col(r, 'notes')));
    const series = rows.map((r) => ({ month: col(r, 'month'), rank: n0(col(r, 'rank')), impressions: n0(col(r, 'impressions')), clicks: n0(col(r, 'clicks')), newBacklinks: n0(col(r, 'new backlinks')), reviews: n0(col(r, 'reviews')) }));
    const f = series.find((s) => s.rank != null), l = [...series].reverse().find((s) => s.rank != null);
    const findings: string[] = [];
    if (f && l && f !== l) findings.push(`Main keyword moved from position ${f.rank} (${f.month}) to ${l.rank} (${l.month}): ${f.rank! - l.rank! >= 0 ? 'up' : 'down'} ${Math.abs(f.rank! - l.rank!)} places.`);
    const sumC = series.reduce((s, x) => s + (x.clicks ?? 0), 0), sumI = series.reduce((s, x) => s + (x.impressions ?? 0), 0);
    if (sumI) findings.push(`Across ${series.length} months: ${sumC} clicks from ${sumI} impressions (CTR ${Math.round((sumC / sumI) * 1000) / 10}%).`);
    return { tool: 'location_tracker', kind, months: series, findings };
  }
  const t = table(text, ['phase', 'task', 'status'])!;
  let phase = '';
  const tasks: Array<{ phase: string; task: string; status: string; owner: string; due: string }> = [];
  for (const r of t.rows) {
    const p = col(r, 'phase'), task = col(r, 'task');
    if (p && !task) { phase = p; continue; }
    if (task) tasks.push({ phase: p || phase, task, status: col(r, 'status') || 'Not started', owner: col(r, 'owner'), due: col(r, 'due') });
  }
  const done = tasks.filter((x) => /done|complete/i.test(x.status)).length;
  const byPhase = [...new Set(tasks.map((x) => x.phase))].map((ph) => ({ phase: ph, done: tasks.filter((x) => x.phase === ph && /done|complete/i.test(x.status)).length, total: tasks.filter((x) => x.phase === ph).length }));
  return { tool: 'location_tracker', kind, done, total: tasks.length, progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0, byPhase, open: tasks.filter((x) => !/done|complete/i.test(x.status)).slice(0, 15), findings: tasks.length ? [`Location page plan: ${done} of ${tasks.length} tasks done (${Math.round((done / tasks.length) * 100)}%).`] : [] };
}
