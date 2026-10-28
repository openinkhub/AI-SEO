import { AuditEvidence } from './audit-evidence.entity';

// Authority / traffic / backlink numbers can differ between tools (Moz DA vs Mangools DA, AITDK backlinks vs
// Mangools backlinks...). This lists every source's own number side by side - nothing is merged or averaged. The
// customer report keeps showing each tool's data as it is; this comparison is for the admin Layer mapping and View Tasks.

export interface MetricCell {
  source: string;
  value: string;
}
export interface MetricRow {
  key: string;
  label: string;
  cells: MetricCell[];
  differs: boolean;
}

interface Extractor {
  metric: string;
  type: string;
  source: string;
  pick: (d: any) => unknown;
}

const METRICS: Array<[string, string]> = [
  ['da', 'Domain Authority (DA)'],
  ['pa', 'Page Authority (PA)'],
  ['dr', 'Domain Rating (DR)'],
  ['cf', 'Citation flow'],
  ['tf', 'Trust flow'],
  ['traffic', 'Traffic (monthly visits)'],
  ['backlinks', 'Backlinks'],
  ['refdomains', 'Referring domains'],
  ['refips', 'Referring IPs'],
  ['rank', 'Global rank'],
];

const EXTRACTORS: Extractor[] = [
  { metric: 'da', type: 'moz_authority', source: 'Moz', pick: (d) => d.site?.domainAuthority },
  { metric: 'da', type: 'mangools_sp_overview', source: 'Mangools', pick: (d) => d.authority?.domainAuthority },
  { metric: 'da', type: 'mangools_siteprofiler', source: 'Mangools SiteProfiler', pick: (d) => d.authority?.domainAuthority },
  { metric: 'pa', type: 'moz_authority', source: 'Moz', pick: (d) => d.site?.pageAuthority },
  { metric: 'pa', type: 'mangools_sp_overview', source: 'Mangools', pick: (d) => d.authority?.pageAuthority },
  { metric: 'pa', type: 'mangools_siteprofiler', source: 'Mangools SiteProfiler', pick: (d) => d.authority?.pageAuthority },
  { metric: 'dr', type: 'ahrefs_domain_rating', source: 'Ahrefs', pick: (d) => d.site?.domainRating },
  { metric: 'dr', type: 'aitdk_backlinks', source: 'AITDK', pick: (d) => d.domainRating },
  { metric: 'cf', type: 'mangools_sp_overview', source: 'Mangools', pick: (d) => d.authority?.citationFlow },
  { metric: 'cf', type: 'mangools_sp_backlinks', source: 'Mangools backlinks', pick: (d) => d.flow?.citationFlow },
  { metric: 'cf', type: 'mangools_siteprofiler', source: 'Mangools SiteProfiler', pick: (d) => d.authority?.citationFlow },
  { metric: 'tf', type: 'mangools_sp_overview', source: 'Mangools', pick: (d) => d.authority?.trustFlow },
  { metric: 'tf', type: 'mangools_sp_backlinks', source: 'Mangools backlinks', pick: (d) => d.flow?.trustFlow },
  { metric: 'tf', type: 'mangools_siteprofiler', source: 'Mangools SiteProfiler', pick: (d) => d.authority?.trustFlow },
  { metric: 'traffic', type: 'aitdk_traffic', source: 'AITDK', pick: (d) => d.monthlyVisits },
  { metric: 'traffic', type: 'mangools_sp_overview', source: 'Mangools', pick: (d) => d.organic?.estimatedTraffic },
  { metric: 'backlinks', type: 'mangools_sp_backlinks', source: 'Mangools backlinks', pick: (d) => d.backlinks?.total },
  { metric: 'backlinks', type: 'mangools_siteprofiler', source: 'Mangools SiteProfiler', pick: (d) => d.backlinks?.total },
  { metric: 'backlinks', type: 'aitdk_backlinks', source: 'AITDK', pick: (d) => d.backlinks },
  { metric: 'backlinks', type: 'moz_authority', source: 'Moz', pick: (d) => d.site?.links },
  { metric: 'refdomains', type: 'moz_authority', source: 'Moz', pick: (d) => d.site?.linkingDomains },
  { metric: 'refdomains', type: 'mangools_sp_backlinks', source: 'Mangools backlinks', pick: (d) => d.referring?.domains },
  { metric: 'refdomains', type: 'mangools_siteprofiler', source: 'Mangools SiteProfiler', pick: (d) => d.referring?.domains },
  { metric: 'refdomains', type: 'aitdk_backlinks', source: 'AITDK', pick: (d) => d.refDomains },
  { metric: 'refips', type: 'mangools_sp_overview', source: 'Mangools', pick: (d) => d.referringIps },
  { metric: 'refips', type: 'mangools_sp_backlinks', source: 'Mangools backlinks', pick: (d) => d.referring?.ips },
  { metric: 'refips', type: 'mangools_siteprofiler', source: 'Mangools SiteProfiler', pick: (d) => d.referring?.ips ?? d.referringIps },
  { metric: 'rank', type: 'aitdk_traffic', source: 'AITDK', pick: (d) => d.globalRank },
];

