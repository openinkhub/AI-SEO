
// Location page check (from the Location Page Ranking Tracker plan): for each service area / city on the customer
// profile, find the page that targets it on the crawled site and check what that page needs to rank locally.
import { CrawledPage } from './site-crawl';

export interface LocationPageResult {
  location: string;
  page: string | null;
  checks: Array<{ check: string; ok: boolean }>;
  score: number;
  missing: string[];
}

export interface LocationAudit {
  locations: LocationPageResult[];
  withoutPage: string[];
  notes: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function auditLocationPages(pages: CrawledPage[], locations: string[]): LocationAudit {
  const ok = pages.filter((p) => p.status === 200 && !p.noindex);
  const out: LocationPageResult[] = [];
  const without: string[] = [];
  for (const loc of [...new Set(locations.map((l) => l.trim()).filter(Boolean))].slice(0, 12)) {
    const s = slug(loc);
    const has = (t: string | null | undefined) => !!t && t.toLowerCase().includes(loc.toLowerCase());
    // best candidate: location in the URL, else in the H1, else in the title
    const cands = ok
      .map((p) => ({ p, score: (p.url.toLowerCase().includes(s) ? 4 : 0) + (p.h1.some((h) => has(h)) ? 2 : 0) + (has(p.title) ? 1 : 0) }))
      .filter((c) => c.score > 0 && c.p.depth > 0)
      .sort((a, b) => b.score - a.score || b.p.words - a.p.words);
    const best = cands[0]?.p;
    if (!best) {
      without.push(loc);
      continue;
    }
    const checks = [
      { check: `Location in the URL`, ok: best.url.toLowerCase().includes(s) },
      { check: 'Location in the title', ok: has(best.title) },
      { check: 'Location in the H1', ok: best.h1.some((h) => has(h)) },
      { check: 'Location in the meta description', ok: has(best.metaDescription) },
      { check: 'At least 500 words of unique content', ok: best.words >= 500 },
      { check: 'LocalBusiness / Organization schema', ok: best.schemaTypes.some((t) => /LocalBusiness|Organization|Service|ProfessionalService/.test(t)) },
      { check: 'Address or NAP on the page', ok: best.local.address },
      { check: 'Phone number on the page', ok: best.local.phone },
      { check: 'Map embedded', ok: best.local.map },
      { check: 'Reviews or testimonials shown', ok: best.local.reviews },
      { check: 'FAQ or question headings', ok: best.ai.faqSchema || best.ai.questionHeadings > 0 },
      { check: 'At least 3 internal links point to the page', ok: best.inbound >= 3 },
    ];
    const good = checks.filter((c) => c.ok).length;
    out.push({ location: loc, page: best.url, checks, score: Math.round((good / checks.length) * 100), missing: checks.filter((c) => !c.ok).map((c) => c.check) });
  }
  return { locations: out, withoutPage: without, notes: without.length ? [`No page on the site clearly targets: ${without.join(', ')}. Each service area needs its own page.`] : [] };
}
