import { AuditEvidence } from './audit-evidence.entity';
import { EVIDENCE_RULES } from './aitdk-rules';
import type { PpcReport } from './ppcblogpro-parser';

// Turns approved/extracted evidence into report HTML. The customer report gets approved items only,
// data only; the admin report also shows pending items (flagged) and the original screenshots.

export function evidenceStyle(): string {
  return `
    .ev-card { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px 20px; margin-bottom:16px; }
    .ev-card h3 { margin:0 0 4px; color:var(--accent); }
    .ev-card h4 { margin:16px 0 6px; font-size:14px; }
    .ev-src { color:var(--muted); font-size:12px; margin:0 0 10px; }
    .ev-flag { display:inline-block; background:#fff4e5; color:#8a5300; border-radius:999px; font-size:11px; font-weight:700; padding:2px 8px; margin-left:8px; }
    .ev-bar { background:#eef0f6; border-radius:999px; height:8px; min-width:120px; }
    .ev-bar > i { display:block; height:8px; border-radius:999px; background:var(--accent); }
    .ev-bar.low > i { background:#d97706; }
    .ev-shot { max-width:260px; max-height:200px; border:1px solid var(--line); border-radius:6px; margin-top:8px; }
    .ev-tag { display:inline-block; border-radius:999px; font-size:11px; font-weight:700; padding:2px 8px; }
    .ev-tag.pass, .ev-tag.minor { background:#e8f7ee; color:#157347; }
    .ev-tag.warn, .ev-tag.important { background:#fff4e5; color:#8a5300; }
    .ev-tag.critical { background:#fdecea; color:#b42318; }
    ul.ev-list { margin:6px 0 0; padding-left:20px; }
  `;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function isEmpty(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

function show(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => esc(x)).join(', ');
  if (typeof v === 'object' && v) return esc(JSON.stringify(v));
  return esc(v);
}

function kvTable(rows: Array<[string, unknown]>): string {
  const body = rows
    .filter(([, v]) => !isEmpty(v))
    .map(([k, v]) => `<tr><th style="width:34%">${esc(k)}</th><td>${show(v)}</td></tr>`)
    .join('');
  return body ? `<table><tbody>${body}</tbody></table>` : '<p class="empty">No values found.</p>';
}

function grid(headers: string[], rows: unknown[][]): string {
  if (!rows.length) return '<p class="empty">Nothing listed.</p>';
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${show(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function scoreBar(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  return `<div class="ev-bar${s < 60 ? ' low' : ''}"><i style="width:${s}%"></i></div>`;
}

// ---- per-type renderers -------------------------------------------------------------------

function renderDigispot(d: Record<string, any>, admin: boolean): string {
  let h = '';
  if (d.overallScore != null) {
    h += `<div class="summary" style="padding:0 0 8px"><div class="stat"><div class="stat-value">${esc(d.overallScore)}/100</div><div class="stat-label">Overall SEO score${d.overallLabel ? ` &middot; ${esc(d.overallLabel)}` : ''}</div></div>`;
    const c = d.issueCounts ?? {};
    if (c.total != null) h += `<div class="stat"><div class="stat-value">${esc(c.total)}</div><div class="stat-label">Issues found</div></div>`;
    h += `</div>`;
  }
  const cats = Object.entries((d.categoryScores ?? {}) as Record<string, number>);
  if (cats.length) {
    h += '<h4>Category scores</h4><table><tbody>' + cats.map(([k, v]) => `<tr><th style="width:34%">${esc(k)}</th><td style="width:12%">${esc(v)}/100</td><td>${scoreBar(Number(v))}</td></tr>`).join('') + '</tbody></table>';
  }
  const issues = (d.issues ?? []) as Array<Record<string, any>>;
  if (issues.length) {
    h += '<h4>Action plan</h4><table><thead><tr><th>Priority</th><th>Area</th><th>Issue</th><th>Impact</th><th>Fix</th></tr></thead><tbody>' +
      issues.map((i) => `<tr><td><span class="ev-tag ${esc(i.priority)}">${esc(i.priority)}</span></td><td>${esc(i.category)}</td><td>${esc(i.title)}</td><td>${esc(i.impact ?? '—')}</td><td>${esc(i.fix ?? '—')}</td></tr>`).join('') + '</tbody></table>';
  }
  if ((d.quickWins ?? []).length) h += `<h4>Quick wins</h4><ul class="ev-list">${d.quickWins.map((q: string) => `<li>${esc(q)}</li>`).join('')}</ul>`;
  if ((d.strengths ?? []).length) h += `<h4>What is working well</h4><ul class="ev-list">${d.strengths.map((q: string) => `<li>${esc(q)}</li>`).join('')}</ul>`;
  const s = (d.sections ?? {}) as Record<string, Record<string, any>>;
  const m = s.metadata;
  if (m) h += '<h4>On-page metadata</h4>' + kvTable([['Title', m.title], ['Title length', m.titleLength != null ? `${m.titleLength} characters (${m.titleStatus ?? ''})` : null], ['Meta description', m.metaDescription], ['Description length', m.descriptionLength != null ? `${m.descriptionLength} characters (${m.descriptionStatus ?? ''})` : null], ['Canonical', m.canonical], ['Language', m.language], ['Technologies', m.technologies], ['Analytics', m.analytics], ['Scripts', m.scripts], ['Search and AI bots', m.botAccess], ['llms.txt', m.llmsTxt]]);
  const hd = s.headings;
  if (hd) h += '<h4>Headings</h4>' + kvTable([['H1 / H2 / H3 / H4 / H5 / H6', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].every((k) => hd[k] != null) ? ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((k) => hd[k]).join(' / ') : null], ['Total headings', hd.total], ['Valid hierarchy', hd.validHierarchy], ['Primary H1', hd.primaryH1]]);
  const ct = s.content;
  if (ct) h += '<h4>Content</h4>' + kvTable([['Total words', ct.totalWords], ['Reading time', ct.readingTime], ['Readability', ct.readability], ['Content depth', ct.contentDepthScore], ['Scanability', ct.scanabilityScore], ['Topic authority', ct.topicAuthorityScore], ['Page intent', ct.pageIntent], ['Focus keywords', ct.focusKeywords]]);
  const lk = s.links;
  if (lk) h += '<h4>Links</h4>' + kvTable([['Total', lk.total], ['Internal', lk.internal], ['External', lk.external], ['Average internal link depth', lk.averageInternalLinkDepth]]);
  const im = s.images;
  if (im) h += '<h4>Images</h4>' + kvTable([['Total', im.total], ['Missing alt text', im.missingAlt], ['Oversized', im.oversized], ['Large files', im.largeFiles], ['Modern formats (WebP/AVIF)', im.modernFormats], ['Missing width/height', im.missingDimensions]]);
  const sc = s.schema;
  if (sc) h += '<h4>Structured data</h4>' + kvTable([['Schemas found', sc.totalSchemas], ['Valid', sc.valid], ['With warnings', sc.validWithWarnings], ['Types', sc.typesFound]]);
  const so = s.social;
  if (so) h += '<h4>Social</h4>' + kvTable([['Open Graph', so.openGraph], ['Twitter card', so.twitterCard], ['OG title', so.title], ['Site name', so.siteName], ['Image', so.image]]);
  const lo = s.local;
  if (lo) h += '<h4>Local SEO</h4>' + kvTable([['Business name', lo.businessName], ['Phone', lo.phone], ['Email', lo.email], ['Local SEO score', lo.localSeoScore]]);
  const pf = s.performance;
  if (pf) h += '<h4>Performance</h4>' + kvTable([['Real-user data', pf.realUserData], ['Lab test', pf.labTest], ['Scripts', pf.scripts]]);
  if (admin) {
    const w = Object.entries((d.warnings ?? {}) as Record<string, string[]>);
    if (w.length) h += '<h4>Warnings by section (admin)</h4><ul class="ev-list">' + w.flatMap(([k, list]) => list.map((x) => `<li><strong>${esc(k)}:</strong> ${esc(x)}</li>`)).join('') + '</ul>';
  }
  return h;
}

function renderAitdk(type: string, d: Record<string, any>): string {
  switch (type) {
    case 'aitdk_meta':
      return kvTable([['Title', d.title], ['Title length', d.titleLength != null ? `${d.titleLength}/${d.titleLimit ?? 60}` : null], ['Description', d.description], ['Description length', d.descriptionLength != null ? `${d.descriptionLength}/${d.descriptionLimit ?? 160}` : null], ['Keywords', d.keywords], ['Keywords length', d.keywordsLength != null ? `${d.keywordsLength}/${d.keywordsLimit ?? 100}` : null], ['URL', d.url], ['Canonical', d.canonical]]);
    case 'aitdk_technical': {
      const hd = d.headings ?? {}, im = d.images ?? {}, lk = d.links ?? {};
      return kvTable([['Domain created', d.domainCreation], ['Domain expires', d.domainExpiration], ['Robots tag', d.robotsTag], ['X-Robots-Tag', d.xRobotsTag], ['robots.txt', d.robotsTxt], ['sitemap.xml', d.sitemapXml], ['Google Analytics', d.googleAnalytics], ['Google AdSense', d.googleAdsense], ['Word count', d.wordCount], ['Language', d.lang], ['H1 / H2 / H3 / H4 / H5 / H6', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].every((k) => hd[k] != null) ? ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((k) => hd[k]).join(' / ') : null], ['Images (total / unique / no alt / no title)', im.total != null ? [im.total, im.unique, im.withoutAlt, im.withoutTitle].join(' / ') : null], ['Links (total / unique / internal / external / dofollow / nofollow)', lk.total != null ? [lk.total, lk.unique, lk.internal, lk.external, lk.dofollow, lk.nofollow].join(' / ') : null]]);
    }
    case 'aitdk_traffic':
      return kvTable([['Period', d.period], ['Monthly visits', d.monthlyVisits], ['Bounce rate', d.bounceRate], ['Pages per visit', d.pagesPerVisit], ['Visit duration', d.visitDuration], ['Global rank', d.globalRank], ['Country rank', d.countryRank], ['Domain age', d.domainAge], ['Domain created', d.domainCreation], ['Domain expires', d.domainExpiration]]);
    case 'aitdk_backlinks': {
      let h = kvTable([['Domain rating', d.domainRating], ['Backlinks', d.backlinks], ['Referring domains', d.refDomains], ['Dofollow', d.dofollowPercent != null ? `${d.dofollowPercent}%` : null]]);
      const list = (d.topBacklinks ?? []) as Array<Record<string, any>>;
      if (list.length) h += '<h4>Top backlinks</h4>' + grid(['Domain', 'DR', 'Title', 'Links to'], list.map((b) => [b.domain, b.dr ?? '—', b.title ?? '—', b.targetUrl ?? '—']));
      return h;
    }
    case 'aitdk_geo_section': {
      const items = (d.items ?? []) as Array<Record<string, any>>;
      return (d.score != null ? `<p><strong>${esc(d.section ?? 'Section')} score: ${esc(d.score)}/100</strong></p>` + scoreBar(Number(d.score)) : '') + grid(['Check', 'Result', 'Note'], items.map((i) => [i.name, i.status === 'pass' ? 'Pass' : 'Needs attention', i.note ?? '']));
    }
    case 'aitdk_serp': {
      const ip = (d.indexedPages ?? {}) as Record<string, number | null>;
      const rows = Object.entries(ip).filter(([, v]) => v != null).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]);
      let h = rows.length ? grid(['Search engine', 'Indexed pages'], rows) : '';
      const p = d.preview;
      if (p && (p.title || p.url)) h += '<h4>Google result preview</h4>' + kvTable([['Title', p.title], ['URL', p.url], ['Description', p.description]]);
      return h;
    }
    case 'aitdk_density': {
      const rows = (d.rows ?? []) as Array<Record<string, any>>;
      let h = kvTable([['Total words', d.totalWords], ['Unique words (1-word phrases)', d.ngramCounts?.['1']], ['2-word phrases', d.ngramCounts?.['2']], ['3-word phrases', d.ngramCounts?.['3']]]);
      if (rows.length) h += '<h4>Top keywords</h4>' + grid(['Keyword', 'Found in', 'Count', 'Density'], rows.map((r) => [r.keyword, (r.foundIn ?? []).join(', ') || '—', r.count, r.density]));
      return h;
    }
    case 'aitdk_social': {
      const og = Object.entries((d.openGraph ?? {}) as Record<string, string>).filter(([, v]) => !isEmpty(v));
      const tw = Object.entries((d.twitterCard ?? {}) as Record<string, string>).filter(([, v]) => !isEmpty(v));
      return (og.length ? '<h4>Open Graph</h4>' + kvTable(og as Array<[string, unknown]>) : '') + (tw.length ? '<h4>Twitter Card</h4>' + kvTable(tw as Array<[string, unknown]>) : '');
    }
    case 'aitdk_structured_data': {
      const entries = (d.entries ?? []) as Array<Record<string, any>>;
      return kvTable([['Schema types', d.schemaTypes], ['Date published', d.datePublished], ['Date modified', d.dateModified]]) + (entries.length ? '<h4>Markup</h4>' + grid(['Key', 'Value'], entries.map((e) => [e.key, e.value])) : '');
    }
    default: {
      const items = (d.items ?? []) as Array<Record<string, any>>;
      return (d.title ? `<p><strong>${esc(d.title)}</strong></p>` : '') + (items.length ? grid(['Item', 'Value'], items.map((i) => [i.label, i.value])) : '<p class="empty">Nothing could be read from this image.</p>');
    }
  }
}

