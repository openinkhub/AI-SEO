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

function pct(v: unknown): string | null {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  return /%$/.test(t) || /^n\/?a$/i.test(t) ? t : `${t}%`;
}

function renderMangools(d: Record<string, any>): string {
  const a = d.authority ?? {}, b = d.backlinks ?? {}, r = d.referring ?? {};
  let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Domain authority', a.domainAuthority)}${scoreTile('Page authority', a.pageAuthority)}${scoreTile('Citation flow (link strength)', a.citationFlow)}${scoreTile('Trust flow (link quality)', a.trustFlow)}</div>`;
  const change = b.totalChangePercent != null && b.totalChangePercent !== '' ? ` (${/^-/.test(String(b.totalChangePercent)) ? '' : '+'}${pct(b.totalChangePercent)} change)` : '';
  h += kvTable([
    ['Active backlinks (links still live)', b.active],
    ['Lost backlinks (links removed)', b.lost],
    ['Total backlinks', b.total != null ? `${b.total}${change}` : null],
    ['Dofollow share (links that pass ranking value)', pct(b.dofollowRatio)],
    ['Active links share (live links out of all links found)', pct(b.activeRatio)],
    ['Referring domains (different websites linking to you)', r.domains],
    ['Referring IPs (different servers linking to you)', r.ips ?? d.referringIps],
    ['Referring subnets (different network blocks linking to you)', r.subnets],
    ['Anchor text type distribution', pct(d.anchorTypeDistribution)],
  ]);
  const dom = (d.topReferringDomains ?? []) as Array<Record<string, any>>;
  if (dom.length) h += '<h4>Top referring domains</h4>' + grid(['Domain', 'Citation flow', 'Trust flow', 'Links', 'Web page rank'], dom.map((x) => [x.domain, x.cf, x.tf, x.links, x.wpr]));
  const an = (d.anchors ?? []) as Array<Record<string, any>>;
  if (an.length) h += '<h4>Anchor texts (the clickable words of the links)</h4>' + grid(['Anchor', 'Type', 'Referring domains', 'Total links', 'Share'], an.map((x) => [x.text, x.type, x.rd, x.total, x.share]));
  const tc = (d.topContent ?? []) as Array<Record<string, any>>;
  if (tc.length) h += '<h4>Top content (by referring domains)</h4>' + grid(['Page', 'Facebook shares', 'Referring domains'], tc.map((x) => [x.url, x.fb, x.rd]));
  const cp = (d.competitors ?? []) as Array<Record<string, any>>;
  if (cp.length) h += '<h4>Competitors</h4>' + grid(['Site', 'Web page rank', 'Referring IPs', 'Facebook shares', 'Keyword overlap'], cp.map((x) => [x.url, x.wpr, x.ri, x.fb, x.sk]));
  return h;
}

function mgFlow(v: any): string {
  return v == null ? '' : String(v);
}

