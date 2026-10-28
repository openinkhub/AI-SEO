// Multi-page crawl of the customer's own site (the "internal audit" evidence): up to MAX_PAGES pages from the
// sitemap or the homepage links, plus a broken-link check on the links found. No paid API, plain fetch.
const UA = 'Mozilla/5.0 (compatible; OpeninkHubAudit/1.0; +https://openinkhub.io)';
const MAX_PAGES = 12;
const MAX_LINKS = 40;

export interface CrawledPage {
  url: string;
  status: number | null;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaLength: number;
  h1: string[];
  h2Count: number;
  words: number;
  images: number;
  imagesMissingAlt: number;
  canonical: string | null;
  noindex: boolean;
  hreflang: number;
  schemaTypes: string[];
  internalLinks: number;
  externalLinks: number;
  openGraph: boolean;
  viewport: boolean;
  lang: string | null;
}

export interface SiteCrawl {
  site: string;
  pagesChecked: number;
  pages: CrawledPage[];
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
}

const withProto = (w: string): string => (/^https?:\/\//i.test(w) ? w : `https://${w}`).replace(/\/+$/, '');
const host = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

async function get(url: string, timeout = 15000): Promise<{ status: number; text: string } | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    const ct = r.headers.get('content-type') ?? '';
    const text = /text|xml|json|html/i.test(ct) || !ct ? (await r.text()).slice(0, 600000) : '';
    return { status: r.status, text };
  } catch {
    return null;
  }
}

const first = (html: string, re: RegExp): string | null => {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};
const strip = (html: string): string =>
  html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

function schemaTypes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: any) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
          if (n['@type']) [].concat(n['@type']).forEach((t: any) => out.push(String(t)));
          if (n['@graph']) walk(n['@graph']);
        }
      };
      walk(JSON.parse(m[1]));
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return [...new Set(out)];
}

function linksOf(html: string, base: string): { internal: string[]; external: string[] } {
  const internal = new Set<string>();
  const external = new Set<string>();
  const h = host(base);
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let u: string;
    try {
      u = new URL(m[1], base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(u) || /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js)(\?|$)/i.test(u)) continue;
    (host(u) === h ? internal : external).add(u.split('#')[0]);
  }
  return { internal: [...internal], external: [...external] };
}

function analyse(url: string, status: number, html: string): CrawledPage {
  const title = first(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const meta = first(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ?? first(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const imgs = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0]);
  const l = linksOf(html, url);
  return {
    url,
    status,
    title,
    titleLength: title?.length ?? 0,
    metaDescription: meta,
    metaLength: meta?.length ?? 0,
    h1: Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)).map((m) => strip(m[1]).slice(0, 100)).slice(0, 3),
    h2Count: (html.match(/<h2\b/gi) ?? []).length,
    words: strip(html).split(' ').filter(Boolean).length,
    images: imgs.length,
    imagesMissingAlt: imgs.filter((t) => !/alt=["'][^"']+["']/i.test(t)).length,
    canonical: first(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    noindex: /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html),
    hreflang: (html.match(/<link[^>]+hreflang=/gi) ?? []).length,
    schemaTypes: schemaTypes(html),
    internalLinks: l.internal.length,
    externalLinks: l.external.length,
    openGraph: /<meta[^>]+property=["']og:title["']/i.test(html),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    lang: first(html, /<html[^>]+lang=["']([^"']+)["']/i),
  };
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function crawlSite(website: string): Promise<SiteCrawl> {
  const base = withProto(website);
  const notes: string[] = [];
  const home = await get(base);
  if (!home) throw new Error(`Could not fetch ${base} - the site may be down or blocking the audit.`);
  const urls: string[] = [base + '/'];
  const sm = await get(`${base}/sitemap.xml`);
  if (sm && sm.status === 200) {
    let locs = Array.from(sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1]);
    const nested = locs.filter((u) => /\.xml(\?|$)/i.test(u));
    if (nested.length && nested.length === locs.length) {
      const sub = await get(nested[0]);
      locs = sub ? Array.from(sub.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1]) : [];
    }
    locs.filter((u) => host(u) === host(base)).forEach((u) => urls.push(u));
  } else notes.push('No sitemap.xml - pages were taken from homepage links.');
  if (urls.length < 3) linksOf(home.text, base).internal.forEach((u) => urls.push(u));
  const pageUrls = [...new Set(urls.map((u) => u.replace(/\/+$/, '/')))].slice(0, MAX_PAGES);

  const pages: CrawledPage[] = [];
  const bodies = new Map<string, string>();
  await pool(pageUrls, 4, async (u) => {
    const r = u === base + '/' ? home : await get(u);
    if (!r) {
      pages.push({ url: u, status: null, title: null, titleLength: 0, metaDescription: null, metaLength: 0, h1: [], h2Count: 0, words: 0, images: 0, imagesMissingAlt: 0, canonical: null, noindex: false, hreflang: 0, schemaTypes: [], internalLinks: 0, externalLinks: 0, openGraph: false, viewport: false, lang: null });
      return;
    }
    bodies.set(u, r.text);
    pages.push(analyse(u, r.status, r.text));
  });
  pages.sort((a, b) => pageUrls.indexOf(a.url) - pageUrls.indexOf(b.url));

  // Broken-link check on the links found on the crawled pages (internal and external).
  const found = new Map<string, string>();
  for (const [u, html] of bodies) {
    const l = linksOf(html, u);
    [...l.internal, ...l.external].forEach((x) => {
      if (!found.has(x) && !pageUrls.includes(x)) found.set(x, u);
    });
  }
  const toCheck = [...found.keys()].slice(0, MAX_LINKS);
  const results = await pool(toCheck, 5, async (u) => {
    let r = null as Response | null;
    try {
      r = await fetch(u, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (r.status === 405 || r.status === 403 || r.status === 501) r = await fetch(u, { method: 'GET', headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    } catch {
      return { url: u, status: 'no response' as number | string };
    }
    return { url: u, status: r.status as number | string };
  });
  const broken = results.filter((r) => typeof r.status === 'string' || (r.status as number) >= 400 && (r.status as number) !== 403 && (r.status as number) !== 429 && (r.status as number) !== 999).map((r) => ({ url: r.url, status: r.status, foundOn: found.get(r.url) as string }));

  const titles = new Map<string, number>();
  pages.forEach((p) => p.title && titles.set(p.title, (titles.get(p.title) ?? 0) + 1));
  return {
    site: base,
    pagesChecked: pages.length,
    pages,
    duplicateTitles: [...titles.entries()].filter(([, c]) => c > 1).map(([t]) => t.slice(0, 100)),
    missingMeta: pages.filter((p) => p.status === 200 && !p.metaDescription).length,
    missingH1: pages.filter((p) => p.status === 200 && p.h1.length === 0).length,
    thinPages: pages.filter((p) => p.status === 200 && p.words < 300).length,
    noindexPages: pages.filter((p) => p.noindex).length,
    imagesMissingAlt: pages.reduce((s, p) => s + p.imagesMissingAlt, 0),
    imagesTotal: pages.reduce((s, p) => s + p.images, 0),
    linksChecked: toCheck.length,
    brokenLinks: broken.slice(0, 20),
    notes,
  };
}