function scoreTile(label: string, v: unknown): string {
  if (v == null || v === '') return '';
  return `<div style="flex:1;min-width:110px;border:1px solid var(--line);border-radius:8px;padding:10px 12px"><div class="ev-src" style="margin:0">${esc(label)}</div><div style="font-size:22px;font-weight:700">${esc(v)}<span style="font-size:12px;color:var(--muted)">/100</span></div>${scoreBar(Number(v))}</div>`;
}

function renderSeoAnalyzer(type: string, d: Record<string, any>): string {
  if (type === 'seoanalyzer_tab') {
    const items = (d.items ?? []) as Array<Record<string, any>>;
    return (d.tab ? `<p><strong>${esc(d.tab)} tab</strong></p>` : '') + (items.length ? grid(['Item', 'Value'], items.map((i) => [i.label, i.value])) : '<p class="empty">Nothing could be read from this image.</p>');
  }
  return kvTable([
    ['Title', d.title], ['Title length', d.titleLength != null ? `${d.titleLength} characters` : null],
    ['Description', d.description], ['Description length', d.descriptionLength != null ? `${d.descriptionLength} characters` : null],
    ['Keywords', d.keywords], ['URL', d.url], ['Canonical', d.canonical], ['Robots tag', d.robotsTag],
    ['Author', d.author], ['Publisher', d.publisher], ['Language', d.lang],
  ]);
}

