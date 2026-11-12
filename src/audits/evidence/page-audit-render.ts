// Reports for the 79-parameter audit: the root domain table, the page-wise tables, a full stand-alone HTML report and a CSV
// with one row per page and parameter. All of it reads the evidence rows produced by the crawl (site_root_audit, site_page_audit).
import { GROUPS, PARAMS, PARAM_BY_ID, Rule, St, statusWord } from '../sources/page-params';

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const TAG: Record<St, string> = { p: 'pass', w: 'warn', f: 'critical', i: 'minor', n: 'minor' };
const tag = (s: St): string => `<span class="ev-tag ${TAG[s]}">${esc(statusWord(s))}</span>`;
const nameOf = (id: number): string => PARAM_BY_ID.get(id)?.name ?? `Parameter ${id}`;
const scoreTag = (n: number | null | undefined): string => (n == null ? '<span class="ev-tag minor">n/a</span>' : `<span class="ev-tag ${n >= 80 ? 'pass' : n >= 60 ? 'warn' : 'critical'}">${n}/100</span>`);

interface PageRow {
  url: string;
  status: number | null;
  title: string | null;
  type: string;
  score: number | null;
  read: number | null;
  fix: number;
  warn: number;
  rules: Rule[];
}

const urlLink = (u: string): string => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//i, ''))}</a>`;

