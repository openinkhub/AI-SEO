// The 70-parameter audit: every crawled page is checked against every parameter, and the root domain gets its own row per
// parameter. Each failing row carries the change to make on the website. Everything here is deterministic (no AI cost).
import type { PageSpeedDetail } from '../../customer-apis/pagespeed';
import { Robots, robotsAllows } from './crawl-http';
import { PageRecord } from './page-analysis';
import { decodeEntities as dec, similarity } from './page-content';
import { PARAMS, PARAM_BY_ID, READABILITY_IDS, Rule, St, pixelWidth, scoreRules } from './page-params';
import { SiteChecks } from './site-checks';

export interface PageAuditPage {
  url: string;
  status: number | null;
  title: string | null;
  type: string;
  ms: number;
  unsized: number;
  score: number | null;
  seo: number | null;
  read: number | null;
  fix: number;
  warn: number;
  rules: Rule[];
}

export interface PageAuditResult {
  site: string;
  generatedAt: string;
  pagesAudited: number;
  scores: { site: number | null; avgPage: number | null; pagesToFix: number; pagesClean: number };
  root: Rule[];
  fixes: Array<{ id: number; name: string; s: St; pages: number; fix: string; ex: string[] }>;
  siteIssues: Array<{ severity: string; area: string; title: string; fix: string; count: number; examples: string[] }>;
  pages: PageAuditPage[];
  psi: { tested: number; homepage: PageSpeedDetail | null } | null;
  speedSample: string[]; // the pages that get a full Google PageSpeed test (homepage first)
  notes: string[];
}

export interface AuditInput {
  origin: string;
  pages: PageRecord[]; // with .links and .deep still attached
  checks: SiteChecks;
  robots: Robots;
  brokenLinks: Array<{ url: string; status: number | string; foundOn: string }>;
  assetStatus: Map<string, number>; // css / js files checked once for the whole site
  complete: boolean; // the crawl covered every discovered page (orphan detection is only valid then)
  crawl: { limit: number; seconds: number; stoppedEarly: boolean; discoveredNotCrawled: number; blockedByRobots: number };
  issues: PageAuditResult['siteIssues'];
  psi?: Map<string, PageSpeedDetail>;
}

const bare = (u: string): string => u.split('#')[0].replace(/\/$/, '');
const pathOf = (u: string): string => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return '/';
  }
};
const CORE_AI = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 3) + '...' : s);
const GENERIC_NAME = /^(home|untitled|page|new page|welcome|index)$/i;

interface Ctx {
  input: AuditInput;
  robots: Robots;
  checks: SiteChecks;
  complete: boolean;
  titleDup: Map<string, number>;
  metaDup: Map<string, number>;
  hashDup: Map<string, number>;
  nearest: Map<string, { url: string; sim: number }>;
  cannibal: Map<string, string[]>;
  mainOrg: string;
  orgCount: number;
  llms: Set<string>;
  brokenOn: Map<string, string[]>;
  psi: Map<string, PageSpeedDetail>;
  psiSample: number;
}

const grade = (list: Array<[St, string]>): { s: St; f: string } => ({
  s: list.some(([s]) => s === 'f') ? 'f' : list.some(([s]) => s === 'w') ? 'w' : 'p',
  f: list.map(([, t]) => t).join(' '),
});

// ---- speed rules (45-50): also used again when PageSpeed results arrive after the crawl --------------------------------------

export function speedRules(ms: number, unsized: number, d: PageSpeedDetail | undefined, sample: number): Rule[] {
  const out: Rule[] = [];
  const add = (id: number, s: St, v: string, f?: string) => out.push({ id, s, v, ...(f && s !== 'p' && s !== 'i' && s !== 'n' ? { f } : {}) });
  const SPEED = 'Compress and convert images to WebP/AVIF at the displayed size, defer or remove unused JavaScript and CSS, turn on page caching and a CDN, and remove plugins you do not use.';
  if (d?.perf != null) add(45, d.perf >= 90 ? 'p' : d.perf >= 50 ? 'w' : 'f', `PageSpeed mobile score ${d.perf}/100`, SPEED);
  else add(45, ms <= 800 ? 'p' : ms <= 2000 ? 'w' : 'f', `HTML loads in ${ms} ms (full PageSpeed test not run for this page; ${sample} pages were tested)`, 'Server response is slow: ' + SPEED);
  if (d?.lcpMs != null) add(46, d.lcpMs <= 2500 ? 'p' : d.lcpMs <= 4000 ? 'w' : 'f', `LCP ${(d.lcpMs / 1000).toFixed(1)} s`, 'Preload and compress the largest image (hero), serve it in WebP/AVIF at the right size, remove render-blocking CSS/JS, and improve server response (caching / CDN).');
  else add(46, 'n', `Not measured for this page (PageSpeed tested ${sample} pages)`);
  if (d?.inpMs != null) add(47, d.inpMs <= 200 ? 'p' : d.inpMs <= 500 ? 'w' : 'f', `INP ${d.inpMs} ms (real users)`, 'Reduce JavaScript work on interaction: split long tasks, defer third-party scripts (chat, analytics, ads), remove heavy page-builder add-ons.');
  else if (d?.tbtMs != null) add(47, d.tbtMs <= 200 ? 'p' : d.tbtMs <= 600 ? 'w' : 'f', `No real-user INP data; Total Blocking Time ${Math.round(d.tbtMs)} ms (lab stand-in)`, 'Reduce JavaScript work: defer third-party scripts, remove unused plugins and page-builder add-ons, split long tasks.');
  else add(47, 'n', `Not measured for this page (PageSpeed tested ${sample} pages)`);
  if (d?.cls != null) add(48, d.cls <= 0.1 ? 'p' : d.cls <= 0.25 ? 'w' : 'f', `CLS ${d.cls}`, 'Set width and height on all images, iframes and embeds, reserve space for banners and ads, and avoid inserting content above existing content.');
  else if (unsized > 0) add(48, 'w', `Not measured; ${unsized} image(s) have no width / height and can shift the layout`, 'Add width and height attributes to every image (WordPress adds them automatically; check the theme / page builder output).');
  else add(48, 'i', 'Not measured with PageSpeed; no unsized images found in the HTML');
  const t = d?.ttfbMs ?? null;
  const ttfb = t ?? ms;
  add(49, ttfb <= 800 ? 'p' : ttfb <= 1800 ? 'w' : 'f', t != null ? `Server response ${Math.round(t)} ms (PageSpeed)` : `HTML response ${ms} ms (includes download time)`, 'Reduce server response time: page caching (LiteSpeed Cache / WP Rocket / W3 Total Cache), PHP 8.2+, fewer and lighter plugins, a CDN, better hosting.');
  if (d?.fcpMs != null) add(50, d.fcpMs <= 1800 ? 'p' : d.fcpMs <= 3000 ? 'w' : 'f', `FCP ${(d.fcpMs / 1000).toFixed(1)} s`, 'Remove render-blocking CSS/JS from the head, inline the critical CSS, preload fonts and enable compression and caching.');
  else add(50, 'n', `Not measured for this page (PageSpeed tested ${sample} pages)`);
  return out;
}

// ---- one page against the 70 parameters -------------------------------------------------------------------------------------