function renderPpcSummary(d: Record<string, any>): string {
  const p = d.page ?? {};
  return (
    (d.verdict ? `<p><strong>${esc(d.verdict)}</strong>${d.verdictText ? ' &mdash; ' + esc(d.verdictText) : ''}</p>` : '') +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Total', d.total)}${scoreTile('SEO', d.seo)}${scoreTile('AEO', d.aeo)}${scoreTile('GEO', d.geo)}</div>` +
    kvTable([['Title', p.title], ['Type', p.type], ['Words', p.words], ['Headings', p.headings], ['Images', p.images], ['Links', p.links], ['Scope', p.scope], ['Schema', p.schema]])
  );
}

function renderPpcReport(d: PpcReport, admin: boolean): string {
  const s = d.scores ?? ({} as PpcReport['scores']);
  let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Total', s.total)}${scoreTile('SEO', s.seo)}${scoreTile('AEO', s.aeo)}${scoreTile('GEO', s.geo)}</div>`;
  if (d.pageUrl) h += `<p class="ev-src">Page: ${esc(d.pageUrl)}${d.contentType ? ' &middot; type: ' + esc(d.contentType) : ''}</p>`;
  for (const [cat, checks] of Object.entries(d.categories ?? {})) {
    const fixes = checks.filter((c) => c.status === 'fix').sort((a, b) => b.weight - a.weight);
    const passed = checks.filter((c) => c.status === 'pass');
    h += `<h4>${esc(cat)} &mdash; ${passed.length} passed, ${fixes.length} to fix</h4>`;
    h += fixes.length
      ? grid(['Check', 'What was found', 'How to fix'], fixes.map((c) => [c.check, c.detail, c.fix]))
      : '<p class="empty">Nothing to fix.</p>';
    if (admin && passed.length) h += `<p class="ev-src">Passed: ${passed.map((c) => esc(c.check)).join(', ')}</p>`;
  }
  return h;
}