const fmt = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v.toLocaleString('en-US') : null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// "1,234" / "1.2K" / "3M" -> number, otherwise null (e.g. "N/A").
export function parseMetric(v: string): number | null {
  const m = /^([\d.,]+)\s*([kKmM])?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!isFinite(n)) return null;
  return n * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1);
}

// Every metric that at least one source reported, with each source's own value. Uploaded screenshots are marked
// "(screenshot)", automatic API rows "(API)". `differs` is true when two sources give clearly different numbers.
export function collectMetrics(evidence: AuditEvidence[]): MetricRow[] {
  const usable = evidence.filter((e) => e.extracted && (e.status === 'approved' || e.status === 'extracted'));
  const newest = new Map<string, AuditEvidence>();
  for (const e of [...usable].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) newest.set(e.evidenceType, e);
  const rows: MetricRow[] = [];
  for (const [key, label] of METRICS) {
    const cells: MetricCell[] = [];
    for (const x of EXTRACTORS.filter((r) => r.metric === key)) {
      const e = newest.get(x.type);
      if (!e) continue;
      const value = fmt(x.pick(e.extracted));
      if (value == null) continue;
      cells.push({ source: `${x.source} (${e.section === 'auto' ? 'API' : 'screenshot'})`, value });
    }
    if (!cells.length) continue;
    const nums = cells.map((c) => parseMetric(c.value)).filter((n): n is number => n != null);
    const differs = nums.length > 1 && (Math.max(...nums) - Math.min(...nums)) / Math.max(1, Math.max(...nums)) > 0.02;
    rows.push({ key, label, cells, differs });
  }
  return rows;
}

const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Compact one-line-per-metric comparison for the task list: "DA: Moz 23 | Mangools 25".
export function metricsSummary(rows: MetricRow[]): string[] {
  return rows.map((r) => `${r.label}: ${r.cells.map((c) => `${c.source} ${c.value}`).join(' | ')}${r.differs ? ' (differs)' : ''}`);
}

// Metric x source table for the admin Layer mapping: one row per metric, one column per source.
export function renderMetricCompare(rows: MetricRow[], heading = 'Authority, traffic and backlinks - all sources compared'): string {
  if (!rows.length) return '';
  const sources: string[] = [];
  rows.forEach((r) => r.cells.forEach((c) => !sources.includes(c.source) && sources.push(c.source)));
  const head = `<tr><th>Metric</th>${sources.map((s) => `<th>${esc(s)}</th>`).join('')}<th>Sources agree?</th></tr>`;
  const body = rows
    .map((r) => {
      const by = new Map(r.cells.map((c) => [c.source, c.value]));
      const agree = r.cells.length < 2 ? 'Only one source' : r.differs ? 'No - values differ' : 'Yes';
      return `<tr><td>${esc(r.label)}</td>${sources.map((s) => `<td>${esc(by.get(s) ?? '—')}</td>`).join('')}<td>${esc(agree)}</td></tr>`;
    })
    .join('');
  return `<div class="layer-card"><h3>${esc(heading)}</h3><p class="muted">Each tool's own number, side by side. Nothing is merged: the customer report shows each source's data as it is.</p><div class="task-scroll" style="overflow-x:auto"><table><thead>${head}</thead><tbody>${body}</tbody></table></div></div>`;
}