function evalPage(p: PageRecord, c: Ctx): Rule[] {
  const out: Rule[] = [];
  const add = (id: number, s: St, v: string, f?: string) => out.push({ id, s, v: cut(v, 170), ...(f && s !== 'p' && s !== 'i' && s !== 'n' ? { f: cut(f, 440) } : {}) });
  const path = pathOf(p.url);
  const googleOk = robotsAllows(c.robots, 'Googlebot', path);

  if (p.status !== 200 || !p.deep) {
    const redirect = p.hops > 0 && p.status != null && p.status >= 300 && p.status < 400;
    if (redirect) {
      add(40, p.hops >= 2 ? 'f' : 'w', `${p.hops} redirect${p.hops > 1 ? 's' : ''} to ${p.finalUrl}`, 'Update every internal link, menu item and sitemap entry to the final URL, and replace redirect chains with one 301 straight to the destination (Redirection / Rank Math redirects).');
      if (p.inSitemap) add(14, 'f', 'A redirecting URL is listed in the sitemap', 'Replace it in the sitemap with the final URL (the sitemap should only list pages that return 200).');
    } else {
      add(41, 'f', p.status == null ? 'No response (timeout / blocked / DNS)' : `HTTP ${p.status}`, 'Restore the page, or 301-redirect it to the closest matching page, and remove or update every link that points to it.');
      add(11, 'f', 'Not indexable: the page does not return 200', 'Fix the error first; error pages are dropped from Google.');
      if (p.inSitemap) add(14, 'f', 'An error URL is listed in the sitemap', 'Remove it from the sitemap (or restore the page).');
      add(20, 'f', `Crawlers get ${p.status == null ? 'no response' : 'HTTP ' + p.status}`, 'Make the URL load (200) or redirect it.');
    }
    return out;
  }

  const d = p.deep;
  const isArticle = d.pageType === 'article';
  const isHome = d.pageType === 'home';
  const content = p.words >= 100 && d.read.sentences >= 5;
  const title = dec(p.title ?? '');
  const meta = dec(p.metaDescription ?? '');
  const h1 = dec(p.h1[0] ?? '');
  const kp = d.keyphrase;
  const KP = (where: string) => `Use the keyphrase "${kp}" in ${where}.`;

  // 1 page name
  if (!d.pageName) add(1, 'f', 'No H1 and no title', 'Name the page: add an H1 and an SEO title that say what the page is about.');
  else if (GENERIC_NAME.test(d.pageName.trim())) add(1, 'w', `"${d.pageName}" is too generic`, 'Rename the page with what it offers and for whom (for example "SEO services for dentists").');
  else add(1, 'p', d.pageName);

  // 2 publish date, 3 author
  if (isArticle) {
    add(2, d.published ? 'p' : 'w', d.published ? `Published ${d.published}` : 'No publish date found', 'Show the publish date on the post (theme setting) and add datePublished to the Article schema (Rank Math / Yoast do this when the post has a date).');
    add(3, d.author ? 'p' : 'f', d.author ? `By ${d.author}` : 'No author found', 'Show a real author name on every article (WordPress: user profile > display name; theme: show author box) and add the author to the Article schema.');
  } else {
    add(2, 'i', d.published ? `Published ${d.published}` : 'No date shown (not required for this page type)');
    add(3, 'i', d.author ? `Author ${d.author}` : 'No author shown (optional for this page type)');
  }

  // 4 SEO title
  {
    const px = pixelWidth(title, 20);
    const l: Array<[St, string]> = [];
    if (!title) l.push(['f', 'Add an SEO title (SEO plugin > page panel > SEO title).']);
    else {
      const dup = c.titleDup.get(title.toLowerCase()) ?? 1;
      if (dup > 1) l.push(['f', `The same title is used on ${dup} pages: write a unique one.`]);
      if (title.length < 30 || title.length > 60 || px > 600) l.push(['w', 'Keep it to 30-60 characters (about 600px).']);
      if (kp && !d.kp.inTitle) l.push(['w', KP('the title, near the start')]);
    }
    const g = grade(l);
    add(4, g.s, title ? `${title.length} chars, ~${px}px: "${title}"` : 'Missing', g.f);
  }

  // 5 slug
  if (isHome) add(5, 'i', 'Homepage (/)');
  else {
    const l: Array<[St, string]> = [];
    if (d.slug.length > 60) l.push(['w', 'Shorten the slug to under 60 characters.']);
    if (p.urlIssues.length) l.push(['w', p.urlIssues.join('; ') + '. Use lowercase words separated by hyphens (Settings > Permalinks / page > URL slug).']);
    if (kp && !d.kp.inSlug && d.keyphraseSource !== 'url') l.push(['w', KP('the URL slug') + ' If the page already ranks, add a 301 redirect from the old URL.']);
    const g = grade(l);
    add(5, g.s, `/${d.slug}`, g.f);
  }

  // 6 meta description
  {
    const l: Array<[St, string]> = [];
    if (!meta) l.push(['f', 'Write a 70-160 character meta description that says what the visitor gets and why to click (SEO plugin > page panel > Meta description).']);
    else {
      const dup = c.metaDup.get(meta.toLowerCase()) ?? 1;
      if (dup > 1) l.push(['f', `The same description is used on ${dup} pages: write a unique one.`]);
      if (meta.length < 70 || meta.length > 160) l.push(['w', 'Keep it to 70-160 characters.']);
      if (kp && !d.kp.inMeta) l.push(['w', KP('the meta description')]);
    }
    const g = grade(l);
    add(6, g.s, meta ? `${meta.length} chars: "${meta}"` : 'Missing', g.f);
  }

  // 7 keyphrase
  {
    const placed = [d.kp.inTitle, d.kp.inH1, d.kp.inMeta, d.kp.inSlug || isHome, d.kp.inFirstPara].filter(Boolean).length;
    const missing = [!d.kp.inTitle && 'title', !d.kp.inH1 && 'H1', !d.kp.inMeta && 'meta description', !d.kp.inSlug && !isHome && 'URL', !d.kp.inFirstPara && 'first paragraph'].filter(Boolean).join(', ');
    if (!kp) add(7, 'f', 'No keyphrase could be detected', 'Choose one focus keyphrase for this page and set it in the SEO plugin (Rank Math / Yoast / Squirrly > Focus keyphrase).');
    else
      add(7, placed >= 3 ? 'p' : placed >= 1 ? 'w' : 'f', `"${kp}" (${d.keyphraseSource}); in ${placed} of 5 key places`, `Set "${kp}" as the focus keyphrase in the SEO plugin and use it in: ${missing || 'all places'}.`);
  }

  // 8 canonical
  {
    const l: Array<[St, string]> = [];
    if (!p.canonical) l.push(['f', 'Add a self-referencing canonical (Rank Math / Yoast add it by default; check the theme or a plugin is not removing it).']);
    else {
      if (p.canonicalOther) l.push(['w', 'The canonical points to a different URL; if this page should rank on its own, change the canonical to its own address.']);
      if (/^http:/i.test(p.canonical) && /^https:/i.test(p.finalUrl)) l.push(['w', 'The canonical is http:// on an https site: change it to https://.']);
    }
    const g = grade(l);
    add(8, g.s, p.canonical ?? 'Missing', g.f);
  }

  // 9 hero image
  {
    const h = d.hero;
    const l: Array<[St, string]> = [];
    if (!h.src) l.push(['f', 'Add a featured / hero image (WordPress: Set featured image) and an og:image for social shares.']);
    else {
      if (!h.og) l.push(['w', 'Set an og:image (SEO plugin > Social tab) so shares show a picture.']);
      if (h.alt === false) l.push(['w', 'Add descriptive alt text to the hero image.']);
      if (h.dims === false) l.push(['w', 'Add width and height to the hero image.']);
      if (h.lazy === true) l.push(['w', 'Do not lazy-load the first image (it delays the Largest Contentful Paint): remove loading="lazy" from it or exclude it in the cache / optimisation plugin.']);
      if (h.modern === false) l.push(['w', 'Serve the hero in WebP or AVIF (an image-optimisation plugin does this).']);
    }
    const g = grade(l);
    add(9, g.s, h.src ? `${h.og ? 'og:image set' : 'no og:image'}; ${h.inContent ? 'image in content' : 'no content image'}${h.alt === false ? '; no alt text' : ''}${h.dims === false ? '; no width/height' : ''}${h.lazy ? '; lazy-loaded' : ''}${h.modern === false ? '; not WebP/AVIF' : ''}` : 'No hero or social image', g.f);
  }

  // 10 H1
  {
    const l: Array<[St, string]> = [];
    if (p.h1Count === 0) l.push(['f', 'Add one H1 that states what the page is about (page title field / first heading).']);
    if (p.h1Count > 1) l.push(['w', `Keep one H1: the page has ${p.h1Count}. Change the extra ones to H2.`]);
    if (p.h1Count >= 1) {
      if (h1.length > 70) l.push(['w', 'Shorten the H1 to under 70 characters.']);
      if (kp && !d.kp.inH1) l.push(['w', KP('the H1')]);
    }
    const g = grade(l);
    add(10, g.s, p.h1Count ? `${p.h1Count} H1: "${h1}"${kp && !d.kp.inH1 ? `; keyphrase "${kp}" not in it` : ''}` : 'No H1', g.f);
  }

  // 11 Google indexing (technical signals; Search Console shows the real index state)
  {
    const l: Array<[St, string]> = [];
    if (p.noindex) l.push(['f', 'Remove the noindex (SEO plugin > Advanced > Robots meta, or Settings > Reading "Discourage search engines").']);
    if (!googleOk) l.push(['f', 'robots.txt blocks Googlebot for this URL: remove the Disallow rule.']);
    if (p.canonicalOther) l.push(['w', 'The canonical points elsewhere, so Google may index the other URL instead.']);
    const g = grade(l);
    add(11, g.s, g.s === 'p' ? 'Indexable: 200, no noindex, canonical to itself, allowed by robots.txt (confirm in Search Console > URL Inspection)' : p.noindex ? 'Set to noindex' : !googleOk ? 'Blocked by robots.txt' : 'Canonical points to another URL', g.f);
  }

  // 12 authority, 13 trust
  {
    const sig = [d.authoritativeOutbound >= 1, !!(d.author || d.modified || d.published), p.externalLinks >= 2, p.orgSameAs];
    const n = sig.filter(Boolean).length;
    const strict = isArticle || d.pageType === 'service' || d.pageType === 'product';
    add(12, n >= 3 ? 'p' : n === 2 ? 'w' : strict ? 'f' : 'w', `${n} of 4: ${d.authoritativeOutbound} authoritative link(s), ${d.author || d.modified ? 'author / date shown' : 'no author / date'}, ${p.externalLinks} outbound, ${p.orgSameAs ? 'organisation profiles linked' : 'no sameAs'}`, 'Cite 1-2 trusted sources (studies, standards, .gov / .edu, industry bodies), show the author and last-updated date, and add your social / directory profiles to the Organization schema sameAs.');
  }
  {
    const sig = [/^https:/i.test(p.finalUrl), d.trust.about && d.trust.contact, d.trust.privacy || d.trust.terms, d.trust.phone || d.trust.address, d.trust.reviews];
    const n = sig.filter(Boolean).length;
    add(13, n >= 4 ? 'p' : n >= 2 ? 'w' : 'f', `${n} of 5: ${sig[0] ? 'HTTPS' : 'no HTTPS'}, ${sig[1] ? 'About + Contact linked' : 'About / Contact not linked'}, ${sig[2] ? 'privacy / terms linked' : 'no privacy / terms link'}, ${sig[3] ? 'phone or address' : 'no phone / address'}, ${sig[4] ? 'reviews' : 'no reviews'}`, 'Link About, Contact and Privacy Policy in the header or footer, show a phone number or address, and add genuine customer reviews or testimonials.');
  }

  // 14 sitemap
  {
    if (!c.checks.sitemap.found) add(14, 'f', 'The site has no XML sitemap', 'Create /sitemap.xml (Rank Math / Yoast / WordPress core sitemap) and submit it in Search Console.');
    else if (p.noindex && p.inSitemap) add(14, 'f', 'A noindex page is listed in the sitemap', 'Remove it from the sitemap (SEO plugin > Sitemap settings), or remove the noindex.');
    else if (!p.noindex && !p.canonicalOther && !p.inSitemap) add(14, p.depth <= 1 ? 'f' : 'w', 'Indexable page missing from the sitemap', 'Include this post type / page in the sitemap (SEO plugin > Sitemap > enable the post type, untick "exclude from sitemap" on the page).');
    else add(14, 'p', p.inSitemap ? 'Listed in the sitemap' : 'Not listed (correct: not indexable)');
  }

  // 15 follow
  add(15, p.nofollowMeta ? 'w' : 'p', p.nofollowMeta ? 'Page is set to nofollow: its links pass no value' : `Follow${p.nofollowLinks ? `; ${p.nofollowLinks} nofollow link(s)` : ''}`, 'Remove "nofollow" from the page robots setting (SEO plugin > Advanced > Robots meta) unless it is deliberate.');

  // 18 outbound, 19 internal
  {
    const ext = p.externalLinks;
    if (ext >= 1) add(18, 'p', `${ext} outbound link(s)`);
    else if (isArticle || d.pageType === 'service') add(18, 'w', 'No outbound links', 'Link to 1-3 relevant, trustworthy external pages (a study, standard, tool or source you cite).');
    else add(18, 'i', 'No outbound links (optional for this page type)');
    const orphan = c.complete && p.depth > 0 && p.inbound === 0;
    const l: Array<[St, string]> = [];
    if (p.internalLinks < 1) l.push(['f', 'The page links to no other page on the site: add links to related pages.']);
    else if (p.internalLinks < 3) l.push(['w', 'Add at least 3 internal links to related pages with descriptive text.']);
    if (orphan) l.push(['w', 'No other page links to this one: link to it from a related page and the menu.']);
    if (p.internalLinks > 150) l.push(['w', 'More than 150 internal links dilute value: trim the menu / footer.']);
    const g = grade(l);
    add(19, g.s, `${p.internalLinks} out, ${p.inbound} in${orphan ? ' (orphan)' : ''}`, g.f);
  }

  // 20 crawling
  {
    const l: Array<[St, string]> = [];
    if (!googleOk) l.push(['f', 'Allow Googlebot in robots.txt for this URL.']);
    if (p.ms > 3000) l.push(['w', 'The page is slow to fetch (over 3 s): speed up the server / caching.']);
    if (p.depth > 3) l.push(['w', 'The page is more than 3 clicks from the homepage: link it from a higher-level page.']);
    const g = grade(l);
    add(20, g.s, `${googleOk ? 'Allowed' : 'Blocked'} by robots.txt; ${p.ms} ms; depth ${p.depth}`, g.f);
  }

  // 21 submit to LLM
  {
    const blocked = CORE_AI.filter((a) => !robotsAllows(c.robots, a, path));
    const listed = c.llms.has(bare(p.finalUrl)) || c.llms.has(bare(p.url));
    const l: Array<[St, string]> = [];
    if (blocked.length) l.push(['f', `robots.txt blocks ${blocked.join(', ')}: allow them so AI tools can read and cite the page.`]);
    if (p.jsOnly) l.push(['f', 'The content is only visible after JavaScript runs; AI crawlers do not run it. Server-render the main text.']);
    if (!c.checks.llmsTxt.exists && p.depth <= 1) l.push(['w', 'Publish /llms.txt listing the key pages.']);
    else if (c.checks.llmsTxt.exists && !listed && p.depth <= 2) l.push(['w', 'Add this page to /llms.txt (title + one-line description).']);
    const g = grade(l);
    add(21, g.s, `${blocked.length ? 'AI crawlers blocked: ' + blocked.join(', ') : 'AI crawlers allowed'}; ${p.jsOnly ? 'JavaScript-only content' : 'content in HTML'}; ${listed ? 'listed in llms.txt' : 'not in llms.txt'}`, g.f);
  }

  // 22 SERP view, 23 edit excerpt, 70 excerpt
  {
    const tpx = pixelWidth(title, 20);
    const dpx = pixelWidth(meta, 14);
    const l: Array<[St, string]> = [];
    if (!title || !meta) l.push(['f', 'Write the missing title / description so Google does not invent the snippet.']);
    if (tpx > 600) l.push(['w', 'The title is likely cut off in Google (over about 600px): shorten it.']);
    if (dpx > 1000) l.push(['w', 'The description is likely cut off (over about 1000px): shorten it.']);
    const g = grade(l);
    add(22, g.s, `Title ~${tpx}px of ~600, description ~${dpx}px of ~1000. Preview: ${cut(title, 60)} - ${cut(meta, 70)}`, g.f);
    const excerpt = (meta || d.og.description || '').trim();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const auto = !!excerpt && (norm(excerpt) === norm(title) || (!!d.lead && norm(d.lead).startsWith(norm(excerpt).slice(0, 60)) && norm(excerpt).length > 40));
    if (!excerpt) add(23, 'f', 'No excerpt / description to edit', 'Write the excerpt by hand (SEO plugin > Meta description, or the post Excerpt box).');
    else if (auto) add(23, 'w', 'The excerpt looks auto-generated (copy of the title or the first lines)', 'Replace it with a hand-written summary that sells the click.');
    else add(23, 'p', 'Custom excerpt');
    add(70, !excerpt ? 'f' : excerpt.length >= 70 && excerpt.length <= 160 ? 'p' : 'w', excerpt ? `${excerpt.length} chars` : 'Missing', 'Keep the excerpt / description between 70 and 160 characters.');
  }

  // 24-31 readability
  {
    const r = d.read;
    const na = (id: number) => add(id, 'n', 'Not enough text to measure (needs 100+ words and 5 sentences)');
    if (!content) READABILITY_IDS.forEach(na);
    else {
      add(24, r.complexPct <= 10 ? 'p' : r.complexPct <= 15 ? 'w' : 'f', `${r.complexPct}% difficult words (Flesch reading ease ${r.flesch})`, 'Swap long, rare words for plain ones; explain jargon in one short sentence.');
      add(25, r.transitionPct >= 30 ? 'p' : r.transitionPct >= 20 ? 'w' : 'f', `${r.transitionPct}% of sentences use a transition word`, 'Join ideas with words like "because", "however", "for example", "as a result" in at least 30% of sentences.');
      add(26, r.passivePct <= 10 ? 'p' : r.passivePct <= 15 ? 'w' : 'f', `${r.passivePct}% passive sentences`, 'Rewrite passive sentences in the active voice ("we build the site", not "the site is built by us").');
      add(27, r.consecutiveRuns === 0 ? 'p' : 'w', r.consecutiveRuns ? `${r.consecutiveRuns} run(s) of 3+ sentences starting with the same word` : 'No repeated sentence openings', 'Vary how consecutive sentences begin.');
      add(28, r.inclusive.length ? 'w' : 'p', r.inclusive.length ? `Found: ${r.inclusive.join(', ')}` : 'No non-inclusive terms found', 'Replace the listed terms (for example "guys" > "everyone", "whitelist" > "allowlist", "manpower" > "workforce").');
      add(29, p.words > 300 && p.h2Count === 0 ? 'f' : p.words > 300 && d.read.longSections > 0 ? 'w' : 'p', p.h2Count ? `${d.read.longSections} stretch(es) over 300 words without a subheading; ${p.h2Count} H2` : p.words > 300 ? 'No subheadings' : 'Short page', 'Add an H2 / H3 at least every 300 words, written as the question or topic of the next section.');
      add(30, r.longestParagraph <= 150 && r.avgParagraph <= 120 ? 'p' : r.longestParagraph > 220 ? 'f' : 'w', `Average ${r.avgParagraph} words, longest ${r.longestParagraph}`, 'Split paragraphs over 150 words: one idea per paragraph.');
      add(31, r.longSentencePct <= 25 ? 'p' : r.longSentencePct <= 30 ? 'w' : 'f', `${r.longSentencePct}% of sentences over 20 words (average ${r.avgSentence})`, 'Cut long sentences in two; keep most under 20 words.');
    }
  }

  // 32 word count, 33 text to image
  {
    const min = isArticle ? 600 : d.pageType === 'service' ? 500 : d.pageType === 'product' ? 200 : d.pageType === 'contact' ? 100 : 300;
    add(32, p.words >= min ? 'p' : p.words >= min * 0.5 ? 'w' : 'f', `${p.words} words (${d.pageType} page target ${min}+)`, `Expand the page to at least ${min} words with specific, useful content (answers, examples, proof, FAQs), not filler.`);
    const per = d.img.total ? Math.round(p.words / d.img.total) : null;
    const l: Array<[St, string]> = [];
    if (!d.img.total && p.words > 300) l.push(['w', 'Add relevant images, diagrams or screenshots (about one per 100-500 words) with alt text.']);
    if (per != null && per > 500 && p.words > 600) l.push(['w', 'Very long text with few images: add supporting visuals.']);
    if (per != null && per < 40 && d.img.total > 6) l.push(['w', 'Image heavy for the amount of text: add copy or reduce decorative images.']);
    const g = grade(l);
    add(33, g.s, `${d.img.total} image(s), ${per ?? '-'} words per image, ${d.textToHtmlPct}% text-to-HTML`, g.f);
  }

  // 34-36 schema
  {
    if (!p.schemaTypes.length) add(34, 'f', 'No structured data', 'Add schema (SEO plugin > Schema): Organization + WebSite on the site, and Article / Service / Product / FAQPage / BreadcrumbList on the page.');
    else add(34, p.schemaErrors.length ? 'w' : 'p', `${p.schemaTypes.join(', ')}${p.schemaErrors.length ? '; ' + p.schemaErrors[0] : ''}`, 'Fill the missing required fields in the schema and re-test in Google\'s Rich Results Test.');
    const s = d.schema;
    if (!s.jsonLdBlocks) add(35, 'f', 'No JSON-LD found', 'Output the schema as JSON-LD (Rank Math / Yoast / Schema Pro do this).');
    else if (s.jsonLdValid < s.jsonLdBlocks) add(35, 'f', `${s.jsonLdBlocks - s.jsonLdValid} of ${s.jsonLdBlocks} JSON-LD block(s) are not valid JSON`, 'Fix the broken JSON-LD (usually a stray comma or quote from hand-pasted code); validate at validator.schema.org.');
    else add(35, s.hasContext ? 'p' : 'w', `${s.jsonLdValid} valid block(s)${s.hasContext ? '' : ', no @context'}`, 'Add "@context": "https://schema.org" to the JSON-LD.');
    const generic = new Set(['WebSite', 'WebPage', 'Organization', 'BreadcrumbList', 'ImageObject', 'SearchAction', 'Person', 'CollectionPage', 'ItemList', 'SiteNavigationElement', 'WPHeader', 'WPFooter', 'ListItem', 'EntryPoint', 'PostalAddress', 'ContactPoint']);
    const specific = s.nodeTypes.filter((t) => !generic.has(t));
    const wanted = d.pageType === 'article' ? 'Article / BlogPosting' : d.pageType === 'service' ? 'Service' : d.pageType === 'product' ? 'Product' : d.pageType === 'contact' ? 'ContactPage / LocalBusiness' : d.pageType === 'about' ? 'AboutPage' : isHome ? 'Organization + WebSite' : '';
    if (specific.length || (isHome && s.nodeTypes.includes('Organization') && s.nodeTypes.includes('WebSite'))) add(36, 'p', specific.join(', ') || 'Organization + WebSite');
    else if (wanted) add(36, 'w', `Only generic schema (${s.nodeTypes.join(', ') || 'none'})`, `Add ${wanted} schema for this page (SEO plugin > Schema > Add schema, or custom JSON-LD).`);
    else add(36, 'i', `Generic schema only (${s.nodeTypes.join(', ') || 'none'}); no specific type needed`);
  }

  // 37 open graph, 38 twitter
  {
    const o = d.og;
    const miss = [!o.title && 'og:title', !o.description && 'og:description', !o.image && 'og:image', !o.url && 'og:url', !o.type && 'og:type'].filter(Boolean) as string[];
    add(37, miss.length === 0 ? 'p' : miss.length >= 3 ? 'f' : 'w', miss.length ? `Missing: ${miss.join(', ')}` : 'All Open Graph tags set', 'Turn on Open Graph in the SEO plugin (Social settings) and set a default share image of 1200x630.');
    add(38, d.twitter.card ? 'p' : 'w', d.twitter.card ? `twitter:card = ${d.twitter.card}` : 'No twitter:card', 'Enable Twitter / X cards in the SEO plugin (Social settings), card type summary_large_image.');
  }

  // 39 viewport images
  {
    const i = d.img;
    const l: Array<[St, string]> = [];
    if (!p.viewport) l.push(['f', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the theme header.']);
    if (i.total >= 3 && i.noSrcset / i.total > 0.5) l.push(['w', 'Serve responsive images (srcset): WordPress does this for media-library images; check the theme / builder is not hard-coding a single size.']);
    if (p.imagesNoSize > 0) l.push(['w', `${p.imagesNoSize} image(s) have no width / height: add them to stop layout shift.`]);
    if (i.firstLazy) l.push(['w', 'The first image is lazy-loaded: load it eagerly.']);
    const g = grade(l);
    add(39, g.s, `${p.viewport ? 'Viewport tag set' : 'No viewport tag'}; ${i.total} image(s), ${i.noSrcset} without srcset, ${p.imagesNoSize} without size, ${i.lazy} lazy`, g.f);
  }

  // 40 redirects, 41 not found, 42 broken links
  add(40, 'p', 'Loads directly (no redirect)');
  add(41, 'p', 'HTTP 200');
  {
    const b = c.brokenOn.get(p.url) ?? [];
    add(42, b.length ? 'f' : 'p', b.length ? `${b.length} broken: ${b.slice(0, 3).join(', ')}` : 'No broken links found', 'Update or remove each broken link (WordPress: edit the page, or use Broken Link Checker / Redirection to find and fix them).');
  }

  // 43 robots, 44 llms
  add(43, googleOk ? 'p' : 'f', `${googleOk ? 'Allowed' : 'Blocked'} for Googlebot${c.checks.robots.exists ? '' : '; the site has no robots.txt'}`, 'Remove the Disallow rule that blocks this URL.');
  {
    const listed = c.llms.has(bare(p.finalUrl)) || c.llms.has(bare(p.url));
    if (!c.checks.llmsTxt.exists) add(44, 'i', 'The site has no /llms.txt (see the root domain report)');
    else if (listed) add(44, 'p', 'Listed in llms.txt');
    else add(44, p.depth <= 2 ? 'w' : 'i', 'Not listed in llms.txt', 'Add this page to /llms.txt with a one-line description.');
  }

  // 45-50 speed
  out.push(...speedRules(p.ms, p.imagesNoSize, c.psi.get(bare(p.url)) ?? c.psi.get(bare(p.finalUrl)), c.psiSample));

  // 51 JS, 52 CSS
  {
    const j = d.js;
    const l: Array<[St, string]> = [];
    if (j.docWrite) l.push(['w', 'A script uses document.write (blocks rendering): replace or remove it.']);
    if (j.oldJquery) l.push(['w', 'jQuery older than v3 is loaded (slow, insecure): update the theme / plugins that bundle it.']);
    if (j.blockingInHead > 3) l.push([j.blockingInHead > 6 ? 'f' : 'w', `${j.blockingInHead} scripts block rendering in the head: add defer / async (cache plugin > JavaScript > defer).`]);
    if (j.total > 30) l.push([j.total > 50 ? 'f' : 'w', `${j.total} script files: remove unused plugins / add-ons and combine or defer what is left.`]);
    if (j.inlineKb > 100) l.push(['w', `${j.inlineKb} KB of inline JavaScript: move it into cached files.`]);
    const g = grade(l);
    add(51, g.s, `${j.total} script file(s), ${j.blockingInHead} render-blocking in head, ${j.inlineKb} KB inline${j.docWrite ? ', document.write' : ''}${j.oldJquery ? ', old jQuery' : ''} (static check; runtime console errors need a browser test)`, g.f);
    const cs = d.css;
    const brokenAssets = d.assets.filter((u) => (c.input.assetStatus.get(u) ?? 200) >= 400);
    const l2: Array<[St, string]> = [];
    if (brokenAssets.length) l2.push(['f', `${brokenAssets.length} stylesheet / script file(s) return an error (${brokenAssets.slice(0, 2).join(', ')}): fix the path or remove the reference.`]);
    if (cs.imports > 0) l2.push(['w', 'CSS @import slows rendering: link the stylesheet instead or let the cache plugin combine it.']);
    if (cs.sheets > 12) l2.push(['w', `${cs.sheets} stylesheets: combine / minify (cache plugin > CSS) and remove unused plugin styles.`]);
    if (cs.blockingInHead > 8) l2.push(['w', `${cs.blockingInHead} render-blocking stylesheets: inline critical CSS and load the rest asynchronously.`]);
    if (cs.styleAttrs > 150) l2.push(['w', `${cs.styleAttrs} inline style attributes: move styling into the stylesheet.`]);
    const g2 = grade(l2);
    add(52, g2.s, `${cs.sheets} stylesheet(s), ${cs.styleBlocks} inline style block(s), ${cs.styleAttrs} style attribute(s)${brokenAssets.length ? `, ${brokenAssets.length} broken` : ''} (static check)`, g2.f);
  }

  // 53 depth
  add(53, p.depth <= 3 ? 'p' : p.depth === 4 ? 'w' : 'f', `${p.depth} click(s) from the homepage`, 'Link this page from the homepage, a main menu item or a hub page so it is within 3 clicks.');

  // 54-57 keyword relevance
  {
    const k = d.kp;
    if (!kp || !content) add(54, 'n', kp ? 'Not enough text to measure' : 'No keyphrase');
    else add(54, k.density >= 0.5 && k.density <= 2.5 ? 'p' : k.density > 3 || (k.density === 0 && p.words >= 300) ? 'f' : 'w', `"${kp}" used ${k.count} time(s) = ${k.density}% of words`, k.density < 0.5 ? `Use "${kp}" naturally a few more times (target 0.5-2.5%), including in one subheading.` : `"${kp}" is overused: rewrite some mentions with synonyms and related phrases.`);
    if (!content) add(55, 'n', 'Not enough text to measure');
    else {
      const rel = d.terms.length;
      const sub = k.inSubheadings;
      add(55, rel >= 8 && sub >= 1 ? 'p' : rel >= 5 ? 'w' : 'f', `${rel} recurring related terms (${d.terms.slice(0, 6).join(', ')}); keyphrase in ${sub} subheading(s) (estimate)`, 'Cover the topic with the questions, features, steps and terms searchers use (check People Also Ask and competitors); put the keyphrase or a close variant in at least one subheading.');
    }
    const intentMismatch =
      (d.intent === 'transactional' || d.intent === 'local') && isArticle
        ? 'a buying / local keyphrase is targeted by an informational article'
        : d.intent === 'transactional' && p.words < 300
          ? 'a thin page for a buying keyphrase'
          : d.intent === 'informational' && (d.pageType === 'service' || isHome) && p.words < 300
            ? 'an informational keyphrase on a short sales page'
            : d.intent === 'informational' && !p.ai.answerFirst && d.faq.questionHeadings === 0 && p.words < 400
              ? 'an informational keyphrase but no direct answer or question headings'
              : '';
    if (!kp) add(56, 'n', 'No keyphrase');
    else add(56, intentMismatch ? 'w' : 'p', `${d.intent} intent on a ${d.pageType} page${intentMismatch ? ': ' + intentMismatch : ''} (estimate)`, 'Make the page type match the search: answer-first guides for questions, comparison tables for "best / vs", service pages with proof, pricing and a clear call to action for buying, and address + map for local.');
    if (!kp) add(57, 'n', 'No keyphrase');
    else {
      const parts = [d.kp.inTitle, d.kp.inH1, d.kp.inMeta, d.kp.inSlug || isHome, d.kp.inFirstPara, d.kp.inSubheadings > 0].filter(Boolean).length;
      add(57, parts >= 4 ? 'p' : parts >= 2 ? 'w' : 'f', `Topic "${kp}" present in ${parts} of 6: title, H1, description, URL, first paragraph, subheadings (estimate)`, `Keep every part of the page on "${kp}": align the title, H1, description, opening paragraph and at least one subheading.`);
    }
  }

  // 58 freshness
  {
    const stamp = d.modified ?? d.published;
    if (!stamp) add(58, isArticle ? 'w' : 'i', 'No publish / updated date found', 'Show a "last updated" date and set dateModified in the schema; refresh the content at least yearly.');
    else {
      const days = Math.floor((Date.now() - Date.parse(stamp)) / 86400000);
      add(58, days <= 365 ? 'p' : days <= 730 ? 'w' : 'f', `${d.modified ? 'Updated' : 'Published'} ${stamp} (${days} days ago)`, 'Review and update the content (facts, prices, screenshots, links), then update the modified date.');
    }
  }

  // 59 uniqueness, 60 cannibalization
  {
    const dup = c.hashDup.get(p.hash) ?? 1;
    const near = c.nearest.get(p.url);
    if (p.words < 100) add(59, 'n', 'Too little text to compare');
    else if (dup > 1) add(59, 'f', `Identical text on ${dup} pages`, 'Rewrite the page so it is unique, merge the duplicates into one page, or point the duplicate\'s canonical to the main page.');
    else if (near && near.sim >= 0.8) add(59, near.sim >= 0.9 ? 'f' : 'w', `${Math.round(near.sim * 100)}% similar to ${near.url}`, 'Rewrite the overlapping text so each page is genuinely different (for city / service-area pages: local proof, case studies, team or address, local FAQs, reviews, an embedded map), or merge the pages and 301-redirect one to the other. Pages that differ only by a place name risk being treated as doorway pages.');
    else add(59, 'p', near ? `Unique (closest page ${Math.round(near.sim * 100)}% similar)` : 'Unique');
    const cn = c.cannibal.get(p.url) ?? [];
    if (!kp || isHome) add(60, 'n', isHome ? 'Homepage' : 'No keyphrase');
    else add(60, cn.length ? 'w' : 'p', cn.length ? `Same target keyphrase as ${cn.length} other page(s): ${cn.slice(0, 2).join(', ')}` : 'Only page targeting this keyphrase', 'Pick one page per keyphrase: re-target the others to different keyphrases, merge them, or point the weaker page\'s canonical at the stronger one.');
  }

  // 61 FAQ
  {
    const q = d.faq.questionHeadings;
    const hasFaqSchema = d.schema.faqItems > 0;
    const wants = isArticle || d.pageType === 'service' || isHome || d.pageType === 'product';
    if (q >= 3 || hasFaqSchema) add(61, 'p', `${q} question heading(s)${hasFaqSchema ? ', FAQPage schema' : ''}`);
    else if (!wants) add(61, 'i', `${q} question heading(s) (optional for this page type)`);
    else add(61, q > 0 || p.words >= 500 ? 'w' : 'i', `${q} question heading(s)`, 'Add an FAQ section: 4-6 real buyer questions as H2/H3 headings, each answered in 40-60 words, with FAQPage schema.');
  }

  // 62 entity coverage
  if (!content) add(62, 'n', 'Not enough text to measure');
  else {
    const e = d.entities.length + (d.schema.about > 0 ? 2 : 0) + (p.orgSameAs ? 1 : 0);
    add(62, e >= 6 ? 'p' : e >= 3 ? 'w' : 'f', `${d.entities.length} named entities: ${d.entities.slice(0, 6).join(', ') || 'none'} (estimate)`, 'Name the people, places, brands, tools, standards and concepts the topic involves, and tie them to schema (about / mentions / sameAs).');
  }

  // 63 anchor text
  {
    const a = d.anchors;
    if (a.total < 3) add(63, 'n', `${a.total} internal in-content link(s): too few to judge`);
    else {
      const gen = Math.round(((a.generic + a.naked) / a.total) * 100);
      const l: Array<[St, string]> = [];
      if (gen > 20) l.push(['w', `${gen}% of internal links use generic or bare-URL text: describe the destination instead.`]);
      if (a.topShare > 40 && a.total >= 5) l.push(['w', `One anchor ("${a.topText}") is ${a.topShare}% of internal links: vary the wording.`]);
      if (a.imageOnly / a.total > 0.4) l.push(['w', 'Many links are image-only: add alt text or a text link.']);
      const g = grade(l);
      add(63, g.s, `${a.descriptive} descriptive, ${a.generic} generic, ${a.naked} bare URL, ${a.imageOnly} image-only; top "${a.topText}" ${a.topShare}%`, g.f);
    }
  }

  // 64 schema entity consistency
  {
    const s = d.schema;
    const names = [s.orgName, s.publisherName].filter(Boolean) as string[];
    if (!names.length) add(64, 'i', 'No organisation name in this page\'s schema');
    else if (c.orgCount > 1 && names.some((n) => n.toLowerCase() !== c.mainOrg)) add(64, 'f', `"${names.find((n) => n.toLowerCase() !== c.mainOrg)}" differs from the main entity "${c.mainOrg}"`, 'Use one exact organisation name and URL in every schema block (SEO plugin > Schema > Organization; remove duplicate schema from the theme or other plugins).');
    else if (names.length === 2 && names[0].toLowerCase() !== names[1].toLowerCase()) add(64, 'w', `Organization "${names[0]}" vs publisher "${names[1]}"`, 'Make the Organization and publisher names identical.');
    else add(64, 'p', `Organisation "${names[0]}" matches the rest of the site`);
  }

  // 65-69 schema detail
  {
    const s = d.schema;
    if (isHome) add(65, 'n', 'Homepage needs no breadcrumb');
    else if (s.breadcrumbItems > 0) add(65, s.breadcrumbValid ? 'p' : 'w', `${s.breadcrumbItems} breadcrumb item(s)${s.breadcrumbValid ? '' : ' (missing name or position)'}`, 'Give every breadcrumb item a name and position.');
    else add(65, 'w', 'No BreadcrumbList schema', 'Enable breadcrumbs and breadcrumb schema (Rank Math > Titles & Meta > Misc > Breadcrumbs, or Yoast > Search appearance > Breadcrumbs) and show them in the theme.');
    const hasArticle = s.nodeTypes.some((t) => /^(Article|BlogPosting|NewsArticle|TechArticle)$/.test(t));
    if (!isArticle) add(66, 'n', 'Not an article page');
    else add(66, hasArticle && s.articleAuthor && s.articleDates ? 'p' : hasArticle ? 'w' : 'f', hasArticle ? `Article schema${s.articleAuthor ? ' with author' : ', no author'}${s.articleDates ? ' and dates' : ', no dates'}` : 'No Article schema', 'Add Article / BlogPosting schema with headline, image, author, datePublished and dateModified (SEO plugin > Schema > Article).');
    if (isHome) {
      const org = s.nodeTypes.some((t) => /^(Organization|LocalBusiness|Corporation|ProfessionalService)$/.test(t) || /Business$/.test(t));
      add(67, !org ? 'f' : s.sameAs === 0 ? 'w' : 'p', org ? `Organization schema${s.sameAs ? `, ${s.sameAs} sameAs link(s)` : ', no sameAs'}` : 'No Organization schema', 'Add Organization / LocalBusiness schema with name, url, logo, contact and sameAs links to your social profiles and directory listings (SEO plugin > Schema / Local SEO).');
    } else add(67, s.orgName || s.publisherName ? 'p' : 'i', s.orgName || s.publisherName ? `Organization "${s.orgName ?? s.publisherName}"` : 'No Organization on this page (it belongs on the homepage)');
    if (!isArticle) add(68, 'n', 'Not an article page');
    else add(68, s.nodeTypes.includes('Person') && s.articleAuthor ? 'p' : s.articleAuthor ? 'w' : 'f', s.articleAuthor ? (s.nodeTypes.includes('Person') ? 'Author is a Person in schema' : 'Author is a plain name, not a Person') : 'No author in schema', 'Mark the author up as a Person (name, url, sameAs) in the Article schema.');
    const faqHeads = d.faq.questionHeadings;
    if (s.faqItems > 0) add(69, s.faqItemsValid === s.faqItems ? 'p' : 'f', `${s.faqItemsValid} of ${s.faqItems} FAQ item(s) valid`, 'Every FAQ item needs a name (the question) and an acceptedAnswer with text.');
    else if (faqHeads >= 3) add(69, 'w', `${faqHeads} question headings but no FAQPage schema`, 'Add FAQPage schema for the questions on the page (SEO plugin FAQ block / schema).');
    else add(69, 'n', 'No FAQ content on this page');
  }

  // 16 / 17 scores (need the others)
  out.sort((a, b) => a.id - b.id);
  const seo = scoreRules(out);
  const read = scoreRules(out, READABILITY_IDS);
  out.push({ id: 16, s: seo == null ? 'n' : seo >= 80 ? 'p' : seo >= 60 ? 'w' : 'f', v: seo == null ? 'Not scored' : `${seo}/100`, ...(seo != null && seo < 80 ? { f: 'Work through the items marked Fix, then Warning, in this table: each one raises the score.' } : {}) });
  out.push({ id: 17, s: read == null ? 'n' : read >= 80 ? 'p' : read >= 60 ? 'w' : 'f', v: read == null ? 'Not enough text to score' : `${read}/100`, ...(read != null && read < 80 ? { f: 'Shorten sentences, use active voice and transition words, and add subheadings (parameters 24-31).' } : {}) });
  return out.sort((a, b) => a.id - b.id);
}

// ---- the whole site -----------------------------------------------------------------------------------------------------------

function buildCtx(input: AuditInput): Ctx {
  const ok = input.pages.filter((p) => p.status === 200 && p.deep);
  const indexable = ok.filter((p) => !p.noindex);
  const count = (key: (p: PageRecord) => string | null | undefined) => {
    const m = new Map<string, number>();
    indexable.forEach((p) => {
      const k = key(p);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  };
  const titleDup = count((p) => (p.title ? dec(p.title).toLowerCase() : null));
  const metaDup = count((p) => (p.metaDescription ? dec(p.metaDescription).toLowerCase() : null));
  const hashDup = count((p) => (p.words >= 100 ? p.hash : null));
  // near-duplicate text (min-hash)
  const nearest = new Map<string, { url: string; sim: number }>();
  const cand = indexable.filter((p) => p.words >= 100 && p.deep && p.deep.sig[0] !== -1);
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const sim = similarity(cand[i].deep!.sig, cand[j].deep!.sig);
      if (sim < 0.4) continue;
      if (sim > (nearest.get(cand[i].url)?.sim ?? 0)) nearest.set(cand[i].url, { url: cand[j].url, sim });
      if (sim > (nearest.get(cand[j].url)?.sim ?? 0)) nearest.set(cand[j].url, { url: cand[i].url, sim });
    }
  }
  // cannibalization: same detected keyphrase, or near-identical titles
  const cannibal = new Map<string, string[]>();
  const byKp = new Map<string, PageRecord[]>();
  indexable.filter((p) => p.deep && p.deep.pageType !== 'home' && p.deep.keyphrase.length > 3).forEach((p) => byKp.set(p.deep!.keyphrase, [...(byKp.get(p.deep!.keyphrase) ?? []), p]));
  for (const g of byKp.values()) if (g.length > 1) g.forEach((p) => cannibal.set(p.url, g.filter((o) => o !== p).map((o) => o.url)));
  const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const ts = indexable.filter((p) => p.title && p.deep && p.deep.pageType !== 'home').map((p) => ({ p, t: tokens((p.title ?? '').split(/\s[|\-–—]\s/)[0]) }));
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i].t, b = ts[j].t;
      if (a.size < 3 || b.size < 3) continue;
      let inter = 0;
      a.forEach((w) => b.has(w) && inter++);
      if (inter / (a.size + b.size - inter) >= 0.8) {
        cannibal.set(ts[i].p.url, [...new Set([...(cannibal.get(ts[i].p.url) ?? []), ts[j].p.url])]);
        cannibal.set(ts[j].p.url, [...new Set([...(cannibal.get(ts[j].p.url) ?? []), ts[i].p.url])]);
      }
    }
  }
  // organisation entity
  const orgs = new Map<string, number>();
  ok.forEach((p) => {
    const n = (p.deep!.schema.orgName ?? '').toLowerCase();
    if (n) orgs.set(n, (orgs.get(n) ?? 0) + 1);
  });
  const mainOrg = [...orgs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  // broken links per page
  const badInternal = new Set(input.pages.filter((p) => p.status == null || p.status >= 400).map((p) => bare(p.url)));
  const brokenOn = new Map<string, string[]>();
  const pushBroken = (page: string, u: string) => brokenOn.set(page, [...new Set([...(brokenOn.get(page) ?? []), u])]);
  for (const p of ok) for (const l of p.links?.internal ?? []) if (badInternal.has(bare(l))) pushBroken(p.url, l);
  for (const b of input.brokenLinks) if (!badInternal.has(bare(b.url))) pushBroken(b.foundOn, b.url);
  const llms = new Set((input.checks.llmsTxt.urls ?? []).map(bare));
  return { input, robots: input.robots, checks: input.checks, complete: input.complete, titleDup, metaDup, hashDup, nearest, cannibal, mainOrg, orgCount: orgs.size, llms, brokenOn, psi: input.psi ?? new Map(), psiSample: input.psi?.size ?? 0 };
}

