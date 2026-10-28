// Google Search Console research. The data itself is pulled by the WordPress plugin (route
// aiseo/v1/engine-export/gsc/<wp_user_id>, plugin >= 8.9.277) through the common Google account, so the Engine needs
// no Google OAuth of its own. This file turns that raw export into the findings the GSC audit tasks need.

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number; // percent
  position: number;
}

export interface GscFetchResult {
  ok: boolean;
  status: number | null;
  data: any;
  error: string | null;
}

// Rough organic CTR by position (share, not percent) - used only to size opportunities, never shown as fact.
const CTR_CURVE = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const curve = (pos: number): number => (pos <= 10 ? CTR_CURVE[Math.max(0, Math.round(pos) - 1)] : pos <= 20 ? 0.01 : 0.004);

const pctChange = (now: number, prev: number): number | null => (prev > 0 ? Math.round(((now - prev) / prev) * 1000) / 10 : null);
const sumTotals = (rows: GscRow[]) => {
  const r = rows?.[0];
  return r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : null;
};

export async function fetchGscExport(
  get: (path: string) => Promise<GscFetchResult>,
  wpUserId: string | null | undefined,
  site: string,
  property?: string,
): Promise<Record<string, any>> {
  if (!wpUserId) throw new Error('This customer has no WordPress user id yet (sync the WP customer first), so Search Console cannot be requested.');
  const q = `site=${encodeURIComponent(site)}&inspect=6${property ? `&property=${encodeURIComponent(property)}` : ''}`;
  const res = await get(`/wp-json/aiseo/v1/engine-export/gsc/${encodeURIComponent(wpUserId)}?${q}`);
  if (res.status === 404) throw new Error('The WordPress plugin has no Search Console route - install AI-SEO plugin v8.9.277 or newer.');
  if (!res.ok || !res.data) throw new Error(`WordPress did not return Search Console data: ${res.error ?? `HTTP ${res.status}`}`.slice(0, 220));
  if (res.data.ok === false) throw new Error(String(res.data.message || res.data.error || 'Search Console request failed').slice(0, 220));
  return res.data;
}

export function analyseGsc(raw: Record<string, any>): Record<string, any> {
  const queries: GscRow[] = raw.queries ?? [];
  const pages: GscRow[] = raw.pages ?? [];
  const prevPages: GscRow[] = raw.prevPages ?? [];
  const qp: GscRow[] = raw.queryPages ?? [];
  const totals = sumTotals(raw.totals ?? []);
  const prev = sumTotals(raw.prevTotals ?? []);

  const prevByPage = new Map(prevPages.map((r) => [r.keys[0], r]));
  const topPages = pages.slice(0, 25).map((r) => {
    const p = prevByPage.get(r.keys[0]);
    return { page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, prevClicks: p?.clicks ?? null, change: p ? pctChange(r.clicks, p.clicks) : null };
  });

  // Quick wins: already ranking 4-20 with real impressions - moving to ~3 is worth the most extra clicks.
  const quickWins = queries
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 30)
    .map((r) => ({ query: r.keys[0], position: r.position, impressions: r.impressions, clicks: r.clicks, extraClicksIfTop3: Math.max(0, Math.round(r.impressions * CTR_CURVE[2] - r.clicks)) }))
    .filter((r) => r.extraClicksIfTop3 > 0)
    .sort((a, b) => b.extraClicksIfTop3 - a.extraClicksIfTop3)
    .slice(0, 15);

  // CTR underperformers: top-10 ranking but far fewer clicks than that position normally earns (weak title/description).
  const lowCtr = queries
    .filter((r) => r.position <= 10 && r.impressions >= 50 && r.ctr / 100 < curve(r.position) * 0.5)
    .map((r) => ({ query: r.keys[0], position: r.position, impressions: r.impressions, ctr: r.ctr, expectedCtr: Math.round(curve(r.position) * 1000) / 10 }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  // Cannibalization: one query answered by two or more of the site's own pages.
  const byQuery = new Map<string, GscRow[]>();
  for (const r of qp) byQuery.set(r.keys[0], [...(byQuery.get(r.keys[0]) ?? []), r]);
  const cannibalization = [...byQuery.entries()]
    .map(([query, rows]) => ({ query, rows: rows.filter((r) => r.impressions >= 5).sort((a, b) => b.impressions - a.impressions) }))
    .filter((x) => x.rows.length >= 2 && x.rows.reduce((s, r) => s + r.impressions, 0) >= 30)
    .map((x) => ({ query: x.query, impressions: x.rows.reduce((s, r) => s + r.impressions, 0), pages: x.rows.slice(0, 4).map((r) => ({ page: r.keys[1], position: r.position, clicks: r.clicks, impressions: r.impressions })) }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  // Decaying pages: clearly less traffic than the previous equal period.
  const nowByPage = new Map(pages.map((r) => [r.keys[0], r]));
  const decaying = prevPages
    .filter((p) => p.clicks >= 5)
    .map((p) => {
      const n = nowByPage.get(p.keys[0]);
      return { page: p.keys[0], prevClicks: p.clicks, clicks: n?.clicks ?? 0, lost: p.clicks - (n?.clicks ?? 0), change: pctChange(n?.clicks ?? 0, p.clicks), position: n?.position ?? null, prevPosition: p.position };
    })
    .filter((x) => x.clicks <= x.prevClicks * 0.7)
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 10);

  const inspections: Array<Record<string, any>> = raw.inspections ?? [];
  const notIndexed = inspections.filter((i) => i.verdict && i.verdict !== 'PASS').map((i) => ({ url: i.url, verdict: i.verdict, coverage: i.coverageState, robots: i.robotsTxtState, fetch: i.pageFetchState }));
  const canonicalMismatch = inspections.filter((i) => i.googleCanonical && i.userCanonical && i.googleCanonical !== i.userCanonical).map((i) => ({ url: i.url, google: i.googleCanonical, declared: i.userCanonical }));
  const sitemaps = ((raw.sitemaps ?? []) as Array<Record<string, any>>).map((s) => ({ ...s, indexedShare: s.submitted > 0 ? Math.round((s.indexed / s.submitted) * 100) : null }));

  return {
    property: raw.property,
    googleAccount: raw.google_account,
    period: raw.period,
    totals,
    previousTotals: prev,
    change: totals && prev ? { clicks: pctChange(totals.clicks, prev.clicks), impressions: pctChange(totals.impressions, prev.impressions), position: Math.round((totals.position - prev.position) * 10) / 10 } : null,
    topQueries: queries.slice(0, 25).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    topPages,
    quickWins,
    lowCtr,
    cannibalization,
    decaying,
    indexing: { inspected: inspections.length, notIndexed, canonicalMismatch, sample: inspections.map((i) => ({ url: i.url, verdict: i.verdict, coverage: i.coverageState, lastCrawl: i.lastCrawlTime, mobile: i.mobileVerdict })) },
    sitemaps,
    devices: (raw.devices ?? []).map((r: GscRow) => ({ device: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    countries: (raw.countries ?? []).map((r: GscRow) => ({ country: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
    notes: Object.entries((raw.errors ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${String(v).slice(0, 140)}`),
  };
}
