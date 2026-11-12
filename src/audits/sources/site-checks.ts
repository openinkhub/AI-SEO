
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

// "Agent readiness": can an AI agent read, understand and use the site? (robots.txt Content-Signal, real 404s, complete business
// schema, sameAs profiles, about / contact / legal links, llms.txt format, Markdown on request, WebMCP tools, MCP Server Card.)
export interface AgentChecks {
  contentSignal: string | null; // the Content-Signal line from robots.txt
  markdown: { contentType: string | null; ok: boolean };
  mcpCard: { status: number | null; contentType: string | null; json: boolean; hasName: boolean; hasVersion: boolean; hasEndpoint: boolean };
  webmcp: boolean;
  webmcpScriptsRead: number;
  business: { found: boolean; missing: string[]; sameAs: number };
  pages: { about: 'url' | 'text' | null; contact: 'url' | 'text' | null; legal: 'url' | 'text' | null };
  llms: { hasTitle: boolean; hasSummary: boolean };
}

export interface SiteChecks {
  agent: AgentChecks;
  https: { usesHttps: boolean; httpRedirectsToHttps: boolean | null; hsts: boolean; wwwConsistent: boolean | null };
  robots: { exists: boolean; blocksEverything: boolean; sitemapDeclared: boolean; size: number; aiCrawlers: Array<{ agent: string; owner: string; purpose: string; allowed: boolean }> };
  sitemap: SitemapInfo;
  llmsTxt: { exists: boolean; wellFormed: boolean; links: number; size: number; fullVersion: boolean; urls: string[] };
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

// JSON-LD objects of a page (flattened, including @graph).
function ldObjects(html: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  const walk = (x: any): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      out.push(x);
      if (x['@graph']) walk(x['@graph']);
    }
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      /* invalid JSON-LD is reported by the schema parameters */
    }
  }
  return out;
}

const has = (v: any): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : !!v);