const mostCommon = (xs: string[]): string => {
  const m = new Map<string, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

function aggregate(id: number, rows: Array<{ url: string; r: Rule }>): Rule {
  const measured = rows.filter((x) => x.r.s !== 'n' && x.r.s !== 'i');
  if (!measured.length) {
    const info = rows.filter((x) => x.r.s === 'i').length;
    return { id, s: info ? 'i' : 'n', v: info ? `Informational on ${info} page(s)` : 'Not measured', n: { f: 0, w: 0, t: 0 } };
  }
  const f = measured.filter((x) => x.r.s === 'f');
  const w = measured.filter((x) => x.r.s === 'w');
  const t = measured.length;
  const heavy = (PARAM_BY_ID.get(id)?.weight ?? 1) >= 2;
  const s: St = f.length / t >= 0.25 || (heavy && f.length > 0) ? 'f' : f.length + w.length > 0 ? 'w' : 'p';
  const fixes = [...f, ...w].map((x) => x.r.f ?? '').filter(Boolean);
  return {
    id,
    s,
    v: `${f.length} to fix, ${w.length} warning(s), ${t - f.length - w.length} pass (${t} pages checked)`,
    ...(s !== 'p' ? { f: mostCommon(fixes) } : {}),
    ex: [...f, ...w].slice(0, 6).map((x) => x.url),
    n: { f: f.length, w: w.length, t },
  };
}

export function auditPages(input: AuditInput): PageAuditResult {
  const c = buildCtx(input);
  const pages: PageAuditPage[] = input.pages.map((p) => {
    const rules = evalPage(p, c);
    const seo = scoreRules(rules);
    const read = scoreRules(rules, READABILITY_IDS);
    return {
      url: p.url,
      status: p.status,
      title: p.title ? dec(p.title) : p.deep?.pageName ?? null,
      type: p.deep?.pageType ?? (p.hops > 0 ? 'redirect' : 'error'),
      ms: p.ms,
      unsized: p.imagesNoSize,
      score: seo,
      seo,
      read,
      fix: rules.filter((r) => r.s === 'f').length,
      warn: rules.filter((r) => r.s === 'w').length,
      rules,
    };
  });
  pages.sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || b.fix - a.fix);
  const result: PageAuditResult = { site: input.origin, generatedAt: new Date().toISOString(), pagesAudited: pages.length, scores: { site: null, avgPage: null, pagesToFix: 0, pagesClean: 0 }, root: [], fixes: [], siteIssues: input.issues.slice(0, 40), pages, speedSample: pickSpeedSample(input.pages, input.origin, Number(process.env.PAGESPEED_PAGES) || 8), psi: input.psi?.size ? { tested: input.psi.size, homepage: input.psi.get(bare(input.origin)) ?? null } : null, notes: [] };
  rebuildRoot(result, input, c);
  return result;
}