function renderMangoolsFn(type: string, d: Record<string, any>): string {
  if (type === 'mangools_sp_overview') {
    const a = d.authority ?? {};
    let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Domain authority', a.domainAuthority)}${scoreTile('Page authority', a.pageAuthority)}${scoreTile('Citation flow', a.citationFlow)}${scoreTile('Trust flow', a.trustFlow)}</div>`;
    const o = d.organic;
    h += kvTable([['Referring IPs', d.referringIps], ['Keywords ranking in Google', o?.keywords], ['In top 3', o?.top3], ['In top 10', o?.top10], ['In top 20', o?.top20], ['Estimated monthly organic visits', o?.estimatedTraffic], ['New / lost keywords', o ? `${o.newKeywords ?? 0} new / ${o.lostKeywords ?? 0} lost` : null]]);
    return h;
  }
  if (type === 'mangools_sp_backlinks') {
    const b = d.backlinks ?? {}, r = d.referring ?? {}, f = d.flow ?? {}, l = d.last30Days;
    let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Citation flow', f.citationFlow)}${scoreTile('Trust flow', f.trustFlow)}</div>`;
    h += kvTable([['Total backlinks', b.total], ['Lost (deleted) links', b.deleted], ['Nofollow links', b.nofollow], ['Text links', b.text], ['Links to homepage', b.toHomepage], ['Referring domains', r.domains], ['Referring IPs', r.ips], ['Referring subnets', r.subnets], ['.edu / .gov domains', r.edu != null || r.gov != null ? `${r.edu ?? 0} / ${r.gov ?? 0}` : null], ['Indexed URLs', d.indexedUrls], ['Last 30 days (new / lost links)', l ? `${l.newLinks} / ${l.lostLinks}` : null]]);
    const dom = (d.topReferringDomains ?? []) as Array<Record<string, any>>;
    if (dom.length) h += '<h4>Top referring domains</h4>' + grid(['Domain', 'Citation flow', 'Trust flow', 'Links'], dom.map((x) => [x.domain, mgFlow(x.cf), mgFlow(x.tf), mgFlow(x.links)]));
    const an = (d.anchors ?? []) as Array<Record<string, any>>;
    if (an.length) h += '<h4>Anchor texts</h4>' + grid(['Anchor', 'Type', 'Ref. domains', 'Total links'], an.map((x) => [x.text, x.type, mgFlow(x.refDomains), mgFlow(x.total)]));
    return h;
  }
  if (type === 'mangools_sp_competitors') {
    const c = (d.competitors ?? []) as Array<Record<string, any>>;
    return c.length ? grid(['Competitor', 'Overlap score', 'Referring IPs', 'Facebook shares'], c.map((x) => [x.domain, mgFlow(x.overlap), mgFlow(x.referringIps), mgFlow(x.facebookShares)])) : '<p class="empty">No competitors were returned.</p>';
  }
  if (type === 'mangools_sp_top_content') {
    const p = (d.pages ?? []) as Array<Record<string, any>>;
    return p.length ? grid(['Page', 'Ref. domains', 'Backlinks', 'Citation flow', 'Trust flow'], p.map((x) => [x.url, mgFlow(x.refDomains), mgFlow(x.backlinks), mgFlow(x.cf), mgFlow(x.tf)])) : '<p class="empty">No pages were returned.</p>';
  }
  if (type === 'mangools_linkminer') {
    const u = (d.urls ?? []) as Array<Record<string, any>>;
    return u.length ? grid(['URL', 'Citation flow', 'Trust flow', 'Ref. domains', 'Backlinks', 'Ref. IPs'], u.map((x) => [x.url, mgFlow(x.citationFlow), mgFlow(x.trustFlow), mgFlow(x.refDomains), mgFlow(x.backlinks), mgFlow(x.refIps)])) : '';
  }
  if (type === 'mangools_ai_watcher') {
    const val = (m: any) => (m && m.value != null ? Math.round(m.value * 10) / 10 : null);
    let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('AI score', val(d.score))}${scoreTile('AI visibility %', val(d.visibility))}</div>`;
    h += kvTable([['Brand monitored', d.brand], ['Average position in AI answers', val(d.position)], ['Best AI model for you', d.bestPerforming ? `${d.bestPerforming.model} (${d.bestPerforming.value}%)` : null], ['Most cited by', d.mostCited ? `${d.mostCited.model} (${d.mostCited.value}%)` : null], ['AI models tracked', (d.models ?? []).join(', ')], ['Market', d.location], ['Period', d.dateRange ? `${d.dateRange.from} to ${d.dateRange.to}` : null]]);
    const b = (d.brands ?? []) as Array<Record<string, any>>;
    if (b.length) h += '<h4>Brands AI recommends (you and competitors)</h4>' + grid(['Brand', 'Rank', 'Score', 'Visibility %', 'Avg position'], b.map((x) => [x.brand + (x.you ? ' (you)' : ''), mgFlow(x.rank), mgFlow(x.score), mgFlow(x.visibility), mgFlow(x.position)]));
    const p = (d.prompts ?? []) as Array<Record<string, any>>;
    if (p.length) h += '<h4>Questions asked to AI</h4>' + grid(['Question', 'Score', 'Visibility %', 'Position', 'Google AI Overview'], p.map((x) => [x.text, mgFlow(x.score), mgFlow(x.visibility), mgFlow(x.position), x.aiOverview ? 'Yes' : 'No']));
    const s = (d.citedSources ?? []) as Array<Record<string, any>>;
    if (s.length) h += '<h4>Sources AI cites</h4>' + grid(['Source', 'Mentions', 'Your site?'], s.map((x) => [x.domain, mgFlow(x.mentions), x.yours ? 'Yes' : 'No']));
    return h;
  }
  return '';
}

function renderResearch(type: string, d: Record<string, any>): string {
  const f = (v: any) => (v == null ? '' : String(v));
  if (type === 'research_keywords') {
    let h = kvTable([['Seed keywords', (d.seeds ?? []).join(', ')]]);
    const k = (d.keywords ?? []) as Array<Record<string, any>>;
    if (k.length) h += '<h4>Keyword opportunities (Mangools KWFinder)</h4>' + grid(['Keyword', 'Searches per month', 'Difficulty (0-100)', 'Cost per click (CPC)', 'From seed'], k.map((x) => [x.keyword, f(x.volume), f(x.difficulty), f(x.cpc), x.seed]));
    const r = (d.rankChecks ?? []) as Array<Record<string, any>>;
    if (r.length) h += '<h4>Where the site ranks on Google today</h4>' + grid(['Search', 'Your position', 'Top results', 'AI Overview shown'], r.map((x) => [x.query, x.ownPosition ? '#' + x.ownPosition : 'Not in top 20', (x.top ?? []).map((t: any) => t.domain).join(', '), x.aiOverview ? 'Yes' : 'No']));
    if ((d.questions ?? []).length) h += '<h4>Questions people ask</h4><ul class="ev-list">' + d.questions.map((q: string) => `<li>${esc(q)}</li>`).join('') + '</ul>';
    if ((d.relatedSearches ?? []).length) h += '<h4>Related searches</h4><p>' + d.relatedSearches.map((q: string) => esc(q)).join(' &middot; ') + '</p>';
    return h;
  }
  if (type === 'research_competitors') {
    let h = '';
    if ((d.namedCompetitors ?? []).length) h += kvTable([['Competitors named in your profile', d.namedCompetitors.join(', ')]]);
    const o = (d.ownKeywords ?? []) as Array<Record<string, any>>;
    if (o.length) h += '<h4>Keywords your site already ranks for</h4>' + grid(['Keyword', 'Searches per month', 'Google position', 'Estimated visits'], o.map((x) => [x.keyword, f(x.volume), f(x.position), f(x.visits)]));
    const s = (d.domainsSharingKeywords ?? []) as Array<Record<string, any>>;
    if (s.length) h += '<h4>Sites competing for the same keywords</h4>' + grid(['Domain', 'Shared keywords'], s.map((x) => [x.domain, f(x.sharedKeywords)]));
    for (const c of (d.competitorKeywords ?? []) as Array<Record<string, any>>) {
      h += `<h4>${esc(c.competitor)} - ${esc(f(c.total))} ranking keywords</h4>` + grid(['Keyword', 'Searches / month'], (c.top ?? []).map((x: any) => [x.keyword, f(x.volume)]));
    }
    return h || '<p class="empty">No competitor keyword data was returned.</p>';
  }
  if (type === 'research_local') {
    let h = kvTable([['Search run', d.query], ['Location', d.location], ['Your site in Google results', d.ownOrganicPosition ? '#' + d.ownOrganicPosition : 'Not in top 20'], ['Your business in the local pack', d.ownInLocalPack ? 'Yes' : 'No']]);
    const p = (d.localPack ?? []) as Array<Record<string, any>>;
    if (p.length) h += '<h4>Local pack (who Google shows)</h4>' + grid(['Business', 'Rating', 'Reviews', 'Address'], p.map((x) => [x.name + (x.own ? ' (you)' : ''), f(x.rating), f(x.reviews), x.address]));
    const t = (d.topOrganic ?? []) as Array<Record<string, any>>;
    if (t.length) h += '<h4>Top organic results</h4>' + grid(['#', 'Site', 'Title'], t.map((x) => [f(x.pos), x.domain, x.title]));
    return h;
  }
  return '';
}

function renderAhrefsDr(d: Record<string, any>): string {
  const site = d.site ?? {};
  let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Your Domain Rating', site.domainRating)}</div>`;
  const c = (d.competitors ?? []) as Array<Record<string, any>>;
  if (c.length) h += '<h4>Competitors</h4>' + grid(['Domain', 'Domain Rating', 'Compared with you'], c.map((x) => [x.domain, x.domainRating ?? 'n/a', x.domainRating != null && site.domainRating != null ? (site.domainRating >= x.domainRating ? 'You are ahead or level' : `${Math.round((x.domainRating - site.domainRating) * 10) / 10} points ahead of you`) : '']));
  h += `<p class="ev-src">${esc(d.credit ?? 'Domain Rating by Ahrefs (https://ahrefs.com/)')}</p>`;
  return h;
}

