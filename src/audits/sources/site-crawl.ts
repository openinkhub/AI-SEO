
// Deep crawl of the customer's own site (the "internal audit" evidence). Follows the sitemap and internal links up to
// CRAWL_MAX_PAGES pages (default 500, hard cap 1,000), obeys robots.txt, follows redirects hop by hop, and turns what
// it finds into a ranked issue list, four scores and an AI-search readiness block. No paid API, plain fetch.
import { FetchResult, fetchPage, hostOf, pool, robotsAllows, withProto } from './crawl-http';
import { analysePage, PageRecord } from './page-analysis';
import { runSiteChecks, SiteChecks } from './site-checks';
import { auditPages, PageAuditResult } from './page-rules';

export type CrawledPage = Omit<PageRecord, 'links' | 'deep'>;

export interface CrawlIssue {
  key: string;
  area: 'Technical' | 'On-page' | 'Content' | 'Links' | 'Structured data' | 'Social' | 'AI search' | 'Security' | 'Performance';
  severity: 'critical' | 'warning' | 'notice';
  title: string;
  fix: string;
  count: number;
  examples: string[];
}

export interface SiteCrawl {
  site: string;
  pagesChecked: number;
  summary: {
    indexablePages: number;
    status4xx5xx: number;
    redirectedPages: number;
    redirectChains: number;
    avgWords: number;
    avgResponseMs: number;
    orphanPages: number;
    deepPages: number;
    duplicateContentPages: number;
    sitemapUrls: number;
    pagesNotInSitemap: number;
    blockedByRobots: number;
  };
  scores: { technical: number; onPage: number; structuredData: number; aiReadiness: number; overall: number };
  issues: CrawlIssue[];
  siteChecks: SiteChecks;
  aiReadiness: {
    score: number;
    crawlerAccess: string;
    serverRendered: string;
    llmsTxt: string;
    pagesWithSchema: string;
    organizationSameAs: boolean;
    faqPages: number;
    answerFirstPages: string;
    questionHeadingPages: string;
    pagesWithStats: string;
    authorPages: string;
    datedPages: string;
  };
  crawl: { limit: number; seconds: number; stoppedEarly: boolean; discoveredNotCrawled: number };
  // legacy summary fields (older reports and the task write-ups use these names)
  duplicateTitles: string[];
  missingMeta: number;
  missingH1: number;
  thinPages: number;
  noindexPages: number;
  imagesMissingAlt: number;
  imagesTotal: number;
  linksChecked: number;
  brokenLinks: Array<{ url: string; status: number | string; foundOn: string }>;
  notes: string[];
  pages: CrawledPage[]; // last on purpose: the task write-up keeps only the start of this object
  pageAudit?: PageAuditResult; // the 70-parameter audit (stored as its own evidence rows, not inside the crawl)
}

const SKIP_URL = /(\/wp-admin|\/wp-login|\/wp-json|\/xmlrpc|\/feed\/?$|[?&](replytocom|s|utm_[a-z]+|fbclid|gclid)=)/i;
const norm = (u: string): string => {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return u;
  }
};
// Same page whether or not the URL ends in a slash (used for sitemap / inbound-link matching, never for fetching).
const bare = (u: string): string => norm(u).replace(/\/$/, '');
const pct = (n: number, d: number): string => (d ? `${Math.round((n / d) * 100)}% (${n} of ${d})` : 'n/a');
const share = (n: number, d: number): number => (d ? n / d : 0);