const STATUS_LABEL: Record<string, string> = { pass: 'Pass', warning: 'Warning', error: 'Error' };

function renderSeoquake(d: Record<string, any>, admin: boolean): string {
  const c = d.counts ?? {};
  const checks = (d.checks ?? []) as Array<Record<string, any>>;
  let h = `<p><span class="ev-tag pass">${esc(c.passed ?? 0)} passed</span> <span class="ev-tag critical">${esc(c.errors ?? 0)} errors</span> <span class="ev-tag warn">${esc(c.warnings ?? 0)} warnings</span></p>`;
  const issues = checks.filter((x) => x.status === 'error' || x.status === 'warning').sort((a, b) => (a.status === 'error' ? 0 : 1) - (b.status === 'error' ? 0 : 1));
  h += '<h4>Needs attention</h4>' + (issues.length ? grid(['Check', 'Status', 'Found', 'Detail'], issues.map((x) => [x.name, STATUS_LABEL[x.status] ?? x.status, x.value ?? '', x.detail ?? ''])) : '<p class="empty">Nothing needs attention.</p>');
  if (admin) {
    const ok = checks.filter((x) => x.status === 'pass');
    if (ok.length) h += '<h4>Passed checks (admin)</h4>' + grid(['Check', 'Result'], ok.map((x) => [x.name, x.value ?? '']));
    const im = d.images ?? {};
    h += kvTable([['Images (total / with alt / missing alt / oversized)', im.total != null ? [im.total, im.withAlt, im.missingAlt, im.oversized].join(' / ') : null], ['Image formats', im.formats], ['Schema types', d.schemaTypes]]);
    const hd = (d.headings ?? []) as Array<Record<string, any>>;
    if (hd.length) h += '<h4>Heading outline</h4><ul class="ev-list">' + hd.map((x) => `<li style="margin-left:${Math.max(0, Number(x.level) - 1) * 14}px">H${esc(x.level)} ${esc(x.text)}</li>`).join('') + '</ul>';
  }
  return h;
}