function renderMoz(d: Record<string, any>): string {
  const site = d.site ?? {};
  let h = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">${scoreTile('Domain Authority', site.domainAuthority)}${scoreTile('Page Authority', site.pageAuthority)}${scoreTile('Spam score %', site.spamScore)}</div>`;
  h += kvTable([['Linking domains', site.linkingDomains], ['Links', site.links]]);
  const c = (d.competitors ?? []) as Array<Record<string, any>>;
  if (c.length) h += '<h4>Competitors</h4>' + grid(['Domain', 'Domain Authority', 'Page Authority', 'Linking domains', 'Compared with you'], c.map((x) => [x.domain, x.domainAuthority ?? 'n/a', x.pageAuthority ?? 'n/a', x.linkingDomains ?? 'n/a', x.domainAuthority != null && site.domainAuthority != null ? (site.domainAuthority >= x.domainAuthority ? 'You are ahead or level' : `${Math.round((x.domainAuthority - site.domainAuthority) * 10) / 10} points ahead of you`) : '']));
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

function renderDigispotDashboard(d: Record<string, any>): string {
  let h = '';
  const im = d.impact;
  if (im && typeof im === 'object') h += `<p><span class="ev-tag critical">${esc(im.critical ?? '-')} critical</span> <span class="ev-tag warn">${esc(im.high ?? '-')} high</span> <span class="ev-tag minor">${esc(im.medium ?? '-')} medium</span> <span class="ev-tag pass">${esc(im.low ?? '-')} low</span> <span class="ev-src">issues by impact</span></p>`;
  const rows = (d.scores ?? []) as Array<Record<string, any>>;
  const groups: string[] = [];
  rows.forEach((r) => { const g = String(r.group ?? 'Scores'); if (!groups.includes(g)) groups.push(g); });
  for (const g of groups) {
    h += `<h4>${esc(g)}</h4>` + grid(['Score', 'Result', 'Rating', 'Range on site (min / avg / max)', 'Top 10%'], rows.filter((r) => String(r.group ?? 'Scores') === g).map((r) => [r.name, r.score != null ? `${r.score}/100` : 'N/A', r.label ?? '', r.min != null || r.avg != null || r.max != null ? [r.min ?? '-', r.avg ?? '-', r.max ?? '-'].join(' / ') : '', r.top10 ?? '']));
  }
  return h || '<p class="empty">Nothing could be read from this image.</p>';
}

function labelFor(type: string): string {
  if (type === 'digispot_report') return 'Digispot SEO Insights report';
  if (type === 'pagespeed_report') return 'Page speed (Google PageSpeed Insights)';
  if (type === 'moz_authority') return 'Domain Authority (Moz)';
  if (type === 'ahrefs_domain_rating') return 'Domain Rating (Ahrefs)';
  if (type === 'research_keywords') return 'Keyword research';
  if (type === 'research_competitors') return 'Competitor research';
  if (type === 'research_local') return 'Local search research';
  if (type === 'mangools_sp_overview') return 'Authority overview (Mangools SiteProfiler)';
  if (type === 'mangools_sp_backlinks') return 'Backlink profile (Mangools SiteProfiler)';
  if (type === 'mangools_sp_competitors') return 'Competitors (Mangools SiteProfiler)';
  if (type === 'mangools_sp_top_content') return 'Top content by links (Mangools SiteProfiler)';
  if (type === 'mangools_linkminer') return 'Link metrics for key pages (Mangools LinkMiner)';
  if (type === 'mangools_ai_watcher') return 'AI search visibility (Mangools AI Search Watcher)';
  if (type === 'ppcblogpro_report') return 'SEO / AEO / GEO page checks';
  return EVIDENCE_RULES.find((r) => r.type === type)?.label ?? 'Tool data';
}

function toolName(tool: string): string {
  return tool === 'aitdk' ? 'AITDK SEO Extension' : tool === 'digispot' ? 'Digispot AI' : tool === 'ppcblogpro' ? 'PPCBlogPro' : tool === 'seoanalyzer' ? 'SEO Analyzer' : tool === 'seoquake' ? 'SEOquake' : tool === 'frase' ? 'Frase' : tool === 'seomator' ? 'SEOmator' : tool === 'pagespeed' ? 'Google PageSpeed' : tool === 'mangools' ? 'Mangools' : tool === 'serpapi' ? 'Google results (SerpApi)' : tool === 'ahrefs' ? 'Ahrefs' : tool === 'moz' ? 'Moz' : 'Other tool';
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
        : e.evidenceType === 'digispot_dashboard' ? renderDigispotDashboard(d)
        : e.evidenceType === 'pagespeed_report' ? renderPageSpeed(d)
        : e.evidenceType === 'seomator_geo_audit' ? renderSeomator(d, audience === 'admin')
        : e.evidenceType === 'frase_ai_visibility' ? renderFrase(d)
        : e.evidenceType === 'moz_authority' ? renderMoz(d)
        : e.evidenceType === 'ahrefs_domain_rating' ? renderAhrefsDr(d)
        : e.evidenceType === 'seoquake_audit' ? renderSeoquake(d, audience === 'admin')
        : e.evidenceType === 'mangools_siteprofiler' ? renderMangools(d)
        : e.evidenceType.startsWith('mangools_') ? renderMangoolsFn(e.evidenceType, d)
        : e.evidenceType.startsWith('research_') ? renderResearch(e.evidenceType, d)
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
