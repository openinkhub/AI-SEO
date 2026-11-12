// Google PageSpeed Insights v5 (mobile). Used by the SEO Audit when the customer has a key set.
export interface PageSpeedResult {
  strategy: 'mobile';
  url: string;
  scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  metrics: Array<{ label: string; value: string }>;
  opportunities: Array<{ title: string; savings: string }>;
}

const score = (c: any, id: string): number | null => (c?.[id]?.score != null ? Math.round(c[id].score * 100) : null);

export async function runPageSpeed(url: string, apiKey: string, timeoutMs = 60000): Promise<PageSpeedResult> {
  const q = new URLSearchParams({ url, key: apiKey, strategy: 'mobile' });
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((c) => q.append('category', c));
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`, { signal: AbortSignal.timeout(timeoutMs) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `PageSpeed API returned HTTP ${res.status}`);
  const lh = body.lighthouseResult ?? {};
  const cats = lh.categories ?? {};
  const audits = lh.audits ?? {};
  const metric = (id: string, label: string) => (audits[id]?.displayValue ? { label, value: String(audits[id].displayValue) } : null);
  const opps = Object.values<any>(audits)
    .filter((a) => a?.details?.type === 'opportunity' && (a.details.overallSavingsMs ?? 0) > 200)
    .sort((a, b) => b.details.overallSavingsMs - a.details.overallSavingsMs)
    .slice(0, 6)
    .map((a) => ({ title: String(a.title), savings: `${Math.round(a.details.overallSavingsMs)} ms` }));
  return {
    strategy: 'mobile',
    url,
    scores: { performance: score(cats, 'performance'), accessibility: score(cats, 'accessibility'), bestPractices: score(cats, 'best-practices'), seo: score(cats, 'seo') },
    metrics: [
      metric('first-contentful-paint', 'First Contentful Paint'),
      metric('largest-contentful-paint', 'Largest Contentful Paint'),
      metric('total-blocking-time', 'Total Blocking Time'),
      metric('cumulative-layout-shift', 'Cumulative Layout Shift'),
      metric('speed-index', 'Speed Index'),
    ].filter((m): m is { label: string; value: string } => !!m),
    opportunities: opps,
  };
}

// Numeric detail for one page (the per-page audit): the Core Web Vitals and speed numbers behind parameters 45-50.
export interface PageSpeedDetail {
  url: string;
  perf: number | null;
  lcpMs: number | null;
  fcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  inpMs: number | null; // real-user (field) data, only when Google has enough visits for this URL
  ttfbMs: number | null;
}

export async function runPageSpeedDetail(url: string, apiKey: string, timeoutMs = 60000): Promise<PageSpeedDetail> {
  const q = new URLSearchParams({ url, key: apiKey, strategy: 'mobile', category: 'performance' });
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`, { signal: AbortSignal.timeout(timeoutMs) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `PageSpeed API returned HTTP ${res.status}`);
  const lh = body.lighthouseResult ?? {};
  const a = lh.audits ?? {};
  const num = (id: string): number | null => (typeof a[id]?.numericValue === 'number' ? Math.round(a[id].numericValue * 1000) / 1000 : null);
  const field = body.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile;
  return {
    url,
    perf: lh.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null,
    lcpMs: num('largest-contentful-paint'),
    fcpMs: num('first-contentful-paint'),
    cls: num('cumulative-layout-shift'),
    tbtMs: num('total-blocking-time'),
    inpMs: typeof field === 'number' ? field : null,
    ttfbMs: num('server-response-time'),
  };
}