function agentChecks(base: string, home: FetchResult, robotsText: string, md: FetchResult | null, card: FetchResult | null, scripts: string[], llmsText: string): AgentChecks {
  const cs = /^\s*content-signal\s*:\s*(.+)$/im.exec(robotsText);
  // business node: the Organization / LocalBusiness node with the most filled fields
  const biz = ldObjects(home.text)
    .filter((o) => ([] as any[]).concat(o['@type'] ?? []).some((t: string) => /^(Organization|Corporation|NGO|ProfessionalService)$/.test(t) || /Business$|Store$|Service$/.test(t)))
    .map((o) => {
      const phone = has(o.telephone) || ([] as any[]).concat(o.contactPoint ?? []).some((c: any) => has(c?.telephone));
      const missing = [!has(o.name) && 'name', !has(o.url) && 'url', !has(o.logo) && !has(o.image) && 'logo', !phone && 'telephone', !has(o.address) && 'address'].filter(Boolean) as string[];
      return { missing, sameAs: ([] as any[]).concat(o.sameAs ?? []).filter((s: any) => typeof s === 'string' && /^https?:/i.test(s)).length };
    })
    .sort((a, b) => a.missing.length - b.missing.length)[0];
  const links = Array.from(home.text.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)).map((m) => {
    let path = m[1].toLowerCase();
    try {
      path = new URL(m[1].replace(/&amp;/g, '&'), `${base}/`).pathname.toLowerCase();
    } catch {
      /* keep the raw href */
    }
    return { path, text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() };
  });
  // a real about / contact / legal link: the page path (or the link text) IS that page, not just a word somewhere in a long URL
  // 'url' = the link goes to a clearly named page (/about/), 'text' = only the link text says so (the URL does not), null = no link
  const any = (pathRe: RegExp, textRe: RegExp): 'url' | 'text' | null => (links.some((l) => pathRe.test(l.path)) ? 'url' : links.some((l) => l.text.length < 40 && textRe.test(l.text)) ? 'text' : null);
  let cardJson: any = null;
  if (card && card.status === 200 && /json/i.test(card.contentType)) {
    try {
      cardJson = JSON.parse(card.text);
    } catch {
      cardJson = null;
    }
  }
  const cardText = cardJson ? JSON.stringify(cardJson) : '';
  return {
    contentSignal: cs ? cs[1].trim() : null,
    markdown: { contentType: md?.contentType || null, ok: !!md && md.status === 200 && /markdown/i.test(md.contentType) },
    mcpCard: {
      status: card?.status ?? null,
      contentType: card?.contentType || null,
      json: !!cardJson && typeof cardJson === 'object',
      hasName: !!cardJson && has(cardJson.name ?? cardJson.serverInfo?.name),
      hasVersion: !!cardJson && has(cardJson.version ?? cardJson.serverInfo?.version),
      hasEndpoint: /"(endpoint|url|remotes|transport)"[^]*https?:\/\//i.test(cardText),
    },
    webmcp: [home.text, ...scripts].some((t) => /navigator\s*\.\s*modelContext|registerTool\s*\(|\btoolname\s*=\s*["']/i.test(t)),
    webmcpScriptsRead: scripts.length,
    business: { found: !!biz, missing: biz?.missing ?? ['name', 'url', 'logo', 'telephone', 'address'], sameAs: biz?.sameAs ?? 0 },
    pages: {
      about: any(/^\/(about|about-us|who-we-are|our-story|our-company|company)\/?$/, /^(about|about us|who we are|our story|our company)$/),
      contact: any(/^\/(contact|contact-us|get-in-touch|reach-us)\/?$/, /^(contact|contact us|get in touch|reach us)$/),
      legal: any(/^\/(privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|terms-conditions|legal|cookie-policy|disclaimer|refund-policy)\/?$/, /^(privacy( policy)?|terms( of service| & conditions| and conditions)?|legal|cookie policy|disclaimer)$/),
    },
    llms: { hasTitle: /^\s*#\s+\S/.test(llmsText), hasSummary: /^\s*>\s+\S/m.test(llmsText) },
  };
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
  // agent-readiness probes: Markdown on request, MCP Server Card, and WebMCP in the homepage's own scripts
  const md = await fetchPage(`${base}/`, { accept: 'text/markdown, text/plain;q=0.5', timeout: 10000 });
  const card = await fetchPage(`${base}/.well-known/mcp/server-card.json`, { accept: 'application/json', timeout: 10000 });
  const srcs = Array.from(home.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi))
    .map((m) => {
      try {
        return new URL(m[1].replace(/&amp;/g, '&'), `${base}/`).href;
      } catch {
        return '';
      }
    })
    .filter((s) => s && hostOf(s) === hostOf(base))
    .slice(0, 8);
  const scriptTexts = (await Promise.all(srcs.map((s) => fetchPage(s, { accept: '*/*', timeout: 8000 })))).filter((r): r is FetchResult => !!r && r.status === 200).map((r) => r.text);
  const checks: SiteChecks = {
    agent: agentChecks(base, home, rr && rr.status === 200 ? rr.text : '', md, card, scriptTexts, llmsOk ? llms!.text : ''),
    https: { usesHttps: u.protocol === 'https:', httpRedirectsToHttps: httpRedirects, hsts: !!h['strict-transport-security'], wwwConsistent },
    robots: { exists: robots.exists, blocksEverything, sitemapDeclared: robots.sitemaps.length > 0, size: robots.size, aiCrawlers },
    sitemap,
    llmsTxt: { exists: llmsOk, wellFormed: llmsOk && /^\s*#\s+\S/.test(llms!.text), links: llmsLinks, size: llmsOk ? llms!.text.length : 0, fullVersion: !!llmsFull && llmsFull.status === 200 && !/<html/i.test(llmsFull.text.slice(0, 300)) && llmsFull.text.trim().length > 0, urls: llmsOk ? Array.from(llms!.text.matchAll(/https?:\/\/[^\s)\]>"']+/g)).map((m) => m[0]).slice(0, 1000) : [] },
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
