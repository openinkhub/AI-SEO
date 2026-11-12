// The 70 SEO audit parameters (from the "WP SEO Plugin" parameter list). Every crawled page is checked against all of
// them and the root domain gets its own result per parameter. `standard` is the pass rule shown in the report.
export type St = 'p' | 'w' | 'f' | 'i' | 'n'; // pass, warning, fail, info (measured, not scored), not applicable / not measured

export interface Rule {
  id: number;
  s: St;
  v: string; // what was found
  f?: string; // what to change on the website (only when not a pass)
  ex?: string[]; // example URLs (root domain rows)
  n?: { f: number; w: number; t: number }; // root domain rows: pages failing / warning / checked
}

export interface Param {
  id: number;
  name: string;
  group: string;
  standard: string;
  weight: number; // 2 = counts double in the page score
}

const P = (id: number, name: string, group: string, standard: string, weight = 1): Param => ({ id, name, group, standard, weight });

export const PARAMS: Param[] = [
  P(1, 'Page name', 'Content & metadata', 'Every page has a clear name (H1 or title) that says what it is about.'),
  P(2, 'Publish date', 'Content & metadata', 'Articles show a publish date, also in Article schema (datePublished).'),
  P(3, 'Author', 'Trust & authority', 'Articles name a real author, shown on the page and in Article schema.'),
  P(4, 'SEO Title', 'Content & metadata', 'Unique, 30-60 characters (about 600px), main keyphrase near the start.', 2),
  P(5, 'Slug', 'Content & metadata', 'Short (under 60 characters), lowercase, hyphenated, contains the keyphrase, no parameters.'),
  P(6, 'Meta Description', 'Content & metadata', 'Unique, 70-160 characters, contains the keyphrase and a reason to click.', 2),
  P(7, 'Keyphrase', 'Keywords & relevance', 'One focus keyphrase per page, placed in the title, H1, meta description, URL and first paragraph.'),
  P(8, 'Canonical URL', 'Indexing & crawling', 'Every indexable page has one absolute, self-referencing canonical on the same host and protocol.', 2),
  P(9, 'Hero Image', 'Content & metadata', 'A hero / social image exists, has alt text and width / height, is a modern format and is not lazy-loaded.'),
  P(10, 'H1 Heading', 'Content & metadata', 'Exactly one H1, under 70 characters, containing the keyphrase.', 2),
  P(11, 'Google Indexing', 'Indexing & crawling', 'Returns 200, no noindex, canonical to itself, not blocked by robots.txt.', 2),
  P(12, 'Authority Signal', 'Trust & authority', 'Cites authoritative sources, names an author or date, and the organisation is tied to its profiles (sameAs).'),
  P(13, 'Trust Signal', 'Trust & authority', 'HTTPS, links to About / Contact / Privacy, visible phone or address, reviews or testimonials.'),
  P(14, 'Insert in Sitemap.xml', 'Indexing & crawling', 'Every indexable page is in the XML sitemap; noindex pages are not.', 2),
  P(15, 'Follow', 'Indexing & crawling', 'Pages that should rank are not set to nofollow.'),
  P(16, 'SEO Score', 'Scores', 'Weighted result of all SEO parameters for this page (80+ is good).'),
  P(17, 'Readability Score', 'Scores', 'Result of the readability parameters 24-31 for this page (80+ is good).'),
  P(18, 'Outbound Links', 'Links', 'Content pages link out to at least one relevant, trustworthy external page.'),
  P(19, 'Internal Links', 'Links', 'At least 3 internal links out and at least 1 link in from another page.'),
  P(20, 'Crawling', 'Indexing & crawling', 'Crawlers can fetch the page: allowed by robots.txt, fast response, within 3 clicks of the homepage.'),
  P(21, 'Submit to LLM', 'AI search', 'AI crawlers are allowed, the content is in the HTML (not JavaScript only) and key pages are listed in llms.txt.'),
  P(22, 'SERP View', 'Content & metadata', 'Title and description fit the Google result without being cut (about 600px / 1000px).'),
  P(23, 'Edit Excerpt', 'Content & metadata', 'The excerpt / description is written by hand, not copied from the first lines of the page or the title.'),
  P(24, 'Word Complexity', 'Readability', 'No more than 10% difficult words (3+ syllables).'),
  P(25, 'Transition word', 'Readability', 'At least 30% of sentences contain a transition word.'),
  P(26, 'Passive Voice', 'Readability', 'No more than 10% of sentences are passive.'),
  P(27, 'Consecutive Sentence', 'Readability', 'No run of 3 or more sentences starting with the same word.'),
  P(28, 'Inclusive language', 'Readability', 'No non-inclusive or outdated terms.'),
  P(29, 'Subheading Distribution', 'Readability', 'No stretch of more than 300 words without a subheading.'),
  P(30, 'Paragraph Length', 'Readability', 'Paragraphs under 150 words, average under 120.'),
  P(31, 'Sentence Length', 'Readability', 'No more than 25% of sentences longer than 20 words.'),
  P(32, 'Word Count', 'Content & metadata', 'Enough content for the page type: articles 600+, service pages 500+, other pages 300+ words.'),
  P(33, 'Text to Image ratio', 'Content & metadata', 'Images support the text (about one per 100-500 words) and the page is not mostly code (text-to-HTML 10%+).'),
  P(34, 'Schema', 'Structured data', 'The page has structured data with no missing required fields.', 2),
  P(35, 'JSON-LD', 'Structured data', 'Structured data is valid JSON-LD with @context https://schema.org.'),
  P(36, 'Custom Schema', 'Structured data', 'A schema type specific to the page (Article, Service, Product, FAQPage, ContactPage...) is present, not only WebPage.'),
  P(37, 'Open Graph', 'Social', 'og:title, og:description, og:image, og:url and og:type are set.'),
  P(38, 'Twitter Card', 'Social', 'twitter:card (summary_large_image) is set.'),
  P(39, 'View Port Images', 'Performance', 'Mobile viewport tag, responsive images (srcset), width / height set, the first image not lazy-loaded.'),
  P(40, 'Redirects', 'Technical', 'The URL answers directly (no redirect); never a chain of 2+ hops.'),
  P(41, 'Not found', 'Technical', 'The page returns 200; missing URLs return a real 404.', 2),
  P(42, 'Broken Link', 'Technical', 'No broken internal or external links on the page.', 2),
  P(43, 'Robots.txt', 'Indexing & crawling', 'robots.txt exists, allows search and AI crawlers, and declares the sitemap.'),
  P(44, 'Llms.txt', 'AI search', '/llms.txt exists, is well formed and lists the key pages.'),
  P(45, 'Page Speed', 'Performance', 'Google PageSpeed mobile score 90+ (50-89 needs work).', 2),
  P(46, 'Largest Contentful Paint', 'Performance', 'LCP 2.5 seconds or less.'),
  P(47, 'Interaction to Next Paint', 'Performance', 'INP 200 ms or less (Total Blocking Time 200 ms or less when no field data).'),
  P(48, 'Cumulative Layout Shift', 'Performance', 'CLS 0.1 or less.'),
  P(49, 'Time to First Byte', 'Performance', 'Server response 800 ms or less.'),
  P(50, 'First Contentful Paint', 'Performance', 'FCP 1.8 seconds or less.'),
  P(51, 'Frontend JavaScript issues', 'Performance', 'No render-blocking scripts in the head, no document.write, no jQuery below v3, under 30 script files.'),
  P(52, 'CSS Errors', 'Performance', 'Stylesheets load (no 404), no @import, under 12 files, little inline styling.'),
  P(53, 'Crawl Depth', 'Indexing & crawling', 'Reachable within 3 clicks of the homepage.'),
  P(54, 'Keyword Density', 'Keywords & relevance', 'Keyphrase used on 0.5-2.5% of the words (not stuffed).'),
  P(55, 'Semantic Keyword Coverage', 'Keywords & relevance', 'The page covers the topic with related terms and subheadings, not only the exact keyphrase.'),
  P(56, 'Search Intent Match', 'Keywords & relevance', 'The page type matches what the keyphrase is searched for (answer, compare, buy, local).'),
  P(57, 'Topical Relevance', 'Keywords & relevance', 'Title, H1, URL, description, opening paragraph and subheadings all stay on the same topic.'),
  P(58, 'Content Freshness', 'Content quality', 'Updated within the last 12 months, with the date shown.'),
  P(59, 'Content Uniqueness', 'Content quality', 'No identical or near-identical (80%+) copy of another page on the site.', 2),
  P(60, 'Cannibalization', 'Content quality', 'Only one page targets each keyphrase.'),
  P(61, 'FAQ Optimization', 'AI search', 'Question-style subheadings with short direct answers (3+ questions) on pages that answer buyer questions.'),
  P(62, 'Entity Coverage', 'Keywords & relevance', 'Names the key people, places, brands and concepts of the topic (6+ entities).'),
  P(63, 'Anchor Text Distribution', 'Links', 'Internal link text is descriptive: under 20% generic, no one anchor over 40% of links.'),
  P(64, 'Schema Entity Consistency', 'Structured data', 'The organisation name and URL are identical in every schema block on every page.'),
  P(65, 'Breadcrumb Schema', 'Structured data', 'Inner pages have valid BreadcrumbList schema.'),
  P(66, 'Article Schema', 'Structured data', 'Articles have Article / BlogPosting schema with headline, author and dates.'),
  P(67, 'Organization Schema', 'Structured data', 'The homepage has Organization / LocalBusiness schema with name, url, logo and sameAs.'),
  P(68, 'Author Schema', 'Structured data', 'Articles identify the author as a Person in schema.'),
  P(69, 'FAQ Schema Validation', 'Structured data', 'FAQ content has valid FAQPage schema (every question has an accepted answer).'),
  P(70, 'Excerpt', 'Content & metadata', 'An excerpt / description of 70-160 characters exists for search and social previews.'),
  // Agent readiness (site-level checks, root domain only): can an AI agent read, understand and use the site?
  P(71, 'Content Signals declared', 'Agent readiness', 'robots.txt has a Content-Signal line saying how content may be used (for example search=yes, ai-train=no).', 0.5),
  P(72, 'Missing pages return a real 404', 'Agent readiness', 'A URL that does not exist answers HTTP 404 or 410, never 200.', 0.5),
  P(73, 'Business schema complete', 'Agent readiness', 'The homepage Organization / LocalBusiness schema has name, url, logo, telephone and address.'),
  P(74, 'Entity linked via sameAs', 'Agent readiness', 'The business schema lists sameAs links to the official social and directory profiles (2 or more).'),
  P(75, 'About, contact and legal pages linked', 'Agent readiness', 'The homepage links to an about page, a contact page and a legal page (privacy / terms).'),
  P(76, 'llms.txt well-formed', 'Agent readiness', 'llms.txt starts with "# Title", has a "> summary" line, then sections of markdown links to the key pages.', 0.5),
  P(77, 'Serves Markdown on request', 'Agent readiness', 'A request with Accept: text/markdown returns a Markdown version of the page.', 0.5),
  P(78, 'WebMCP tools exposed', 'Agent readiness', 'The page registers tools for in-browser agents (navigator.modelContext.registerTool or toolname / tooldescription form attributes).', 0.5),
  P(79, 'MCP Server Card published', 'Agent readiness', '/.well-known/mcp/server-card.json returns JSON with name, version and an endpoint URL.', 0.5),
  P(80, 'Google Preferred Sources link', 'Agent readiness', 'The site gives readers a one-click link or button to add it as a Google Preferred Source (google.com/preferences/source?q=your-domain). Preferred sources get a badge in Top Stories, AI Overviews and AI Mode.', 0.5),
];

