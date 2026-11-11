
// Site-level checks (one set per site, not per page): HTTPS and redirects, robots.txt and AI crawler access,
// sitemaps, llms.txt, 404 handling, security / performance headers and search-engine verification.
import { FetchResult, fetchPage, hostOf, parseRobots, Robots, robotsAllows } from './crawl-http';

export const AI_CRAWLERS: Array<{ agent: string; owner: string; purpose: string }> = [
  { agent: 'GPTBot', owner: 'OpenAI', purpose: 'ChatGPT training / answers' },
  { agent: 'OAI-SearchBot', owner: 'OpenAI', purpose: 'ChatGPT search results' },
  { agent: 'ChatGPT-User', owner: 'OpenAI', purpose: 'ChatGPT visiting a page for a user' },
  { agent: 'ClaudeBot', owner: 'Anthropic', purpose: 'Claude' },
  { agent: 'PerplexityBot', owner: 'Perplexity', purpose: 'Perplexity answers' },
  { agent: 'Google-Extended', owner: 'Google', purpose: 'Gemini / AI Overviews training control' },
  { agent: 'Applebot-Extended', owner: 'Apple', purpose: 'Apple Intelligence' },
  { agent: 'CCBot', owner: 'Common Crawl', purpose: 'Open dataset used by many models' },
  { agent: 'Bytespider', owner: 'ByteDance', purpose: 'Doubao / TikTok models' },
  { agent: 'Amazonbot', owner: 'Amazon', purpose: 'Alexa answers' },
  { agent: 'meta-externalagent', owner: 'Meta', purpose: 'Meta AI' },
];

export interface SitemapInfo {
  found: boolean;
  url: string | null;
  indexFile: boolean;
  files: number;
  urls: string[]; // page URLs listed (capped)
  total: number;
  withLastmod: number;
  imageEntries: number;
  overLimit: boolean;
  declaredInRobots: boolean;
}

export interface SiteChecks {
  https: { usesHttps: boolean; httpRedirectsToHttps: boolean | null; hsts: boolean; wwwConsistent: boolean | null };
  robots: { exists: boolean; blocksEverything: boolean; sitemapDeclared: boolean; size: number; aiCrawlers: Array<{ agent: string; owner: string; purpose: string; allowed: boolean }> };
  sitemap: SitemapInfo;
  llmsTxt: { exists: boolean; wellFormed: boolean; links: number; size: number; fullVersion: boolean };
  notFound: { correct404: boolean | null; status: number | null };
  headers: { compression: string | null; cacheControl: boolean; xContentTypeOptions: boolean; frameProtection: boolean; referrerPolicy: boolean; csp: boolean; server: string | null; ttfbMs: number };
  favicon: boolean;
  verification: { google: boolean; bing: boolean };
  indexNow: string;
  notes: string[];
}

const locs = (xml: string): string[] => Array.from(xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi)).map((m) => m[1].replace(/&amp;/g, '&'));

async function readSitemaps(base: string, robots: Robots, notes: string[]): Promise<SitemapInfo> {
  const candidates = [...robots.sitemaps, `${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`, `${base}/sitemap-index.xml`];
  const seenFiles = new Set<string>();
  const urls: string[] = [];
  let total = 0, withLastmod = 0, imageEntries = 0, files = 0, indexFile = false;
  let firstUrl: string | null = null;
  const queue = [...new Set(candidates)];
  while (queue.length && files < 15) {
    const u = queue.shift() as string;
    if (seenFiles.has(u)) continue;
    seenFiles.add(u);
    const r = await fetchPage(u, { accept: 'application/xml,text/xml,*/*', timeout: 12000 });
    if (!r || r.status !== 200 || !/<(urlset|sitemapindex)\b/i.test(r.text)) continue;
    files++;
    firstUrl ??= u;
    if (/<sitemapindex\b/i.test(r.text)) {
      indexFile = true;
      queue.unshift(...locs(r.text).slice(0, 12));
    } else {
      const entries = r.text.split(/<url>/i).slice(1);
      for (const e of entries) {
        total++;
        if (/<lastmod>/i.test(e)) withLastmod++;
        if (/<image:image>/i.test(e)) imageEntries++;
        const loc = locs(e)[0];
        if (loc && urls.length < 5000) urls.push(loc);
      }
    }
  }
  if (!files) notes.push('No sitemap found at the usual locations or in robots.txt.');
  return { found: files > 0, url: firstUrl, indexFile, files, urls, total, withLastmod, imageEntries, overLimit: total > 50000, declaredInRobots: robots.sitemaps.length > 0 };
}

