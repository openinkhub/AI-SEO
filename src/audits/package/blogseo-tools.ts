// BlogSEO connector tools the admin uses for the monthly audit (free tools). They run from Claude, not from the Engine server,
// so the admin records each result in the Layer 3 "To-do for this month cycle" card. Shown in admin Strategy; fed to the strategy writer.

export interface BlogSeoTool {
  key: string;
  tool: string;
  use: string;
  how: string;
}

export const BLOGSEO_TOOLS: BlogSeoTool[] = [
  { key: 'domain-rating', tool: 'Domain Rating', use: 'Pull DR for the customer and 3-5 competitors.', how: 'check_domain_rating (free). Record the customer DR and the competitor range in the to-do note.' },
  { key: 'keyword-density', tool: 'Keyword density', use: 'Check density of the main keyword on key pages.', how: 'check_keyword_density (free). Paste the page text if the URL is blocked (some sites return 403 to its fetcher). Aim for a natural 0.5-2%.' },
  { key: 'seo-score', tool: 'Content SEO score', use: 'Score a blog post or page draft before it is published.', how: 'check_seo_score (needs the website activated on the BlogSEO plan). Fix anything under 80 before publishing.' },
  { key: 'competitor-dr', tool: 'Competitor DR benchmark', use: 'Compare the customer against the competitors that outrank it.', how: 'check_domain_rating per competitor; record the gap and feed it into the DA/DR target plan.' },
];

// Dated snapshot taken on the first run (openinkhub.io). Refresh it each month cycle.
export const BLOGSEO_SNAPSHOT = {
  date: '2026-10',
  site: 'openinkhub.io',
  ownDr: 11,
  ownDaMangools: 42,
  competitors: [
    { domain: 'seoindiaonline.com', dr: 36 },
    { domain: 'realmarketingsolutions.net', dr: 35 },
    { domain: 'tangence.in', dr: 43 },
    { domain: 'gravitywrite.com', dr: 66 },
    { domain: 'contently.com', dr: 83 },
  ],
  notes: [
    'Keyword density, home page text: 0.77% (within the natural range).',
    'BlogSEO’s page fetcher received 403 from openinkhub.io; text mode works. Check that the site does not block unknown crawlers.',
    'Content SEO score and the other paid tools need the website activated on a BlogSEO plan (use openinkhub.cloud, not .io).',
  ],
};

export function blogSeoAsPromptText(): string {
  const s = BLOGSEO_SNAPSHOT;
  return [
    ...BLOGSEO_TOOLS.map((t) => `- ${t.tool}: ${t.use}`),
    `Latest benchmark (${s.date}): ${s.site} DR ${s.ownDr} (Mangools DA ${s.ownDaMangools}) vs ` + s.competitors.map((c) => `${c.domain} ${c.dr}`).join(', ') + '.',
    ...s.notes.map((n) => `- ${n}`),
  ].join('\n');
}