function renderMangools(d: Record<string, any>): string {
  const a = d.authority ?? {}, b = d.backlinks ?? {}, r = d.referring ?? {};
  let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Domain authority', a.domainAuthority)}${scoreTile('Page authority', a.pageAuthority)}${scoreTile('Citation flow', a.citationFlow)}${scoreTile('Trust flow', a.trustFlow)}</div>`;
  h += kvTable([['Active backlinks', b.active], ['Lost backlinks', b.lost], ['Total backlinks', b.total != null ? b.total + (b.totalChangePercent ? ` (${b.totalChangePercent})` : '') : null], ['Dofollow ratio', b.dofollowRatio], ['Active links ratio', b.activeRatio], ['Referring domains', r.domains], ['Referring IPs', r.ips ?? d.referringIps], ['Referring subnets', r.subnets], ['Anchor type mix', d.anchorTypeDistribution]]);
  const dom = (d.topReferringDomains ?? []) as Array<Record<string, any>>;
  if (dom.length) h += '<h4>Top referring domains</h4>' + grid(['Domain', 'CF', 'TF', 'Links', 'WPR'], dom.map((x) => [x.domain, x.cf, x.tf, x.links, x.wpr]));
  const an = (d.anchors ?? []) as Array<Record<string, any>>;
  if (an.length) h += '<h4>Anchor texts</h4>' + grid(['Anchor', 'Type', 'Ref. domains', 'Total', 'Share'], an.map((x) => [x.text, x.type, x.rd, x.total, x.share]));
  const tc = (d.topContent ?? []) as Array<Record<string, any>>;
  if (tc.length) h += '<h4>Top content (by referring domains)</h4>' + grid(['Page', 'Facebook', 'Ref. domains'], tc.map((x) => [x.url, x.fb, x.rd]));
  const cp = (d.competitors ?? []) as Array<Record<string, any>>;
  if (cp.length) h += '<h4>Competitors</h4>' + grid(['Site', 'WPR', 'RI', 'FB', 'SK'], cp.map((x) => [x.url, x.wpr, x.ri, x.fb, x.sk]));
  return h;
}

