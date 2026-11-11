
// One page -> one compact record. Regex based (no DOM library). Covers the on-page checks of a technical audit plus
// the structured-data, social-card and AI-search (AEO / GEO) signals.
import { createHash } from 'crypto';
import { hostOf } from './crawl-http';

export interface PageRecord {
  url: string;
  finalUrl: string;
  status: number | null;
  hops: number;
  ms: number;
  bytes: number;
  depth: number;
  inbound: number; // internal links pointing at this page (filled in after the crawl)
  inSitemap: boolean;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaLength: number;
  h1: string[];
  h1Count: number;
  h2Count: number;
  headingSkips: number;
  words: number;
  images: number;
  imagesMissingAlt: number;
  imagesNoSize: number;
  imagesLegacyFormat: number;
  canonical: string | null;
  canonicalOther: boolean; // canonical points at a different URL
  noindex: boolean;
  nofollowMeta: boolean;
  hreflang: number;
  hreflangXDefault: boolean;
  lang: string | null;
  viewport: boolean;
  charset: boolean;
  favicon: boolean;
  schemaTypes: string[];
  schemaErrors: string[];
  orgSameAs: boolean;
  local: { map: boolean; phone: boolean; address: boolean; reviews: boolean };
  openGraph: { title: boolean; description: boolean; image: boolean; url: boolean };
  twitterCard: string | null;
  dublinCore: boolean;
  internalLinks: number;
  externalLinks: number;
  genericAnchors: number;
  emptyAnchors: number;
  nofollowLinks: number;
  mixedContent: number;
  jsOnly: boolean; // almost no text in the raw HTML but a JS app shell: AI crawlers will see an empty page
  urlIssues: string[];
  hash: string; // fingerprint of the visible text (duplicate content)
  ai: AiSignals;
  verification: { google: boolean; bing: boolean };
  // not stored in the evidence: used while crawling
  links?: { internal: string[]; external: string[] };
}

export interface AiSignals {
  faqSchema: boolean;
  questionHeadings: number;
  answerFirst: boolean; // a short direct answer (25-80 words) opens the page / first section
  passageBlocks: number; // paragraphs of ~120-180 words: the length AI engines quote best
  lists: number;
  tables: number;
  stats: number; // numbers with %, currency or units: specific facts
  author: boolean;
  date: boolean;
  citations: number; // outbound links to other sites inside the text
  eeat: number; // 0-4: author, date, citations, about/contact/org schema signals
}

const first = (html: string, re: RegExp): string | null => {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};
export const strip = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const metaContent = (html: string, attr: 'name' | 'property', val: string): string | null =>
  first(html, new RegExp(`<meta[^>]+${attr}=["']${val}["'][^>]+content=["']([^"']*)["']`, 'i')) ?? first(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${val}["']`, 'i'));

// ---- JSON-LD ------------------------------------------------------------------------------------------------

const REQUIRED: Record<string, string[]> = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'address'],
  WebSite: ['name', 'url'],
  WebPage: ['name'],
  Article: ['headline', 'author', 'datePublished'],
  BlogPosting: ['headline', 'author', 'datePublished'],
  NewsArticle: ['headline', 'author', 'datePublished'],
  FAQPage: ['mainEntity'],
  Product: ['name'],
  Service: ['name'],
  BreadcrumbList: ['itemListElement'],
  Person: ['name'],
  Review: ['reviewRating', 'author'],
  AggregateRating: ['ratingValue'],
  Event: ['name', 'startDate'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate'],
  HowTo: ['name', 'step'],
};
const LOCAL_TYPES = /(LocalBusiness|Restaurant|Store|Dentist|Attorney|RealEstateAgent|ProfessionalService|MedicalBusiness|HealthAndBeautyBusiness|AutomotiveBusiness|FinancialService|HomeAndConstructionBusiness|LodgingBusiness)$/;

export function readSchema(html: string): { types: string[]; errors: string[]; orgHasSameAs: boolean } {
  const types: string[] = [];
  const errors: string[] = [];
  let orgHasSameAs = false;
  let blocks = 0;
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    blocks++;
    let json: unknown;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      errors.push('A JSON-LD block is not valid JSON (it is ignored by search engines).');
      continue;
    }
    const nodes: any[] = [];
    const walk = (n: any) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        nodes.push(n);
        if (n['@graph']) walk(n['@graph']);
      }
    };
    walk(json);
    for (const n of nodes) {
      const t = n['@type'];
      if (!t) continue;
      for (const type of ([] as any[]).concat(t).map(String)) {
        types.push(type);
        const need = REQUIRED[type] ?? (LOCAL_TYPES.test(type) ? REQUIRED.LocalBusiness : null);
        if (need) {
          const missing = need.filter((k) => n[k] == null || n[k] === '' || (Array.isArray(n[k]) && !n[k].length));
          if (missing.length) errors.push(`${type} is missing: ${missing.join(', ')}`);
        }
        if ((type === 'Organization' || LOCAL_TYPES.test(type)) && Array.isArray(n.sameAs) && n.sameAs.length) orgHasSameAs = true;
        if (type === 'Organization' && typeof n.sameAs === 'string') orgHasSameAs = true;
      }
    }
  }
  if (blocks === 0 && /itemtype=["']https?:\/\/schema\.org\//i.test(html)) types.push('Microdata');
  return { types: [...new Set(types)], errors: [...new Set(errors)].slice(0, 8), orgHasSameAs };
}

// ---- links --------------------------------------------------------------------------------------------------

const GENERIC = /^(click here|here|read more|more|learn more|link|this|continue|details|know more)$/i;

function readLinks(html: string, base: string) {
  const internal = new Set<string>();
  const external = new Set<string>();
  let generic = 0, empty = 0, nofollow = 0;
  const h = hostOf(base);
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const href = attrs.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let u: string;
    try {
      u = new URL(href, base).toString().split('#')[0];
    } catch {
      continue;
    }
    if (!/^https?:/i.test(u)) continue;
    const text = strip(m[2]);
    const hasImg = /<img\b/i.test(m[2]);
    if (!text && !hasImg && !/aria-label(ledby)?=|title=/i.test(attrs) && !/<svg\b/i.test(m[2])) empty++;
    if (GENERIC.test(text)) generic++;
    if (/rel=["'][^"']*nofollow/i.test(attrs)) nofollow++;
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|ico|mp4|mp3|docx?|xlsx?)(\?|$)/i.test(u)) continue;
    (hostOf(u) === h ? internal : external).add(u);
  }
  return { internal: [...internal], external: [...external], generic, empty, nofollow };
}