export async function crawlSite(website: string): Promise<SiteCrawl> {
  const started = Date.now();
  const maxPages = Math.min(Math.max(Number(process.env.CRAWL_MAX_PAGES) || 500, 5), 1000);
  const deadline = started + (Number(process.env.CRAWL_DEADLINE_MS) || 170000);
  const notes: string[] = [];
  const start = withProto(website);
  const home = await fetchPage(start + '/');
  if (!home || !home.status) throw new Error(`Could not fetch ${start} - the site may be down, private or blocking the audit.`);
  const origin = new URL(home.url).origin;
  const siteHost = hostOf(origin);

  const { checks, robots } = await runSiteChecks(origin, home);
  const sitemapSet = new Set(checks.sitemap.urls.map(bare));

  // ---- crawl -----------------------------------------------------------------------------------------------
  const seen = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];
  const push = (u: string, depth: number) => {
    const k = norm(u);
    if (seen.has(k) || hostOf(k) !== siteHost || SKIP_URL.test(k)) return;
    seen.add(k);
    queue.push({ url: k, depth });
  };
  push(origin + '/', 0);
  for (const u of checks.sitemap.urls) push(u, 1);
  const pages: PageRecord[] = [];
  const inbound = new Map<string, number>();
  const firstSeenOn = new Map<string, string>();
  const externalSeen = new Map<string, string>();
  let blockedByRobots = 0;

  const crawlOne = async (job: { url: string; depth: number }) => {
    const path = (() => {
      try {
        const u = new URL(job.url);
        return u.pathname + u.search;
      } catch {
        return '/';
      }
    })();
    if (!robotsAllows(robots, 'OpeninkHubAudit', path)) {
      blockedByRobots++;
      return;
    }
    const r: FetchResult | null = job.url === origin + '/' ? home : await fetchPage(job.url);
    if (!r) {
      pages.push({ ...analysePage({ url: job.url, finalUrl: job.url, status: 0, hops: 0, ms: 0, bytes: 0, depth: job.depth, headers: {}, html: '' }), status: null });
      return;
    }
    if (r.text && !/html|xml/i.test(r.contentType) && r.contentType) return; // pdf, json, images: not a page
    const isHome = job.url === origin + '/';
    if (!isHome && r.hops.length > 0) {
      // A redirecting URL is recorded as a redirect (status of its first hop); the page it lands on is crawled on its own.
      const rd = analysePage({ url: job.url, finalUrl: r.url, status: r.hops[0].status, hops: r.hops.length, ms: r.ms, bytes: 0, depth: job.depth, headers: {}, html: '' });
      rd.inSitemap = sitemapSet.has(bare(job.url));
      pages.push(rd);
      if (r.status === 310) return; // loop: nothing to follow
      push(r.url, job.depth);
      return;
    }
    const rec = analysePage({ url: job.url, finalUrl: r.url, status: r.status, hops: r.hops.length, ms: r.ms, bytes: r.bytes, depth: job.depth, headers: r.headers, html: r.text });
    rec.inSitemap = sitemapSet.has(bare(job.url)) || sitemapSet.has(bare(r.url));
    if (isHome) rec.hops = 0;
    pages.push(rec);
    if (r.status === 200 && rec.links) {
      for (const l of rec.links.internal) {
        const k = bare(l);
        inbound.set(k, (inbound.get(k) ?? 0) + 1);
        if (!firstSeenOn.has(k)) firstSeenOn.set(k, job.url);
        push(l, job.depth + 1);
      }
      for (const e of rec.links.external) if (!externalSeen.has(e)) externalSeen.set(e, job.url);
    }
  };

  let stoppedEarly = false;
  while (queue.length && pages.length + blockedByRobots < maxPages) {
    if (Date.now() > deadline) {
      stoppedEarly = true;
      break;
    }
    const room = maxPages - pages.length - blockedByRobots;
    await Promise.all(queue.splice(0, Math.min(6, room)).map(crawlOne));
  }
  const discoveredNotCrawled = queue.length;
  if (stoppedEarly) notes.push(`The crawl hit its time limit after ${pages.length} pages; ${discoveredNotCrawled} more were found but not read.`);
  else if (discoveredNotCrawled) notes.push(`Crawled the first ${pages.length} pages (limit ${maxPages}); ${discoveredNotCrawled} more were found but not read.`);
  if (blockedByRobots) notes.push(`${blockedByRobots} URL(s) were skipped because robots.txt disallows them.`);

  // ---- broken external links (sampled) -----------------------------------------------------------------------
  const broken: Array<{ url: string; status: number | string; foundOn: string }> = [];
  for (const p of pages) if (p.status != null && p.status >= 400) broken.push({ url: p.url, status: p.status, foundOn: firstSeenOn.get(bare(p.url)) ?? '(sitemap)' });
  const extList = [...externalSeen.keys()].slice(0, Date.now() > deadline + 20000 ? 0 : 60);
  const extResults = await pool(extList, 6, async (u) => {
    const r = await fetchPage(u, { method: 'HEAD', timeout: 8000 });
    if (r && (r.status === 405 || r.status === 403 || r.status === 501)) return { url: u, status: (await fetchPage(u, { timeout: 8000 }))?.status ?? 'no response' };
    return { url: u, status: (r ? r.status : 'no response') as number | string };
  });
  for (const r of extResults) {
    if (typeof r.status === 'string' || (r.status >= 400 && ![403, 429, 999].includes(r.status))) broken.push({ url: r.url, status: r.status, foundOn: externalSeen.get(r.url) as string });
  }

  for (const p of pages) p.inbound = inbound.get(bare(p.url)) ?? 0;

  // ---- derived data ------------------------------------------------------------------------------------------
  const ok = pages.filter((p) => p.status === 200);
  const indexable = ok.filter((p) => !p.noindex);
  const urlsOf = (list: PageRecord[]) => list.map((p) => p.url);
  const dupGroups = (key: (p: PageRecord) => string | null) => {
    const m = new Map<string, PageRecord[]>();
    indexable.forEach((p) => {
      const k = key(p);
      if (k) m.set(k, [...(m.get(k) ?? []), p]);
    });
    return [...m.values()].filter((g) => g.length > 1);
  };
  const dupTitle = dupGroups((p) => p.title?.toLowerCase() ?? null);
  const dupMeta = dupGroups((p) => p.metaDescription?.toLowerCase() ?? null);
  const dupH1 = dupGroups((p) => p.h1[0]?.toLowerCase() ?? null);
  const dupContent = dupGroups((p) => (p.words >= 100 ? p.hash : null));
  const complete = !stoppedEarly && discoveredNotCrawled === 0; // orphan detection needs every page's links
  if (!complete) notes.push('Orphan pages were not checked: the crawl did not cover the whole site, so a page may look unlinked only because the pages that link to it were not read.');
  const orphans = !complete ? [] : ok.filter((p) => p.depth > 0 && (inbound.get(bare(p.url)) ?? 0) === 0);
  const chains = pages.filter((p) => p.hops >= 2 || p.status === 310);
  const redirects = pages.filter((p) => p.hops > 0);
  const sitemapBad = pages.filter((p) => p.inSitemap && (p.status !== 200 || p.noindex || p.canonicalOther || p.hops > 0));
  const notInSitemap = checks.sitemap.found ? indexable.filter((p) => !p.inSitemap && !p.canonicalOther && p.depth > 0) : [];
  const homeRec = pages.find((p) => bare(p.url) === bare(origin + '/')) ?? pages[0];
  const aiAllowed = checks.robots.aiCrawlers.filter((c) => ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'].includes(c.agent));
  const aiBlocked = aiAllowed.filter((c) => !c.allowed);

  const issues: CrawlIssue[] = [];
  const add = (key: string, area: CrawlIssue['area'], severity: CrawlIssue['severity'], title: string, fix: string, list: string[] | number, examples?: string[]) => {
    const count = typeof list === 'number' ? list : list.length;
    if (count > 0) issues.push({ key, area, severity, title, fix, count, examples: (examples ?? (Array.isArray(list) ? list : [])).slice(0, 5) });
  };

  // technical
  add('http_errors', 'Technical', 'critical', 'Pages returning an error (4xx / 5xx / no response)', 'Fix or redirect each URL, and remove internal links that point to it.', urlsOf(pages.filter((p) => p.status == null || p.status >= 400)));
  add('robots_blocks_all', 'Technical', 'critical', 'robots.txt blocks the whole site', 'Remove "Disallow: /" for all user agents unless the site is meant to be private.', checks.robots.blocksEverything ? 1 : 0, [origin + '/robots.txt']);
  add('noindex_in_sitemap', 'Technical', 'critical', 'Pages listed in the sitemap but set to noindex', 'Either remove the noindex tag or take the page out of the sitemap.', urlsOf(sitemapBad.filter((p) => p.noindex)));
  add('noindex_pages', 'Technical', 'warning', 'Pages set to noindex (hidden from Google)', 'Confirm each of these is meant to be hidden.', urlsOf(ok.filter((p) => p.noindex && !p.inSitemap)));
  add('redirect_chains', 'Technical', 'warning', 'Redirect chains or loops (2+ hops)', 'Point links and redirects straight at the final URL.', urlsOf(chains));
  add('internal_redirects', 'Technical', 'notice', 'Internal pages that redirect (links should use the final URL)', 'Update the internal links to the final address.', urlsOf(redirects.filter((p) => p.hops === 1)));
  add('no_https', 'Security', 'critical', 'Site is not served over HTTPS', 'Install an SSL certificate and redirect all HTTP traffic to HTTPS.', checks.https.usesHttps ? 0 : 1, [origin]);
  add('http_no_redirect', 'Security', 'critical', 'HTTP version does not redirect to HTTPS', 'Add a site-wide 301 redirect from http:// to https://.', checks.https.httpRedirectsToHttps === false ? 1 : 0, ['http://' + new URL(origin).host + '/']);
  add('www_inconsistent', 'Technical', 'warning', 'Both www and non-www versions load (duplicate site)', 'Pick one version and 301-redirect the other to it.', checks.https.wwwConsistent === false ? 1 : 0, [origin]);
  add('soft_404', 'Technical', 'warning', 'Missing pages answer 200 instead of 404 ("soft 404")', 'Make unknown URLs return a real 404 status.', checks.notFound.correct404 === false ? 1 : 0, [`status ${checks.notFound.status} for a made-up URL`]);
  add('mixed_content', 'Security', 'warning', 'HTTPS pages loading insecure (http://) files', 'Change those file links to https://.', urlsOf(ok.filter((p) => p.mixedContent > 0)));
  add('missing_hsts', 'Security', 'notice', 'No HSTS header', 'Add Strict-Transport-Security so browsers always use HTTPS.', checks.https.usesHttps && !checks.https.hsts ? 1 : 0, [origin]);
  add('security_headers', 'Security', 'notice', 'Security headers missing (X-Content-Type-Options, frame protection, Referrer-Policy)', 'Add the headers at the server or CDN.', [checks.headers.xContentTypeOptions, checks.headers.frameProtection, checks.headers.referrerPolicy].filter((x) => !x).length, [origin]);
  add('no_compression', 'Performance', 'warning', 'Homepage is not compressed (no gzip / brotli)', 'Enable gzip or brotli compression on the server.', checks.headers.compression ? 0 : 1, [origin]);
  add('slow_pages', 'Performance', 'warning', 'Slow pages (over 2 seconds to load the HTML)', 'Check hosting, caching and heavy plugins on these pages.', urlsOf(ok.filter((p) => p.ms > 2000)));
  add('heavy_pages', 'Performance', 'warning', 'Very large HTML pages (over 1 MB)', 'Trim inline scripts, styles and repeated blocks.', urlsOf(ok.filter((p) => p.bytes > 1_000_000)));
  add('no_viewport', 'Technical', 'critical', 'Pages without a mobile viewport tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', urlsOf(ok.filter((p) => !p.viewport)));
  add('no_lang', 'Technical', 'notice', 'Pages without a language attribute', 'Add lang="en" (or the right language) to the <html> tag.', urlsOf(ok.filter((p) => !p.lang)));
  add('no_favicon', 'Technical', 'notice', 'No favicon found', 'Add a favicon (link rel="icon" or /favicon.ico).', checks.favicon || (homeRec && homeRec.favicon) ? 0 : 1, [origin]);
  add('canonical_missing', 'Technical', 'warning', 'Pages without a canonical tag', 'Add a self-referencing canonical link to every indexable page.', urlsOf(indexable.filter((p) => !p.canonical)));
  add('canonical_other', 'Technical', 'warning', 'Pages whose canonical points to a different URL', 'Check these are meant to defer to another page; otherwise fix the canonical.', urlsOf(indexable.filter((p) => p.canonicalOther)));
  add('url_hygiene', 'Technical', 'notice', 'URLs that are long, uppercase, use underscores or many parameters', 'Use short, lowercase, hyphenated URLs.', urlsOf(ok.filter((p) => p.urlIssues.length)));
  add('orphan_pages', 'Links', 'warning', 'Orphan pages (no internal link points to them)', 'Link to each of these from a relevant page or the menu.', urlsOf(orphans));
  add('deep_pages', 'Links', 'notice', 'Pages more than 3 clicks from the homepage', 'Link to important pages from higher-level pages.', urlsOf(ok.filter((p) => p.depth > 3)));
  add('broken_links', 'Links', 'critical', 'Broken links (internal pages and sampled external links)', 'Update or remove each broken link.', broken.map((b) => `${b.url} (${b.status}) on ${b.foundOn}`));
  add('generic_anchors', 'Links', 'notice', 'Links with generic text ("click here", "read more")', 'Use descriptive link text that names the destination.', urlsOf(ok.filter((p) => p.genericAnchors > 0)));
  add('empty_anchors', 'Links', 'notice', 'Links with no text and no image alt', 'Add visible text or an aria-label.', urlsOf(ok.filter((p) => p.emptyAnchors > 0)));
  // sitemap
  add('sitemap_missing', 'Technical', 'critical', 'No XML sitemap found', 'Create a sitemap.xml and submit it in Search Console.', checks.sitemap.found ? 0 : 1, [origin + '/sitemap.xml']);
  add('sitemap_not_in_robots', 'Technical', 'notice', 'Sitemap is not declared in robots.txt', 'Add a "Sitemap: https://..." line to robots.txt.', checks.sitemap.found && !checks.sitemap.declaredInRobots ? 1 : 0, [origin + '/robots.txt']);
  add('sitemap_bad_urls', 'Technical', 'warning', 'Sitemap lists URLs that error, redirect, are noindex or canonical elsewhere', 'Keep only indexable 200-status URLs in the sitemap.', urlsOf(sitemapBad));
  add('pages_not_in_sitemap', 'Technical', 'notice', 'Indexable pages found by crawling but missing from the sitemap', 'Add them to the sitemap.', urlsOf(notInSitemap));
  add('sitemap_no_lastmod', 'Technical', 'notice', 'Sitemap has no <lastmod> dates', 'Add accurate last-modified dates so crawlers revisit changed pages.', checks.sitemap.found && checks.sitemap.total > 0 && checks.sitemap.withLastmod === 0 ? 1 : 0, [checks.sitemap.url ?? '']);
  // on-page
  add('title_missing', 'On-page', 'critical', 'Pages with no title tag', 'Write a unique title of about 30-60 characters with the main keyword.', urlsOf(ok.filter((p) => !p.title)));
  add('title_length', 'On-page', 'warning', 'Titles too long (over 60) or too short (under 30 characters)', 'Aim for 30-60 characters.', urlsOf(ok.filter((p) => p.title && (p.titleLength > 60 || p.titleLength < 30))));
  add('title_duplicate', 'On-page', 'warning', 'Pages sharing the same title', 'Give every page its own title.', dupTitle.flat().length, dupTitle.flat().map((p) => p.url));
  add('meta_missing', 'On-page', 'warning', 'Pages with no meta description', 'Write a 70-160 character description that earns the click.', urlsOf(ok.filter((p) => !p.metaDescription)));
  add('meta_length', 'On-page', 'notice', 'Meta descriptions too long (over 160) or too short (under 70)', 'Aim for 70-160 characters.', urlsOf(ok.filter((p) => p.metaDescription && (p.metaLength > 160 || p.metaLength < 70))));
  add('meta_duplicate', 'On-page', 'warning', 'Pages sharing the same meta description', 'Write a unique description for each page.', dupMeta.flat().length, dupMeta.flat().map((p) => p.url));
  add('h1_missing', 'On-page', 'warning', 'Pages with no H1 heading', 'Add one H1 that states what the page is about.', urlsOf(ok.filter((p) => p.h1Count === 0)));
  add('h1_multiple', 'On-page', 'notice', 'Pages with more than one H1', 'Keep one H1 per page.', urlsOf(ok.filter((p) => p.h1Count > 1)));
  add('h1_duplicate', 'On-page', 'notice', 'Pages sharing the same H1', 'Write a distinct H1 for each page.', dupH1.flat().length, dupH1.flat().map((p) => p.url));
  add('heading_skips', 'On-page', 'notice', 'Heading levels that skip (for example H2 straight to H4)', 'Use headings in order: H1, H2, H3.', urlsOf(ok.filter((p) => p.headingSkips > 0)));
  add('thin_content', 'Content', 'warning', 'Thin pages (under 300 words)', 'Expand with useful, specific content or merge into a stronger page.', urlsOf(ok.filter((p) => p.words < 300)));
  add('duplicate_content', 'Content', 'warning', 'Pages with identical body text', 'Merge, rewrite or canonicalise the duplicates.', dupContent.flat().length, dupContent.flat().map((p) => p.url));
  add('images_alt', 'On-page', 'warning', 'Images without alt text', 'Add short descriptive alt text to every meaningful image.', urlsOf(ok.filter((p) => p.imagesMissingAlt > 0)));
  add('images_size', 'Performance', 'notice', 'Images without width and height (layout shift)', 'Set width and height attributes on images.', urlsOf(ok.filter((p) => p.imagesNoSize > 0)));
  add('images_format', 'Performance', 'notice', 'Images in older formats (JPG / PNG)', 'Serve WebP or AVIF where possible.', urlsOf(ok.filter((p) => p.imagesLegacyFormat > 0)));
  add('hreflang_xdefault', 'Technical', 'notice', 'hreflang used without an x-default', 'Add an x-default hreflang for the fallback version.', urlsOf(ok.filter((p) => p.hreflang > 0 && !p.hreflangXDefault)));
  // structured data and social
  add('no_schema', 'Structured data', 'warning', 'Pages with no structured data (JSON-LD)', 'Add schema that matches the page (Organization, Article, FAQ, Service, Breadcrumb).', urlsOf(ok.filter((p) => !p.schemaTypes.length)));
  add('schema_errors', 'Structured data', 'warning', 'Structured data with missing required fields or invalid JSON', 'Fix the listed fields and re-test in Google\'s Rich Results Test.', urlsOf(ok.filter((p) => p.schemaErrors.length)), ok.filter((p) => p.schemaErrors.length).map((p) => `${p.url}: ${p.schemaErrors[0]}`));
  add('no_org_schema', 'Structured data', 'warning', 'No Organization / LocalBusiness schema on the homepage', 'Add Organization (or LocalBusiness) schema with name, url, logo and sameAs.', homeRec && !homeRec.schemaTypes.some((t) => /Organization|LocalBusiness|Store|Restaurant|ProfessionalService/.test(t)) ? 1 : 0, [origin + '/']);
  add('no_breadcrumb_schema', 'Structured data', 'notice', 'No BreadcrumbList schema on inner pages', 'Add breadcrumb schema to inner pages.', ok.filter((p) => p.depth > 0).length > 0 && !ok.some((p) => p.schemaTypes.includes('BreadcrumbList')) ? 1 : 0, [origin + '/']);
  add('og_incomplete', 'Social', 'warning', 'Pages missing Open Graph tags (title, description, image, url)', 'Add all four og: tags so shares look right.', urlsOf(ok.filter((p) => !(p.openGraph.title && p.openGraph.description && p.openGraph.image && p.openGraph.url))));
  add('twitter_card', 'Social', 'notice', 'Pages without a Twitter / X card tag', 'Add twitter:card (summary_large_image).', urlsOf(ok.filter((p) => !p.twitterCard)));
  add('search_verification', 'Technical', 'notice', 'No Google or Bing site-verification tag on the homepage', 'Verify the site in Search Console and Bing Webmaster Tools (a tag, file or DNS record all work).', homeRec && !homeRec.verification.google && !homeRec.verification.bing ? 1 : 0, [origin + '/']);
  // AI search
  add('ai_crawlers_blocked', 'AI search', 'warning', 'robots.txt blocks AI crawlers: ' + aiBlocked.map((c) => c.agent).join(', '), 'Allow GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and Google-Extended unless blocking is deliberate.', aiBlocked.length, aiBlocked.map((c) => c.agent));
  add('llms_txt', 'AI search', 'notice', 'No llms.txt file', 'Publish /llms.txt: a short markdown map of the site and its key pages for AI tools.', checks.llmsTxt.exists ? 0 : 1, [origin + '/llms.txt']);
  add('js_only', 'AI search', 'critical', 'Pages that show almost no text without JavaScript', 'Render the main content on the server: AI crawlers do not run JavaScript.', urlsOf(ok.filter((p) => p.jsOnly)));
  add('no_answer_first', 'AI search', 'notice', 'Content pages with no short direct answer near the top (25-80 words)', 'Open each page with a clear, quotable answer before the detail.', urlsOf(ok.filter((p) => p.words >= 300 && !p.ai.answerFirst)));
  add('no_faq', 'AI search', 'notice', 'No FAQ content or FAQPage schema anywhere on the site', 'Add question-style sections with FAQPage schema on service pages.', ok.some((p) => p.ai.faqSchema || p.ai.questionHeadings >= 3) ? 0 : 1, [origin + '/']);
  add('no_trust_signals', 'AI search', 'notice', 'Long pages with no author name or date', 'Show the author and a last-updated date on articles.', urlsOf(ok.filter((p) => p.words >= 600 && !p.ai.author && !p.ai.date)));
  add('no_org_sameas', 'AI search', 'notice', 'Organization schema has no sameAs links', 'Link your social profiles, Wikipedia / Wikidata and directory listings in sameAs.', ok.some((p) => p.schemaTypes.some((t) => /Organization|LocalBusiness/.test(t))) && !ok.some((p) => p.orgSameAs) ? 1 : 0, [origin + '/']);
  const order = { critical: 0, warning: 1, notice: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);

  // ---- the 70-parameter audit: every page and the root domain ------------------------------------------------------
  const assetStatus = new Map<string, number>();
  if (Date.now() < deadline + 25000) {
    const assets = [...new Set(pages.flatMap((p) => p.deep?.assets ?? []))].slice(0, 60);
    await pool(assets, 6, async (u) => {
      const r = await fetchPage(u, { method: 'HEAD', timeout: 8000 });
      if (r && (r.status === 404 || r.status === 410 || r.status >= 500)) assetStatus.set(u, r.status);
    });
  }
  const pageAudit = auditPages({
    origin,
    pages,
    checks,
    robots,
    brokenLinks: broken,
    assetStatus,
    complete,
    crawl: { limit: maxPages, seconds: Math.round((Date.now() - started) / 1000), stoppedEarly, discoveredNotCrawled, blockedByRobots },
    issues: issues.map((i) => ({ severity: i.severity, area: i.area, title: i.title, fix: i.fix, count: i.count, examples: i.examples })),
  });

  // ---- scores -----------------------------------------------------------------------------------------------
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) : 0);
  const n = ok.length;
  const technical = avg([
    share(ok.length, pages.length - redirects.length), share(n - chains.length, n), share(indexable.filter((p) => p.canonical && !p.canonicalOther).length, indexable.length), share(ok.filter((p) => p.viewport).length, n), share(ok.filter((p) => p.ms <= 2000).length, n),
    checks.https.usesHttps ? 1 : 0, checks.https.httpRedirectsToHttps === false ? 0 : 1, checks.robots.exists && !checks.robots.blocksEverything ? 1 : 0, checks.sitemap.found ? 1 : 0, checks.notFound.correct404 === false ? 0 : 1, checks.headers.compression ? 1 : 0, share(n - orphans.length, n),
  ]);
  const onPage = avg([
    share(ok.filter((p) => p.title && p.titleLength >= 30 && p.titleLength <= 60).length, n), share(ok.filter((p) => p.metaDescription && p.metaLength >= 70 && p.metaLength <= 160).length, n), share(ok.filter((p) => p.h1Count === 1).length, n),
    share(ok.filter((p) => p.imagesMissingAlt === 0).length, n), share(n - dupTitle.flat().length, n), share(n - dupMeta.flat().length, n), share(ok.filter((p) => p.words >= 300).length, n),
  ]);
  const structuredData = avg([share(ok.filter((p) => p.schemaTypes.length).length, n), share(ok.filter((p) => p.schemaTypes.length && !p.schemaErrors.length).length, n), homeRec && homeRec.schemaTypes.some((t) => /Organization|LocalBusiness/.test(t)) ? 1 : 0, share(ok.filter((p) => p.openGraph.title && p.openGraph.image).length, n), share(ok.filter((p) => p.twitterCard).length, n)]);
  const coreAi = checks.robots.aiCrawlers.filter((c) => ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'].includes(c.agent));
  const aiScore = avg([
    share(coreAi.filter((c) => c.allowed).length, coreAi.length), share(n - ok.filter((p) => p.jsOnly).length, n), checks.llmsTxt.exists ? 1 : 0, share(ok.filter((p) => p.schemaTypes.length).length, n),
    share(ok.filter((p) => p.ai.answerFirst).length, n), share(ok.filter((p) => p.ai.questionHeadings > 0 || p.ai.faqSchema).length, n), share(ok.filter((p) => p.ai.stats > 0).length, n), share(ok.filter((p) => p.ai.author || p.ai.date).length, n),
  ]);

  const titles = new Map<string, number>();
  indexable.forEach((p) => p.title && titles.set(p.title, (titles.get(p.title) ?? 0) + 1));
  const result: SiteCrawl = {
    site: origin,
    pagesChecked: pages.length,
    summary: {
      indexablePages: indexable.length,
      status4xx5xx: pages.filter((p) => p.status == null || p.status >= 400).length,
      redirectedPages: pages.filter((p) => p.hops > 0).length,
      redirectChains: chains.length,
      avgWords: n ? Math.round(ok.reduce((s, p) => s + p.words, 0) / n) : 0,
      avgResponseMs: n ? Math.round(ok.reduce((s, p) => s + p.ms, 0) / n) : 0,
      orphanPages: orphans.length,
      deepPages: ok.filter((p) => p.depth > 3).length,
      duplicateContentPages: dupContent.flat().length,
      sitemapUrls: checks.sitemap.total,
      pagesNotInSitemap: notInSitemap.length,
      blockedByRobots,
    },
    scores: { technical, onPage, structuredData, aiReadiness: aiScore, overall: Math.round((technical + onPage + structuredData + aiScore) / 4) },
    issues,
    siteChecks: checks,
    aiReadiness: {
      score: aiScore,
      crawlerAccess: `${coreAi.filter((c) => c.allowed).length} of ${coreAi.length} main AI crawlers allowed`,
      serverRendered: pct(n - ok.filter((p) => p.jsOnly).length, n),
      llmsTxt: checks.llmsTxt.exists ? (checks.llmsTxt.wellFormed ? 'present and well formed' : 'present but not in the expected markdown format') : 'missing',
      pagesWithSchema: pct(ok.filter((p) => p.schemaTypes.length).length, n),
      organizationSameAs: ok.some((p) => p.orgSameAs),
      faqPages: ok.filter((p) => p.ai.faqSchema || p.ai.questionHeadings >= 3).length,
      answerFirstPages: pct(ok.filter((p) => p.ai.answerFirst).length, n),
      questionHeadingPages: pct(ok.filter((p) => p.ai.questionHeadings > 0).length, n),
      pagesWithStats: pct(ok.filter((p) => p.ai.stats > 0).length, n),
      authorPages: pct(ok.filter((p) => p.ai.author).length, n),
      datedPages: pct(ok.filter((p) => p.ai.date).length, n),
    },
    crawl: { limit: maxPages, seconds: Math.round((Date.now() - started) / 1000), stoppedEarly, discoveredNotCrawled },
    duplicateTitles: [...titles.entries()].filter(([, c]) => c > 1).map(([t]) => t.slice(0, 100)),
    missingMeta: ok.filter((p) => !p.metaDescription).length,
    missingH1: ok.filter((p) => p.h1Count === 0).length,
    thinPages: ok.filter((p) => p.words < 300).length,
    noindexPages: pages.filter((p) => p.noindex).length,
    imagesMissingAlt: pages.reduce((s, p) => s + p.imagesMissingAlt, 0),
    imagesTotal: pages.reduce((s, p) => s + p.images, 0),
    linksChecked: extList.length + pages.length,
    brokenLinks: broken.slice(0, 40),
    notes: [...notes, ...checks.notes],
    pages: pages.map(({ links, deep, ...rest }) => rest),
  };
  result.pageAudit = pageAudit;
  return result;
}