function renderFrase(d: Record<string, any>): string {
  return kvTable([['AI engine', d.engine], ['Test question', d.question], ['Domain cited?', d.cited === true ? 'Yes' : d.cited === false ? 'No - not cited' : null], ['Domain', d.domain], ['Note', d.note]]);
}

function renderSeomator(d: Record<string, any>, admin: boolean): string {
  let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('GEO readiness', d.score)}</div>`;
  h += kvTable([['Grade', d.grade], ['Business type', d.businessType], ['Pages analysed', d.pagesAnalyzed], ['Date', d.date]]);
  if (d.summary) h += `<p>${esc(d.summary)}</p>`;
  const pa = (d.priorityActions ?? []) as string[];
  if (pa.length) h += '<h4>Priority actions</h4><ul class="ev-list">' + pa.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
  const cats = (d.categories ?? []) as Array<Record<string, any>>;
  if (cats.length) h += '<h4>Score breakdown</h4>' + grid(['Area', 'Weight', 'Score', 'Grade'], cats.map((c) => [c.name, c.weight, c.score != null ? `${c.score}/100` : '', c.grade]));
  const pl = (d.platforms ?? []) as Array<Record<string, any>>;
  if (pl.length) h += '<h4>AI platform readiness</h4>' + grid(['Platform', 'Score', 'Readiness'], pl.map((c) => [c.name, c.score != null ? `${c.score}/100` : '', c.readiness]));
  const fi = (d.findings ?? []) as Array<Record<string, any>>;
  if (fi.length) h += '<h4>Key findings</h4>' + grid(['Severity', 'Finding', 'Details', 'Effort'], fi.map((f) => [f.severity, f.title, f.description, f.effort]));
  const cr = d.crawlers ?? {};
  if (cr.checked != null) h += `<h4>AI crawler access</h4><p>${esc(cr.allowed)} of ${esc(cr.checked)} AI crawlers allowed${cr.blocked ? `; blocked: ${esc((cr.blockedNames ?? []).join(', ') || cr.blocked)}` : ''}.</p>`;
  const ee = (d.eeat ?? []) as Array<Record<string, any>>;
  if (ee.length) h += '<h4>E-E-A-T</h4>' + grid(['Pillar', 'Score', 'Evidence'], ee.map((x) => [x.pillar, `${x.score}/${x.max}`, x.evidence]));
  const br = (d.brandRecommendations ?? []) as string[];
  if (br.length) h += '<h4>Brand recommendations</h4><ul class="ev-list">' + br.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
  if (admin) {
    const ti = (d.technicalIssues ?? []) as Array<Record<string, any>>;
    if (ti.length) h += '<h4>Technical findings (admin)</h4>' + grid(['Severity', 'Issue', 'Page'], ti.map((x) => [x.severity, x.issue, x.page]));
    const m = (d.metrics ?? []) as Array<Record<string, any>>;
    if (m.length) h += '<h4>Key metrics (admin)</h4>' + grid(['Metric', 'Value'], m.map((x) => [x.label, x.value]));
  }
  return h;
}

function renderPageSpeed(d: Record<string, any>): string {
  const sc = d.scores ?? {};
  let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Performance', sc.performance)}${scoreTile('Accessibility', sc.accessibility)}${scoreTile('Best practices', sc.bestPractices)}${scoreTile('SEO', sc.seo)}</div>`;
  const m = (d.metrics ?? []) as Array<Record<string, any>>;
  if (m.length) h += '<h4>Core metrics (mobile)</h4>' + grid(['Metric', 'Value'], m.map((x) => [x.label, x.value]));
  const o = (d.opportunities ?? []) as Array<Record<string, any>>;
  if (o.length) h += '<h4>Biggest speed opportunities</h4>' + grid(['Opportunity', 'Potential saving'], o.map((x) => [x.title, x.savings]));
  return h;
}