// Root domain rows: every parameter aggregated across the pages, then the site-level facts override where the parameter is a
// site setting (robots.txt, llms.txt, sitemap, redirects, 404 handling, speed of the homepage...).
function rebuildRoot(res: PageAuditResult, input: AuditInput, c: Ctx): void {
  const chk = input.checks;
  const root: Rule[] = [];
  const homePage = res.pages.find((p) => bare(p.url) === bare(input.origin));
  for (const param of PARAMS) {
    if (param.id === 16 || param.id === 17) continue;
    const rows = res.pages.flatMap((p) => {
      const r = p.rules.find((x) => x.id === param.id);
      return r ? [{ url: p.url, r }] : [];
    });
    root.push(aggregate(param.id, rows));
  }
  const set = (id: number, s: St, v: string, f?: string) => {
    const i = root.findIndex((r) => r.id === id);
    const prev = i >= 0 ? root[i] : ({ id } as Rule);
    const next: Rule = { ...prev, id, s, v: cut(v, 220), n: prev.n };
    if (f && s !== 'p' && s !== 'i' && s !== 'n') next.f = cut(f, 700);
    else delete next.f;
    if (i >= 0) root[i] = next;
    else root.push(next);
  };
  const agg = (id: number): Rule | undefined => root.find((r) => r.id === id);
  const merge = (id: number, extra: string): string => `${extra}${agg(id)?.n && (agg(id)!.n!.f || agg(id)!.n!.w) ? ` Pages: ${agg(id)!.v}.` : ''}`;

  const aiBlocked = chk.robots.aiCrawlers.filter((a) => CORE_AI.includes(a.agent) && !a.allowed).map((a) => a.agent);
  // robots.txt
  {
    const l: Array<[St, string]> = [];
    if (!chk.robots.exists) l.push(['w', 'Create /robots.txt (Rank Math / Yoast > Tools > File editor) that allows crawlers and lists the sitemap.']);
    if (chk.robots.blocksEverything) l.push(['f', 'robots.txt blocks the whole site: remove "Disallow: /" (also untick Settings > Reading > Discourage search engines).']);
    if (chk.robots.exists && !chk.robots.sitemapDeclared) l.push(['w', 'Add a "Sitemap: https://yourdomain/sitemap_index.xml" line to robots.txt.']);
    if (aiBlocked.length) l.push(['w', `robots.txt blocks ${aiBlocked.join(', ')}: allow them if you want to be cited in AI answers.`]);
    const g = grade(l);
    set(43, g.s, `${chk.robots.exists ? 'robots.txt found' : 'No robots.txt'}; ${chk.robots.blocksEverything ? 'blocks everything' : 'does not block the site'}; sitemap ${chk.robots.sitemapDeclared ? 'declared' : 'not declared'}; AI crawlers ${aiBlocked.length ? 'blocked: ' + aiBlocked.join(', ') : 'allowed'}`, g.f);
  }
  // llms.txt
  {
    const L = chk.llmsTxt;
    if (!L.exists) set(44, 'w', 'No /llms.txt', 'Publish /llms.txt: a markdown file with the site name, a one-line summary and links to the key pages (and optionally /llms-full.txt). WordPress: use the llms.txt feature of Rank Math / Yoast / a llms.txt plugin, or upload the file to the site root.');
    else if (!L.wellFormed || L.links < 3) set(44, 'w', `llms.txt exists but ${!L.wellFormed ? 'is not in the expected markdown format (# Title, summary, link lists)' : 'lists only ' + L.links + ' link(s)'}`, 'Start with "# Site name", a short summary, then sections of "- [Page title](URL): description" for the key pages.');
    else set(44, 'p', `llms.txt found with ${L.links} link(s)${L.fullVersion ? ' and llms-full.txt' : ''}`);
    set(21, !L.exists || aiBlocked.length ? (aiBlocked.length ? 'f' : 'w') : (agg(21)?.s ?? 'p'), `${aiBlocked.length ? 'AI crawlers blocked: ' + aiBlocked.join(', ') : 'Main AI crawlers allowed'}; llms.txt ${L.exists ? 'present' : 'missing'}; ${agg(21)?.v ?? ''}`, aiBlocked.length ? `Allow ${aiBlocked.join(', ')} in robots.txt.` : !L.exists ? 'Publish /llms.txt (see parameter 44).' : agg(21)?.f);
  }
  // sitemap
  {
    const S = chk.sitemap;
    const bad = res.pages.filter((p) => p.rules.some((r) => r.id === 14 && r.s === 'f')).length;
    const l: Array<[St, string]> = [];
    if (!S.found) l.push(['f', 'Create an XML sitemap (Rank Math / Yoast / WordPress core) and submit it in Google Search Console and Bing Webmaster Tools.']);
    else {
      if (!S.declaredInRobots) l.push(['w', 'Declare the sitemap in robots.txt.']);
      if (S.total > 0 && S.withLastmod === 0) l.push(['w', 'Add <lastmod> dates to the sitemap.']);
      if (bad) l.push(['w', `${bad} URL problem(s): keep only indexable 200-status pages in the sitemap and add the missing ones.`]);
    }
    const g = grade(l);
    set(14, g.s, S.found ? `${S.total} URL(s) in ${S.files} file(s)${S.indexFile ? ' (index)' : ''}; ${S.withLastmod} with lastmod; ${bad} page(s) with a sitemap problem` : 'No sitemap found', g.f);
  }
  // crawling
  {
    const cr = input.crawl;
    const l: Array<[St, string]> = [];
    if (chk.robots.blocksEverything) l.push(['f', 'Remove the site-wide Disallow in robots.txt.']);
    if (cr.blockedByRobots) l.push(['w', `${cr.blockedByRobots} URL(s) are blocked by robots.txt: confirm that is intended.`]);
    if (cr.discoveredNotCrawled) l.push(['w', `${cr.discoveredNotCrawled} more URL(s) were found than the audit read: raise the crawl limit to cover the whole site.`]);
    const g = grade(l);
    set(20, g.s, `${res.pagesAudited} page(s) read in ${cr.seconds}s (limit ${cr.limit}); ${cr.blockedByRobots} blocked by robots.txt${cr.stoppedEarly ? '; stopped at the time limit' : ''}`, g.f);
  }
  // redirects / not found
  {
    const l: Array<[St, string]> = [];
    if (!chk.https.usesHttps) l.push(['f', 'Serve the whole site over HTTPS (SSL certificate; Settings > General: https:// URLs).']);
    if (chk.https.httpRedirectsToHttps === false) l.push(['f', 'Add a site-wide 301 from http:// to https:// (hosting panel "Force HTTPS", or Really Simple SSL).']);
    if (chk.https.wwwConsistent === false) l.push(['w', 'Both www and non-www load: 301-redirect one to the other and keep one version everywhere.']);
    const n = agg(40)?.n;
    if (n && n.f + n.w > 0) l.push(['w', `${n.f + n.w} page URL(s) redirect: update internal links and the sitemap to the final URLs, and collapse chains to one hop.`]);
    const g = grade(l);
    set(40, g.s, `HTTPS ${chk.https.usesHttps ? 'on' : 'off'}; http to https ${chk.https.httpRedirectsToHttps == null ? 'unknown' : chk.https.httpRedirectsToHttps ? 'redirects' : 'does not redirect'}; www ${chk.https.wwwConsistent === false ? 'inconsistent' : 'consistent'}; ${n ? n.f + n.w : 0} redirecting page URL(s)`, g.f);
    const nf = agg(41)?.n;
    const l2: Array<[St, string]> = [];
    if (chk.notFound.correct404 === false) l2.push(['f', 'Unknown URLs return 200 ("soft 404"): make WordPress / the server answer a real 404 status (check the 404 template and any plugin that redirects 404s to the homepage).']);
    if (nf && nf.f) l2.push(['f', `${nf.f} crawled URL(s) return an error: restore or redirect them.`]);
    const g2 = grade(l2);
    set(41, g2.s, `Unknown URL answers ${chk.notFound.status ?? 'n/a'} (${chk.notFound.correct404 === false ? 'should be 404' : 'correct'}); ${nf?.f ?? 0} error page(s) found`, g2.f);
  }
  // indexing
  {
    const noindexed = res.pages.filter((p) => p.rules.some((r) => r.id === 11 && r.s === 'f')).length;
    const l: Array<[St, string]> = [];
    if (chk.robots.blocksEverything) l.push(['f', 'The whole site is blocked in robots.txt.']);
    if (noindexed) l.push([noindexed / Math.max(res.pagesAudited, 1) > 0.25 ? 'f' : 'w', `${noindexed} page(s) are not indexable: check each is meant to be hidden.`]);
    const verified = !!res.pages.find((p) => bare(p.url) === bare(input.origin)) && input.pages.some((p) => p.verification.google || p.verification.bing);
    if (!verified) l.push(['w', 'No Google / Bing verification tag on the homepage: verify the site in Search Console and Bing Webmaster Tools (a DNS or file verification also works) to see real indexing data.']);
    const g = grade(l);
    set(11, g.s, `${res.pagesAudited - noindexed} of ${res.pagesAudited} pages indexable by their technical signals; Search Console ${verified ? 'tag found' : 'tag not found'}`, g.f);
  }
  // speed (homepage test when available)
  {
    const home = res.psi?.homepage;
    if (home) {
      const sp = speedRules(homePage?.ms ?? chk.headers.ttfbMs, homePage?.unsized ?? 0, home, res.psi?.tested ?? 1);
      for (const r of sp) {
        const prev = agg(r.id);
        set(r.id, r.s, `Homepage: ${r.v}${prev?.n && prev.n.t > 1 ? ` | all tested pages: ${prev.v}` : ''}`, r.f);
      }
    }
    const l: Array<[St, string]> = [];
    if (!chk.headers.compression) l.push(['w', 'Turn on gzip / brotli compression at the server or CDN.']);
    if (!chk.headers.cacheControl) l.push(['w', 'Send Cache-Control headers for static files (cache plugin / CDN).']);
    if (l.length && !home) set(45, 'w', `${merge(45, '')} Homepage: ${chk.headers.compression ? 'compressed' : 'not compressed'}, ${chk.headers.cacheControl ? 'cache headers set' : 'no cache headers'}`.trim(), l.map(([, t]) => t).join(' '));
  }
  // crawl depth / orphans
  {
    const deep = res.pages.filter((p) => p.rules.some((r) => r.id === 53 && r.s !== 'p')).length;
    const orphans = res.pages.filter((p) => p.rules.some((r) => r.id === 19 && /orphan/.test(r.v))).length;
    const l: Array<[St, string]> = [];
    if (deep) l.push(['w', `${deep} page(s) are more than 3 clicks deep: link them from the menu or hub pages.`]);
    if (orphans) l.push(['w', `${orphans} orphan page(s) have no internal link pointing to them: link each from a related page.`]);
    const g = grade(l);
    set(53, g.s, `${deep} page(s) deeper than 3 clicks; ${orphans} orphan page(s)${input.complete ? '' : ' (orphans not checked: the crawl did not cover the whole site)'}`, g.f);
  }
  // uniqueness / cannibalization / entity consistency / organisation
  {
    const dupPages = res.pages.filter((p) => p.rules.some((r) => r.id === 59 && r.s !== 'p' && r.s !== 'n')).length;
    set(59, dupPages === 0 ? 'p' : dupPages / Math.max(res.pagesAudited, 1) >= 0.1 ? 'f' : 'w', `${dupPages} page(s) share identical or near-identical text with another page`, 'Rewrite, merge or canonicalise the duplicate pages listed (parameter 59 per page).');
    const cn = c.cannibal.size;
    set(60, cn === 0 ? 'p' : 'w', `${cn} page(s) compete for the same keyphrase`, 'Assign one keyphrase per page; merge or re-target the competing pages.');
    set(64, c.orgCount > 1 ? 'f' : 'p', c.orgCount > 1 ? `${c.orgCount} different organisation names in schema across the site` : c.orgCount === 1 ? `One organisation entity ("${c.mainOrg}") used consistently` : 'No organisation name found in any schema', c.orgCount > 1 ? 'Use one exact organisation name and URL in all schema (SEO plugin > Schema > Organization) and remove duplicate schema output from the theme / other plugins.' : undefined);
    const home = input.pages.find((p) => bare(p.url) === bare(input.origin));
    const org = !!home?.deep?.schema.nodeTypes.some((t) => /^(Organization|LocalBusiness|Corporation|ProfessionalService)$/.test(t) || /Business$/.test(t));
    set(67, !org ? 'f' : (home?.deep?.schema.sameAs ?? 0) === 0 ? 'w' : 'p', org ? `Homepage Organization schema${home?.deep?.schema.sameAs ? ` with ${home.deep.schema.sameAs} sameAs link(s)` : ' without sameAs'}` : 'No Organization / LocalBusiness schema on the homepage', 'Add Organization / LocalBusiness schema on the homepage with name, url, logo, contact point and sameAs links to every official profile.');
  }
  // Agent readiness (71-79): site-level checks, root domain only
  {
    const A = chk.agent;
    const L = chk.llmsTxt;
    if (A) {
      set(71, A.contentSignal ? 'p' : 'w', A.contentSignal ? `Content-Signal: ${A.contentSignal}` : chk.robots.exists ? 'No Content-Signal directive in robots.txt' : 'No robots.txt, so no Content-Signal', 'Add a Content-Signal line to robots.txt under "User-agent: *", stating how your content may be used, for example "Content-Signal: search=yes, ai-input=yes, ai-train=no". WordPress: Rank Math / Yoast > Tools > File editor (or the robots.txt your host serves).');
      set(72, chk.notFound.correct404 == null ? 'n' : chk.notFound.correct404 ? 'p' : 'f', chk.notFound.correct404 == null ? 'Not tested' : `A non-existent URL answers HTTP ${chk.notFound.status}${chk.notFound.correct404 ? '' : ' (should be 404 or 410)'}`, 'Return a real 404 for missing pages: agents treat HTTP 200 as "this page exists". WordPress: check the theme 404.php and the redirect / SEO plugin setting that sends unknown URLs to the homepage; turn off "redirect all 404s to home" and any catch-all rewrite.');
      const miss = A.business.missing;
      set(73, !A.business.found ? 'f' : miss.length === 0 ? 'p' : 'w', !A.business.found ? 'No Organization / LocalBusiness node on the homepage' : miss.length ? `Business schema is missing: ${miss.join(', ')}` : 'Business schema has name, url, logo, telephone and address', `Fill in the missing fields (${miss.length ? miss.join(', ') : 'name, url, logo, telephone, address'}) in the Organization / LocalBusiness schema so an agent can answer questions about the business without guessing. WordPress: Rank Math > Titles & Meta > Local SEO, or Yoast > Settings > Site representation.`);
      set(74, A.business.sameAs >= 2 ? 'p' : 'w', A.business.sameAs ? `${A.business.sameAs} sameAs link(s) in the business schema${A.business.sameAs < 2 ? ' (add more)' : ''}` : 'No sameAs links in the structured data', 'Add sameAs links to every official profile (LinkedIn, X, Facebook, Instagram, YouTube, Google Business Profile, directories) so agents can confirm you are the same entity. WordPress: Rank Math > Titles & Meta > Local SEO > social profiles, or Yoast > Settings > Site representation > Social profiles.');
      const names: Array<[string, 'url' | 'text' | null]> = [['about', A.pages.about], ['contact', A.pages.contact], ['legal (privacy / terms)', A.pages.legal]];
      const noPg = names.filter(([, v]) => !v).map(([n]) => n);
      const weak = names.filter(([, v]) => v === 'text').map(([n]) => n);
      set(75, noPg.length === 0 && weak.length === 0 ? 'p' : noPg.length === 3 ? 'f' : 'w', [noPg.length && `No homepage link found for: ${noPg.join(', ')}`, weak.length && `Linked only by its text, not by a clear URL: ${weak.join(', ')}`].filter(Boolean).join('; ') || 'About, contact and legal pages are linked from the homepage', `${noPg.length ? `Link the missing page(s) from the homepage header or footer menu: ${noPg.join(', ')}. ` : ''}${weak.length ? `Point the ${weak.join(', ')} link to a clearly named URL (for example /about/, /contact/, /privacy-policy/) so agents can recognise the page from the address. ` : ''}WordPress: Appearance > Menus, and the page slug under Quick Edit.`);
      const llmsOk = L.exists && A.llms.hasTitle && A.llms.hasSummary && L.links >= 3;
      set(76, llmsOk ? 'p' : 'w', !L.exists ? 'No /llms.txt' : `llms.txt ${[!A.llms.hasTitle && 'has no "# " title', !A.llms.hasSummary && 'has no "> " summary', L.links < 3 && `has only ${L.links} markdown link(s)`].filter(Boolean).join(', ') || 'is well-formed'}`, 'Follow the llms.txt format: a "# Site name" title, a "> one-line summary", then sections ("## Services") of markdown links "- [Page title](https://...): what it covers" to your key pages.');
      set(77, A.markdown.ok ? 'p' : 'w', A.markdown.ok ? 'Homepage returns Markdown for Accept: text/markdown' : `Homepage returned '${A.markdown.contentType ?? 'n/a'}' for Accept: text/markdown`, 'Serve a Markdown version when an agent asks for it (Accept: text/markdown): it cuts token cost dramatically versus HTML. WordPress: a Markdown-for-agents plugin, a small mu-plugin / Cloudflare rule that returns the page content as text/markdown, or the "Markdown for Agents" setting on Cloudflare.');
      set(78, A.webmcp ? 'p' : 'w', A.webmcp ? 'WebMCP tools found on the page' : `No WebMCP tools registered on page load (homepage and ${A.webmcpScriptsRead} own script file(s) read)`, 'Call navigator.modelContext.registerTool() on page load with a name, description, inputSchema and execute callback, or annotate a form with toolname and tooldescription, so in-browser agents can use the site (search, contact, booking).');
      const C = A.mcpCard;
      const cardOk = C.status === 200 && C.json && C.hasName && C.hasVersion && C.hasEndpoint;
      set(79, cardOk ? 'p' : 'w', cardOk ? 'MCP Server Card published' : C.status === 200 && !C.json ? `/.well-known/mcp/server-card.json returned ${C.contentType ?? 'something'}, not JSON (probably a catch-all route)` : C.status === 200 ? `MCP Server Card is missing: ${[!C.hasName && 'name', !C.hasVersion && 'version', !C.hasEndpoint && 'endpoint URL'].filter(Boolean).join(', ')}` : `No MCP Server Card (HTTP ${C.status ?? 'n/a'})`, 'Publish an MCP Server Card (SEP-1649) at /.well-known/mcp/server-card.json with name, version, an endpoint URL and the capabilities your server supports; make sure the URL returns application/json, not the theme\'s HTML 404 page.');
    }
  }
  // JS / CSS assets
  {
    const broken = [...input.assetStatus.entries()].filter(([, s]) => s >= 400).map(([u]) => u);
    if (broken.length) set(52, 'f', `${broken.length} stylesheet / script file(s) return an error: ${broken.slice(0, 3).join(', ')}`, 'Fix the path or remove the reference (usually a deleted plugin or theme file).');
  }
  // score and fix list
  res.root = root.sort((a, b) => a.id - b.id);
  const scored = res.pages.filter((p) => p.status === 200 && p.score != null);
  res.scores = {
    site: scoreRules(res.root),
    avgPage: scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null,
    pagesToFix: res.pages.filter((p) => p.fix > 0).length,
    pagesClean: res.pages.filter((p) => p.fix === 0).length,
  };
  res.fixes = res.root
    .filter((r) => (r.s === 'f' || r.s === 'w') && r.f)
    .map((r) => ({ id: r.id, name: PARAM_BY_ID.get(r.id)?.name ?? String(r.id), s: r.s, pages: (r.n?.f ?? 0) + (r.n?.w ?? 0), fix: r.f as string, ex: r.ex ?? [] }))
    .sort((a, b) => (a.s === b.s ? 0 : a.s === 'f' ? -1 : 1) || b.pages - a.pages);
  if (!input.complete) res.notes.push('The crawl did not cover every page of the site, so orphan checks were skipped and the figures describe the pages that were read.');
  if (!res.psi) res.notes.push('Google PageSpeed was not run on individual pages (no global PageSpeed key, or the step has not finished): parameters 46, 47 and 50 are marked "not measured", 45 and 49 use the HTML response time.');
}