export const PARAM_BY_ID = new Map(PARAMS.map((p) => [p.id, p]));
export const GROUPS = [...new Set(PARAMS.map((p) => p.group))];
export const READABILITY_IDS = [24, 25, 26, 27, 28, 29, 30, 31];

// --- helpers shared by the rule engine and the report ---------------------------------------------------------------

const NARROW = new Set("iIl.,:;'|!()[]/ ".split(''));
// Rough Arial width at the given font size. Google cuts a title at about 600px (20px font) and a description at about
// 960px (14px font) on desktop, so this tells whether a snippet is likely to be cut. It is an estimate, not Google's own measure.
export function pixelWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += (NARROW.has(ch) ? 0.28 : /[mwMW@%]/.test(ch) ? 0.88 : /[A-Z]/.test(ch) ? 0.66 : /[0-9]/.test(ch) ? 0.56 : 0.5) * size;
  return Math.round(w);
}

export const statusWord = (s: St): string => (s === 'p' ? 'Pass' : s === 'w' ? 'Warning' : s === 'f' ? 'Fix' : s === 'i' ? 'Info' : 'Not measured');

export function scoreRules(rules: Rule[], ids?: number[]): number | null {
  let got = 0;
  let max = 0;
  for (const r of rules) {
    if (ids && !ids.includes(r.id)) continue;
    if (r.s === 'i' || r.s === 'n' || r.id === 16 || r.id === 17) continue;
    const w = PARAM_BY_ID.get(r.id)?.weight ?? 1;
    max += w;
    got += w * (r.s === 'p' ? 1 : r.s === 'w' ? 0.5 : 0);
  }
  return max ? Math.round((got / max) * 100) : null;
}