function labelFor(type: string): string {
  if (type === 'digispot_report') return 'Digispot SEO Insights report';
  if (type === 'pagespeed_report') return 'Page speed (Google PageSpeed Insights)';
  if (type === 'ppcblogpro_report') return 'SEO / AEO / GEO page checks';
  return EVIDENCE_RULES.find((r) => r.type === type)?.label ?? 'Tool data';
}

function toolName(tool: string): string {
  return tool === 'aitdk' ? 'AITDK SEO Extension' : tool === 'digispot' ? 'Digispot AI' : tool === 'ppcblogpro' ? 'PPCBlogPro' : tool === 'seoanalyzer' ? 'SEO Analyzer' : tool === 'seoquake' ? 'SEOquake' : tool === 'frase' ? 'Frase' : tool === 'seomator' ? 'SEOmator' : tool === 'pagespeed' ? 'Google PageSpeed' : tool === 'mangools' ? 'Mangools' : 'Other tool';
}

export function renderEvidenceHtml(all: AuditEvidence[], audience: 'admin' | 'customer'): string {
  const items = all.filter((e) => e.includeInReport && e.extracted && (audience === 'admin' ? e.status === 'extracted' || e.status === 'approved' : e.status === 'approved'));
  if (!items.length) return '';
  const order = (e: AuditEvidence) => (e.evidenceType === 'digispot_report' ? 0 : e.evidenceType === 'ppcblogpro_report' ? 1 : 2);
  const sorted = [...items].sort((a, b) => order(a) - order(b) || a.createdAt.getTime() - b.createdAt.getTime());
  const cards = sorted
    .map((e) => {
      const d = e.extracted as Record<string, any>;
      const body =
        e.evidenceType === 'digispot_report' ? renderDigispot(d, audience === 'admin')
        : e.evidenceType === 'ppcblogpro_report' ? renderPpcReport(d as PpcReport, audience === 'admin')
        : e.evidenceType === 'ppcblogpro_summary' ? renderPpcSummary(d)
        : e.evidenceType === 'pagespeed_report' ? renderPageSpeed(d)
        : e.evidenceType === 'seomator_geo_audit' ? renderSeomator(d, audience === 'admin')
        : e.evidenceType === 'frase_ai_visibility' ? renderFrase(d)
        : e.evidenceType === 'seoquake_audit' ? renderSeoquake(d, audience === 'admin')
        : e.evidenceType === 'mangools_siteprofiler' ? renderMangools(d)
        : e.evidenceType.startsWith('seoanalyzer_') ? renderSeoAnalyzer(e.evidenceType, d)
        : renderAitdk(e.evidenceType, d);
      const flag = audience === 'admin' && e.status !== 'approved' ? '<span class="ev-flag">Not approved yet - hidden from customer</span>' : '';
      const isPdf = /\.pdf$/i.test(e.fileName);
      const shot = audience === 'admin' && e.url && isPdf ? `<p class="ev-src"><a href="${esc(e.url)}" target="_blank" rel="noopener">Open original PDF</a></p>` : audience === 'admin' && e.url ? `<div><img class="ev-shot" src="${esc(e.url)}" alt="${esc(e.fileName)}" /></div>` : '';
      return `<div class="ev-card"><h3>${esc(labelFor(e.evidenceType))}${flag}</h3><p class="ev-src">${esc(toolName(e.tool))} &middot; ${esc(e.fileName)}</p>${body}${shot}</div>`;
    })
    .join('');
  return `<section class="layers"><h2>Tool findings</h2>${cards}</section>`;
}