// ---- URL hygiene --------------------------------------------------------------------------------------------

function urlIssues(url: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(url);
    if (url.length > 115) out.push('URL longer than 115 characters');
    if (/[A-Z]/.test(u.pathname)) out.push('Uppercase letters in the URL');
    if (/_/.test(u.pathname)) out.push('Underscores in the URL (use hyphens)');
    if ((u.search.match(/&/g) ?? []).length >= 2) out.push('Several query parameters');
    if (/\/{2,}/.test(u.pathname)) out.push('Double slashes in the URL');
  } catch {
    // ignore
  }
  return out;
}

// ---- AEO / GEO ----------------------------------------------------------------------------------------------

function aiSignals(html: string, text: string, schemaTypes: string[], externalLinks: number, orgSchema: boolean): AiSignals {
  const body = html.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const headings = Array.from(body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)).map((m) => strip(m[2]));
  const questionHeadings = headings.filter((h) => /\?$/.test(h) || /^(what|why|how|when|where|who|which|can|does|do|is|are|should)\b/i.test(h)).length;
  const paras = Array.from(body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map((m) => strip(m[1])).filter((p) => p.length > 0);
  const wc = (s: string) => s.split(' ').filter(Boolean).length;
  const firstPara = paras.find((p) => wc(p) >= 12);
  const answerFirst = !!firstPara && wc(firstPara) >= 25 && wc(firstPara) <= 80;
  const passageBlocks = paras.filter((p) => wc(p) >= 120 && wc(p) <= 180).length;
  const lists = (body.match(/<(ul|ol)\b/gi) ?? []).length;
  const tables = (body.match(/<table\b/gi) ?? []).length;
  const stats = (text.match(/\b\d[\d,.]*\s?(%|percent|million|billion|crore|lakh|k\b|x\b|years?|days?|hours?|\$|₹|£|€)|[$₹£€]\s?\d[\d,.]*/gi) ?? []).length;
  const author = /rel=["']author["']|itemprop=["']author["']|class=["'][^"']*(author|byline)[^"']*["']|\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+|"author"\s*:/.test(html);
  const date = /<time\b|datePublished|dateModified|(last )?(updated|modified|published)\s*(on|:)?\s*\w*\s*\d/i.test(html);
  const citations = Math.min(externalLinks, 50);
  const eeat = [author, date, citations >= 2, orgSchema].filter(Boolean).length;
  return { faqSchema: schemaTypes.includes('FAQPage'), questionHeadings, answerFirst, passageBlocks, lists, tables, stats: Math.min(stats, 99), author, date, citations, eeat };
}

// ---- the page record ----------------------------------------------------------------------------------------

export function analysePage(a: { url: string; finalUrl: string; status: number; hops: number; ms: number; bytes: number; depth: number; headers: Record<string, string>; html: string }): PageRecord {
  const { html } = a;
  const title = first(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const meta = metaContent(html, 'name', 'description');
  const text = strip(html);
  const words = text ? text.split(' ').filter(Boolean).length : 0;
  const imgs = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0]);
  const base = a.finalUrl;
  const l = readLinks(html, base);
  const schema = readSchema(html);
  const robotsMeta = (metaContent(html, 'name', 'robots') ?? '') + ' ' + (metaContent(html, 'name', 'googlebot') ?? '') + ' ' + (a.headers['x-robots-tag'] ?? '');
  const canonical = first(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) ?? first(html, /<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  let canonicalOther = false;
  if (canonical) {
    try {
      const c = new URL(canonical, base).toString().replace(/\/+$/, '');
      canonicalOther = c !== a.finalUrl.replace(/\/+$/, '').split('#')[0] && c !== a.url.replace(/\/+$/, '');
    } catch {
      canonicalOther = true;
    }
  }
  const levels = Array.from(html.matchAll(/<h([1-6])\b/gi)).map((m) => Number(m[1]));
  let skips = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips++;
  const h1s = Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)).map((m) => strip(m[1]).slice(0, 120));
  const isHttps = /^https:/i.test(a.finalUrl);
  const mixed = isHttps ? (html.match(/<(img|script|iframe|source|video|audio)\b[^>]+src=["']http:\/\//gi) ?? []).length + (html.match(/<link\b[^>]+href=["']http:\/\/[^"']+\.css/gi) ?? []).length : 0;
  const jsShell = words < 80 && /<div[^>]+id=["'](root|app|__next|__nuxt)["']|<noscript>[^<]*(enable|require)[^<]*javascript/i.test(html);
  const normalised = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 6000);
  return {
    url: a.url,
    finalUrl: a.finalUrl,
    status: a.status,
    hops: a.hops,
    ms: a.ms,
    bytes: a.bytes,
    depth: a.depth,
    inbound: 0,
    inSitemap: false,
    title,
    titleLength: title?.length ?? 0,
    metaDescription: meta,
    metaLength: meta?.length ?? 0,
    h1: h1s.slice(0, 3),
    h1Count: h1s.length,
    h2Count: (html.match(/<h2\b/gi) ?? []).length,
    headingSkips: skips,
    words,
    images: imgs.length,
    imagesMissingAlt: imgs.filter((t) => !/\balt=["'][^"']+["']/i.test(t) && !/role=["']presentation["']/i.test(t)).length,
    imagesNoSize: imgs.filter((t) => !(/\bwidth=/i.test(t) && /\bheight=/i.test(t))).length,
    imagesLegacyFormat: imgs.filter((t) => /src=["'][^"']+\.(jpe?g|png|gif)(\?[^"']*)?["']/i.test(t)).length,
    canonical,
    canonicalOther,
    noindex: /noindex/i.test(robotsMeta),
    nofollowMeta: /nofollow/i.test(robotsMeta),
    hreflang: (html.match(/<link[^>]+hreflang=/gi) ?? []).length,
    hreflangXDefault: /hreflang=["']x-default["']/i.test(html),
    lang: first(html, /<html[^>]+lang=["']([^"']+)["']/i),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    charset: /<meta[^>]+charset=/i.test(html) || /charset=/i.test(a.headers['content-type'] ?? ''),
    favicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html),
    schemaTypes: schema.types,
    schemaErrors: schema.errors,
    orgSameAs: schema.orgHasSameAs,
    local: {
      map: /<iframe[^>]+(google\.[a-z.]+\/maps|maps\.google|openstreetmap)/i.test(html),
      phone: /href=["']tel:/i.test(html) || /"telephone"\s*:/.test(html),
      address: /<address\b/i.test(html) || /"(streetAddress|address)"\s*:/.test(html),
      reviews: /AggregateRating|"@type"\s*:\s*"Review"|testimonial|customer reviews?|what our (clients|customers)/i.test(html),
    },
    openGraph: {
      title: !!metaContent(html, 'property', 'og:title'),
      description: !!metaContent(html, 'property', 'og:description'),
      image: !!metaContent(html, 'property', 'og:image'),
      url: !!metaContent(html, 'property', 'og:url'),
    },
    twitterCard: metaContent(html, 'name', 'twitter:card'),
    dublinCore: /<meta[^>]+name=["']DC\.(title|creator|description|date)["']/i.test(html),
    internalLinks: l.internal.length,
    externalLinks: l.external.length,
    genericAnchors: l.generic,
    emptyAnchors: l.empty,
    nofollowLinks: l.nofollow,
    mixedContent: mixed,
    jsOnly: jsShell,
    urlIssues: urlIssues(a.finalUrl),
    hash: createHash('sha1').update(normalised).digest('hex').slice(0, 16),
    ai: aiSignals(html, text, schema.types, l.external.length, schema.types.some((t) => t === 'Organization' || LOCAL_TYPES.test(t)) && schema.orgHasSameAs),
    verification: { google: !!metaContent(html, 'name', 'google-site-verification'), bing: !!metaContent(html, 'name', 'msvalidate.01') },
    links: { internal: l.internal, external: l.external },
  };
}