// PageSpeed results arrive after the crawl: re-run the six speed parameters for the tested pages and rebuild the root rows.
export function applyPageSpeed(res: PageAuditResult, details: PageSpeedDetail[]): PageAuditResult {
  const map = new Map(details.map((d) => [bare(d.url), d]));
  const sample = details.length;
  for (const p of res.pages) {
    if (p.status !== 200) continue;
    const speed = speedRules(p.ms, p.unsized, map.get(bare(p.url)), sample);
    p.rules = p.rules.filter((r) => ![45, 46, 47, 48, 49, 50, 16, 17].includes(r.id)).concat(speed);
    p.rules.sort((a, b) => a.id - b.id);
    const seo = scoreRules(p.rules);
    const read = scoreRules(p.rules, READABILITY_IDS);
    p.seo = seo;
    p.score = seo;
    p.read = read;
    p.fix = p.rules.filter((r) => r.s === 'f').length;
    p.warn = p.rules.filter((r) => r.s === 'w').length;
    p.rules.push({ id: 16, s: seo == null ? 'n' : seo >= 80 ? 'p' : seo >= 60 ? 'w' : 'f', v: seo == null ? 'Not scored' : `${seo}/100` });
    p.rules.push({ id: 17, s: read == null ? 'n' : read >= 80 ? 'p' : read >= 60 ? 'w' : 'f', v: read == null ? 'Not enough text to score' : `${read}/100` });
    p.rules.sort((a, b) => a.id - b.id);
  }
  res.psi = { tested: sample, homepage: map.get(bare(res.site)) ?? null };
  res.notes = res.notes.filter((n) => !/PageSpeed was not run/.test(n));
  // rebuild the root rows from the updated pages (the crawl-time inputs are kept inside the existing root rows for the others)
  const keep = new Map(res.root.map((r) => [r.id, r]));
  for (const param of PARAMS) {
    if (param.id < 45 || param.id > 50) continue;
    const rows = res.pages.flatMap((p) => {
      const r = p.rules.find((x) => x.id === param.id);
      return r ? [{ url: p.url, r }] : [];
    });
    keep.set(param.id, aggregate(param.id, rows));
  }
  const home = res.psi.homepage;
  const homePage = res.pages.find((p) => bare(p.url) === bare(res.site));
  if (home) {
    for (const r of speedRules(homePage?.ms ?? 0, homePage?.unsized ?? 0, home, sample)) {
      const prev = keep.get(r.id);
      keep.set(r.id, { ...(prev ?? { id: r.id }), id: r.id, s: r.s, v: cut(`Homepage: ${r.v}${prev?.n && prev.n.t > 1 ? ` | all tested pages: ${prev.v}` : ''}`, 220), ...(r.f && r.s !== 'p' && r.s !== 'i' && r.s !== 'n' ? { f: r.f } : {}), n: prev?.n });
    }
  }
  res.root = [...keep.values()].sort((a, b) => a.id - b.id);
  res.scores.site = scoreRules(res.root);
  const scored = res.pages.filter((p) => p.status === 200 && p.score != null);
  res.scores.avgPage = scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null;
  res.scores.pagesToFix = res.pages.filter((p) => p.fix > 0).length;
  res.scores.pagesClean = res.pages.filter((p) => p.fix === 0).length;
  res.fixes = res.root
    .filter((r) => (r.s === 'f' || r.s === 'w') && r.f)
    .map((r) => ({ id: r.id, name: PARAM_BY_ID.get(r.id)?.name ?? String(r.id), s: r.s, pages: (r.n?.f ?? 0) + (r.n?.w ?? 0), fix: r.f as string, ex: r.ex ?? [] }))
    .sort((a, b) => (a.s === b.s ? 0 : a.s === 'f' ? -1 : 1) || b.pages - a.pages);
  return res;
}

// Pages worth a full PageSpeed test: the homepage first, then the shallowest, best-linked indexable pages.
function pickSpeedSample(pages: PageRecord[], origin: string, max: number): string[] {
  const ok = pages.filter((p) => p.status === 200 && !p.noindex);
  const home = ok.find((p) => bare(p.url) === bare(origin));
  const rest = ok.filter((p) => p !== home).sort((a, b) => a.depth - b.depth || b.inbound - a.inbound).slice(0, Math.max(max - 1, 0));
  return [...(home ? [home.url] : []), ...rest.map((p) => p.url)].slice(0, max);
}