function ruleTable(rows: Rule[], withStandard = false): string {
  return (
    `<table><thead><tr><th style="width:4%">#</th><th style="width:17%">Parameter</th><th style="width:9%">Status</th><th style="width:30%">What was found</th><th>What to change on the website</th></tr></thead><tbody>` +
    rows
      .map((r) => `<tr><td>${r.id}</td><td><strong>${esc(nameOf(r.id))}</strong>${withStandard ? `<br><span class="ev-src">${esc(PARAM_BY_ID.get(r.id)?.standard ?? '')}</span>` : ''}</td><td>${tag(r.s)}</td><td>${esc(r.v)}${r.n && r.n.t ? `<br><span class="ev-src">${r.ex?.length ? 'e.g. ' + r.ex.slice(0, 3).map((u) => esc(u.replace(/^https?:\/\//i, ''))).join(', ') : ''}</span>` : ''}</td><td>${r.f ? esc(r.f) : r.s === 'p' ? '<span class="ev-src">Nothing to change.</span>' : ''}</td></tr>`)
      .join('') +
    '</tbody></table>'
  );
}

// ---- root domain -----------------------------------------------------------------------------------------------------------

export function renderRootAudit(d: Record<string, any>): string {
  const rules = (d.root ?? []) as Rule[];
  const sc = d.scores ?? {};
  let h = `<p><strong>Root domain: ${esc(d.site)}</strong> &middot; site score ${scoreTag(sc.site)} &middot; ${esc(d.pagesAudited)} pages audited &middot; average page score ${scoreTag(sc.avgPage)} &middot; ${esc(sc.pagesToFix ?? 0)} page(s) need a fix, ${esc(sc.pagesClean ?? 0)} have none</p>`;
  const fixes = (d.fixes ?? []) as Array<Record<string, any>>;
  if (fixes.length) {
    h += `<h4>Fix list for the website (most important first)</h4><table><thead><tr><th style="width:9%">Priority</th><th style="width:20%">Parameter</th><th style="width:8%">Pages</th><th>What to change on the website</th></tr></thead><tbody>${fixes
      .slice(0, 40)
      .map((f) => `<tr><td>${tag(f.s)}</td><td>${esc(f.id)}. ${esc(f.name)}</td><td>${esc(f.pages || '-')}</td><td>${esc(f.fix)}${(f.ex ?? []).length ? `<br><span class="ev-src">e.g. ${(f.ex as string[]).slice(0, 3).map((u) => esc(u.replace(/^https?:\/\//i, ''))).join(', ')}</span>` : ''}</td></tr>`)
      .join('')}</tbody></table>`;
  }
  for (const g of GROUPS) {
    const rows = rules.filter((r) => PARAM_BY_ID.get(r.id)?.group === g);
    if (rows.length) h += `<h4>${esc(g)}</h4>${ruleTable(rows)}`;
  }
  const issues = (d.siteIssues ?? []) as Array<Record<string, any>>;
  if (issues.length) {
    h += `<h4>Other site-wide technical issues found by the crawl</h4><table><thead><tr><th>Priority</th><th>Area</th><th>Issue</th><th>Count</th><th>What to change on the website</th></tr></thead><tbody>${issues
      .map((i) => `<tr><td>${tag(i.severity === 'critical' ? 'f' : i.severity === 'warning' ? 'w' : 'i')}</td><td>${esc(i.area)}</td><td>${esc(i.title)}${(i.examples ?? []).length ? `<br><span class="ev-src">e.g. ${(i.examples as string[]).slice(0, 2).map((u) => esc(String(u).replace(/^https?:\/\//i, ''))).join(', ')}</span>` : ''}</td><td>${esc(i.count)}</td><td>${esc(i.fix)}</td></tr>`)
      .join('')}</tbody></table>`;
  }
  const psi = d.psi;
  if (psi?.tested) h += `<p class="ev-src">Google PageSpeed (mobile) was run on ${esc(psi.tested)} page(s): the homepage and the best-linked pages.</p>`;
  if ((d.notes ?? []).length) h += `<p class="ev-src">${(d.notes as string[]).map(esc).join(' ')}</p>`;
  return h;
}

// ---- page-wise ----------------------------------------------------------------------------------------------------------------

function pageBlock(p: PageRow, open: boolean): string {
  const bad = p.rules.filter((r) => r.s === 'f' || r.s === 'w').sort((a, b) => (a.s === b.s ? a.id - b.id : a.s === 'f' ? -1 : 1));
  const passed = p.rules.filter((r) => r.s === 'p');
  const info = p.rules.filter((r) => r.s === 'i');
  return (
    `<details${open ? ' open' : ''} style="margin:6px 0"><summary><strong>${esc(p.title || p.url)}</strong> &middot; ${scoreTag(p.score)} &middot; ${p.fix} to fix, ${p.warn} warning(s) &middot; <span class="ev-src">${esc(p.url)}</span></summary>` +
    `<p class="ev-src">${urlLink(p.url)} &middot; type: ${esc(p.type)}${p.status && p.status !== 200 ? ` &middot; HTTP ${esc(p.status)}` : ''}${p.read != null ? ` &middot; readability ${esc(p.read)}/100` : ''}</p>` +
    (bad.length ? ruleTable(bad) : '<p>No fixes needed on this page.</p>') +
    (passed.length ? `<p class="ev-src"><strong>Passed (${passed.length}):</strong> ${passed.map((r) => esc(nameOf(r.id))).join(', ')}.</p>` : '') +
    (info.length ? `<p class="ev-src"><strong>For information:</strong> ${info.map((r) => `${esc(nameOf(r.id))}: ${esc(r.v)}`).join(' &middot; ')}</p>` : '') +
    '</details>'
  );
}

export function renderPageAuditChunk(d: Record<string, any>, open = false): string {
  const pages = (d.pages ?? []) as PageRow[];
  let h = `<p><strong>Pages ${esc(d.from)}-${esc(d.to)} of ${esc(d.total)}</strong> (lowest score first). Each page is checked against all ${PARAMS.length} parameters; open a page to see what to change.</p>`;
  h += `<table><thead><tr><th>Page</th><th>Type</th><th>Score</th><th>Fix</th><th>Warnings</th><th>First thing to fix</th></tr></thead><tbody>${pages
    .map((p) => {
      const first = p.rules.find((r) => r.s === 'f') ?? p.rules.find((r) => r.s === 'w');
      return `<tr><td>${esc((p.url || '').replace(/^https?:\/\//i, ''))}</td><td>${esc(p.type)}</td><td>${scoreTag(p.score)}</td><td>${p.fix}</td><td>${p.warn}</td><td>${first ? esc(`${nameOf(first.id)}: ${first.v}`) : '-'}</td></tr>`;
    })
    .join('')}</tbody></table>`;
  return h + pages.map((p) => pageBlock(p, open)).join('');
}

// ---- stand-alone downloads --------------------------------------------------------------------------------------------------

export function pageAuditHtmlDoc(root: Record<string, any>, chunks: Array<Record<string, any>>): string {
  const css = `body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#1c2430;max-width:1200px;margin:24px auto;padding:0 16px}h1{font-size:22px}h4{margin:22px 0 6px;font-size:15px}table{border-collapse:collapse;width:100%;margin:6px 0 14px}th,td{border:1px solid #dfe3ea;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px}th{background:#f4f6f9}.ev-tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap}.ev-tag.pass{background:#dff5e3;color:#14612a}.ev-tag.warn{background:#fff1cc;color:#7a5200}.ev-tag.critical{background:#fde0e0;color:#9a1c1c}.ev-tag.minor{background:#e8ecf2;color:#47556b}.ev-src{color:#5d6b82;font-size:12px}details{border:1px solid #dfe3ea;border-radius:8px;padding:8px 12px}summary{cursor:pointer}@media print{details{break-inside:avoid}}`;
  const pages = chunks.flatMap((c) => (c.pages ?? []) as PageRow[]);
  const total = pages.length;
  const body = `<h1>SEO audit: 79 parameters (70 SEO + 9 agent-readiness), root domain and every page</h1>` +
    `<h2>Root domain</h2>${renderRootAudit(root)}` +
    `<h2>Page-wise report</h2><p>${total} pages. Lowest score first.</p>` +
    `<table><thead><tr><th>Page</th><th>Type</th><th>Score</th><th>Fix</th><th>Warnings</th></tr></thead><tbody>${pages.map((p) => `<tr><td>${esc(p.url.replace(/^https?:\/\//i, ''))}</td><td>${esc(p.type)}</td><td>${scoreTag(p.score)}</td><td>${p.fix}</td><td>${p.warn}</td></tr>`).join('')}</tbody></table>` +
    pages.map((p) => pageBlock(p, true)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SEO audit - ${esc(root.site)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

const cell = (v: unknown): string => {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function pageAuditCsv(root: Record<string, any>, chunks: Array<Record<string, any>>): string {
  const head = ['Scope', 'URL', 'Page type', 'Page score', '#', 'Parameter', 'Group', 'Status', 'What was found', 'What to change on the website'];
  const lines = [head.map(cell).join(',')];
  const add = (scope: string, url: string, type: string, score: unknown, r: Rule) => {
    const p = PARAM_BY_ID.get(r.id);
    lines.push([scope, url, type, score ?? '', r.id, p?.name ?? '', p?.group ?? '', statusWord(r.s), r.v, r.f ?? ''].map(cell).join(','));
  };
  for (const r of ((root.root ?? []) as Rule[]).sort((a, b) => a.id - b.id)) add('Root domain', root.site ?? '', 'domain', root.scores?.site, r);
  for (const c of chunks) for (const p of (c.pages ?? []) as PageRow[]) for (const r of p.rules) add('Page', p.url, p.type, p.score, r);
  return '﻿' + lines.join('\r\n');
}