export async function runSiteChecks(base: string, home: FetchResult): Promise<{ checks: SiteChecks; robots: Robots }> {
  const notes: string[] = [];
  const u = new URL(base);
  const rr = await fetchPage(`${base}/robots.txt`, { accept: 'text/plain,*/*', timeout: 10000 });
  const robots = parseRobots(rr && rr.status === 200 && !/<html/i.test(rr.text.slice(0, 300)) ? rr.text : null);
  const star = robots.groups.find((g) => g.agents.includes('*'));
  const blocksEverything = !!star && star.disallow.includes('/') && !star.allow.length;
  const aiCrawlers = AI_CRAWLERS.map((c) => ({ ...c, allowed: robotsAllows(robots, c.agent, '/') }));

  const sitemap = await readSitemaps(base, robots, notes);

  // llms.txt: the emerging "map of the site for AI" file (a markdown file with a title and links).
  const llms = await fetchPage(`${base}/llms.txt`, { accept: 'text/plain,*/*', timeout: 10000 });
  const llmsOk = !!llms && llms.status === 200 && !/<html/i.test(llms.text.slice(0, 300)) && llms.text.trim().length > 0;
  const llmsFull = await fetchPage(`${base}/llms-full.txt`, { accept: 'text/plain,*/*', timeout: 10000 });
  const llmsLinks = llmsOk ? (llms!.text.match(/\]\(https?:\/\//g) ?? []).length : 0;

  // HTTP -> HTTPS and www / non-www
  let httpRedirects: boolean | null = null;
  if (u.protocol === 'https:') {
    const h = await fetchPage(`http://${u.host}/`, { method: 'GET', timeout: 10000 });
    httpRedirects = h ? /^https:/i.test(h.url) : null;
  }
  let wwwConsistent: boolean | null = null;
  const bare = u.hostname.replace(/^www\./, '');
  const alt = u.hostname.startsWith('www.') ? bare : `www.${bare}`;
  const altRes = await fetchPage(`${u.protocol}//${alt}/`, { timeout: 10000 });
  if (altRes) wwwConsistent = hostOf(altRes.url) === hostOf(base) && new URL(altRes.url).hostname === u.hostname;

  // A made-up URL must answer 404, not 200 (a "soft 404" confuses crawlers).
  const nf = await fetchPage(`${base}/openink-audit-404-check-${Date.now().toString(36)}`, { timeout: 10000 });
  const h = home.headers;
  const checks: SiteChecks = {
    https: { usesHttps: u.protocol === 'https:', httpRedirectsToHttps: httpRedirects, hsts: !!h['strict-transport-security'], wwwConsistent },
    robots: { exists: robots.exists, blocksEverything, sitemapDeclared: robots.sitemaps.length > 0, size: robots.size, aiCrawlers },
    sitemap,
    llmsTxt: { exists: llmsOk, wellFormed: llmsOk && /^#\s+\S/m.test(llms!.text), links: llmsLinks, size: llmsOk ? llms!.text.length : 0, fullVersion: !!llmsFull && llmsFull.status === 200 && !/<html/i.test(llmsFull.text.slice(0, 300)) && llmsFull.text.trim().length > 0 },
    notFound: { correct404: nf ? nf.status === 404 || nf.status === 410 : null, status: nf?.status ?? null },
    headers: {
      compression: h['content-encoding'] ?? null,
      cacheControl: !!h['cache-control'],
      xContentTypeOptions: /nosniff/i.test(h['x-content-type-options'] ?? ''),
      frameProtection: !!h['x-frame-options'] || /frame-ancestors/i.test(h['content-security-policy'] ?? ''),
      referrerPolicy: !!h['referrer-policy'],
      csp: !!h['content-security-policy'],
      server: h['server'] ?? null,
      ttfbMs: home.ms,
    },
    favicon: false,
    verification: { google: false, bing: false },
    indexNow: 'Cannot be read from outside the site: IndexNow keeps its key file under a private name. Confirm it in the WordPress plugin (IndexNow switched on, key file reachable).',
    notes,
  };
  const fav = await fetchPage(`${base}/favicon.ico`, { method: 'HEAD', timeout: 8000 });
  checks.favicon = !!fav && fav.status === 200;
  return { checks, robots };
}
