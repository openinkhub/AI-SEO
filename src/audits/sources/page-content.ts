// Deep, per-page content analysis behind the 70-parameter page audit (readability, keyphrase, schema detail, scripts,
// images, anchors, entities, fingerprint). Regex based like the rest of the crawler: no DOM library, no paid API.
import { hostOf } from './crawl-http';

export interface PageDeep {
  pageName: string;
  lead: string; // opening paragraph (first 200 characters)
  slug: string;
  pageType: 'home' | 'article' | 'service' | 'product' | 'contact' | 'about' | 'other';
  intent: 'informational' | 'commercial' | 'transactional' | 'local' | 'navigational';
  author: string | null;
  published: string | null; // ISO date
  modified: string | null;
  keyphrase: string;
  keyphraseSource: 'meta keywords' | 'title / H1' | 'url';
  kp: { inTitle: boolean; inMeta: boolean; inH1: boolean; inSlug: boolean; inFirstPara: boolean; inAlt: boolean; inSubheadings: number; count: number; density: number };
  hero: { src: string | null; og: boolean; inContent: boolean; alt: boolean | null; dims: boolean | null; lazy: boolean | null; modern: boolean | null };
  read: { sentences: number; avgSentence: number; longSentencePct: number; paragraphs: number; avgParagraph: number; longestParagraph: number; longSections: number; transitionPct: number; passivePct: number; consecutiveRuns: number; inclusive: string[]; flesch: number; complexPct: number };
  textToHtmlPct: number;
  img: { total: number; noSrcset: number; lazy: number; firstLazy: boolean };
  js: { total: number; blockingInHead: number; inlineKb: number; docWrite: boolean; oldJquery: boolean };
  css: { sheets: number; blockingInHead: number; styleBlocks: number; styleAttrs: number; imports: number };
  assets: string[]; // linked css / js files (sample), checked once for the whole site
  og: { title: string | null; description: string | null; image: string | null; type: string | null; url: string | null };
  twitter: { card: string | null; title: boolean; description: boolean; image: boolean };
  schema: {
    jsonLdBlocks: number;
    jsonLdValid: number;
    hasContext: boolean;
    nodeTypes: string[];
    orgName: string | null;
    publisherName: string | null;
    webSiteName: string | null;
    faqItems: number;
    faqItemsValid: number;
    articleAuthor: boolean;
    articleDates: boolean;
    breadcrumbItems: number;
    breadcrumbValid: boolean;
    about: number;
    sameAs: number;
  };
  faq: { questionHeadings: number };
  anchors: { total: number; descriptive: number; generic: number; naked: number; imageOnly: number; topText: string; topShare: number };
  entities: string[];
  terms: string[];
  trust: { about: boolean; contact: boolean; privacy: boolean; terms: boolean; phone: boolean; address: boolean; reviews: boolean };
  authoritativeOutbound: number;
  sig: number[]; // min-hash signature of the text: near-duplicate detection across pages
}

const STOP = new Set(
  'a an the and or but of in on at to for from by with as is are was were be been it its this that these those your our you we they their i not no can will do does how what why when where who which about into over under more most than then so if also just all any each very'.split(
    ' ',
  ),
);
const TRANSITIONS = [
  'however', 'therefore', 'moreover', 'furthermore', 'additionally', 'in addition', 'for example', 'for instance', 'as a result', 'consequently', 'meanwhile', 'finally', 'first', 'second', 'third', 'next', 'then', 'also', 'because', 'since', 'although', 'while', 'whereas', 'in contrast', 'on the other hand', 'similarly', 'likewise', 'in conclusion', 'to sum up', 'overall', 'in fact', 'indeed', 'instead', 'otherwise', 'thus', 'hence', 'besides', 'specifically', 'in particular', 'for this reason', 'as well as', 'in other words', 'above all', 'after that', 'before', 'after', 'once', 'until', 'so that', 'but', 'so', 'if', 'unless', 'even though', 'despite', 'in spite of', 'later', 'earlier', 'eventually', 'ultimately',
];
const TRANS_RE = new RegExp(`\\b(${TRANSITIONS.map((t) => t.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
const PASSIVE_RE = /\b(is|are|was|were|be|been|being|am)\s+(\w+ly\s+)?(\w{3,}ed|built|made|done|seen|known|given|taken|shown|found|written|held|kept|sent|told|set|run|chosen|driven|grown|begun|brought|bought|caught|taught|thought|understood)\b/i;
const INCLUSIVE: Array<[RegExp, string]> = [
  [/\bguys\b/i, 'guys'], [/\bmanpower\b/i, 'manpower'], [/\bchairman\b/i, 'chairman'], [/\bmankind\b/i, 'mankind'], [/\bman-?made\b/i, 'man-made'], [/\bwhitelist\b/i, 'whitelist'], [/\bblacklist\b/i, 'blacklist'],
  [/\bmaster\/slave\b/i, 'master/slave'], [/\bcrazy\b/i, 'crazy'], [/\binsane\b/i, 'insane'], [/\blame\b/i, 'lame'], [/\bdumb\b/i, 'dumb'], [/\bhandicapped\b/i, 'handicapped'], [/\bsanity check\b/i, 'sanity check'], [/\bhe or she\b/i, 'he or she'], [/\bsalesman\b/i, 'salesman'], [/\bhousewife\b/i, 'housewife'], [/\bgrandfather(ed)?\b/i, 'grandfathered'],
];
const AUTHORITY_HOST = /(\.gov|\.edu|\.ac\.[a-z]{2})(\.[a-z]{2})?$|wikipedia\.org$|w3\.org$|schema\.org$|nih\.gov$|who\.int$|developers\.google\.com$|support\.google\.com$|searchengineland\.com$|moz\.com$|ahrefs\.com$|semrush\.com$|hubspot\.com$|nature\.com$|ieee\.org$|statista\.com$|forbes\.com$|nytimes\.com$|bbc\.(com|co\.uk)$|reuters\.com$|harvard\.edu$|mckinsey\.com$|gartner\.com$/i;

const plain = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#039;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
const wc = (s: string): number => (s ? s.split(/\s+/).filter(Boolean).length : 0);
const metaOf = (html: string, attr: 'name' | 'property', val: string): string | null => {
  const m = html.match(new RegExp(`<meta[^>]+${attr}=["']${val}["'][^>]*>`, 'i'));
  if (!m) return null;
  const c = m[0].match(/content=["']([^"']*)["']/i);
  return c ? c[1].trim() : null;
};
const isoDate = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : null;
};

function syllables(w: string): number {
  const x = w.toLowerCase().replace(/[^a-z]/g, '');
  if (!x) return 0;
  if (x.length <= 3) return 1;
  const m = x.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

function minhash(text: string): number[] {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2500);
  const K = 32;
  const out: number[] = new Array(K).fill(0x7fffffff);
  if (words.length < 8) return out.map(() => -1);
  for (let i = 0; i + 5 <= words.length; i++) {
    const sh = words.slice(i, i + 5).join(' ');
    let h = 2166136261;
    for (let c = 0; c < sh.length; c++) h = Math.imul(h ^ sh.charCodeAt(c), 16777619);
    for (let k = 0; k < K; k++) {
      const v = (Math.imul(h ^ (k * 0x9e3779b1), 2654435761) >>> 1) & 0x7fffffff;
      if (v < out[k]) out[k] = v;
    }
  }
  return out;
}

export function similarity(a: number[], b: number[]): number {
  if (!a.length || a[0] === -1 || b[0] === -1) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}

function readSchemaDeep(html: string): PageDeep['schema'] {
  const s: PageDeep['schema'] = { jsonLdBlocks: 0, jsonLdValid: 0, hasContext: false, nodeTypes: [], orgName: null, publisherName: null, webSiteName: null, faqItems: 0, faqItemsValid: 0, articleAuthor: false, articleDates: false, breadcrumbItems: 0, breadcrumbValid: false, about: 0, sameAs: 0 };
  const nodes: any[] = [];
  const walk = (n: any) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      nodes.push(n);
      if (n['@graph']) walk(n['@graph']);
      for (const k of ['mainEntity', 'publisher', 'author', 'itemListElement']) if (n[k] && typeof n[k] === 'object') walk(n[k]);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    s.jsonLdBlocks++;
    try {
      const j = JSON.parse(m[1].trim());
      s.jsonLdValid++;
      if (JSON.stringify(j).includes('schema.org')) s.hasContext = true;
      walk(j);
    } catch {
      // counted as a block, not as valid
    }
  }
  const types = new Set<string>();
  for (const n of nodes) {
    const ts: string[] = ([] as any[]).concat(n['@type'] ?? []).map(String);
    ts.forEach((t) => types.add(t));
    const name = typeof n.name === 'string' ? n.name.trim() : null;
    if (ts.some((t) => /^(Organization|LocalBusiness|Corporation|ProfessionalService)$/.test(t) || /Business$/.test(t)) && name && !s.orgName) s.orgName = name;
    if (ts.includes('WebSite') && name && !s.webSiteName) s.webSiteName = name;
    if (n.publisher && typeof n.publisher === 'object' && typeof n.publisher.name === 'string') s.publisherName ??= n.publisher.name.trim();
    if (Array.isArray(n.sameAs)) s.sameAs = Math.max(s.sameAs, n.sameAs.length);
    if (ts.some((t) => /^(Article|BlogPosting|NewsArticle|TechArticle)$/.test(t))) {
      if (n.author && (typeof n.author === 'string' || n.author.name || (Array.isArray(n.author) && n.author.length))) s.articleAuthor = true;
      if (n.datePublished) s.articleDates = true;
      s.about += ([] as any[]).concat(n.about ?? [], n.mentions ?? []).length;
    }
    if (ts.includes('FAQPage')) {
      const items: any[] = ([] as any[]).concat(n.mainEntity ?? []);
      s.faqItems += items.length;
      s.faqItemsValid += items.filter((q) => q && q.name && q.acceptedAnswer && (q.acceptedAnswer.text || q.acceptedAnswer['@type'])).length;
    }
    if (ts.includes('BreadcrumbList')) {
      const items: any[] = ([] as any[]).concat(n.itemListElement ?? []);
      s.breadcrumbItems += items.length;
      s.breadcrumbValid = items.length > 0 && items.every((i) => i && (i.name || i.item?.name) && i.position != null);
    }
  }
  s.nodeTypes = [...types];
  return s;
}

function capitalised(sentences: string[]): string[] {
  const counts = new Map<string, number>();
  const skip = new Set(['The', 'This', 'That', 'These', 'Those', 'And', 'But', 'Our', 'Your', 'We', 'You', 'They', 'It', 'In', 'On', 'At', 'For', 'With', 'From', 'If', 'When', 'How', 'Why', 'What', 'Who', 'Where', 'Contact', 'Read', 'Learn', 'Get', 'Call', 'Click']);
  for (const s of sentences) {
    const rest = s.replace(/^\S+\s*/, '');
    for (const m of rest.matchAll(/\b([A-Z][a-zA-Z0-9&.'-]{2,}(?:\s+[A-Z][a-zA-Z0-9&.'-]{2,}){0,3})\b/g)) {
      const e = m[1].trim();
      if (skip.has(e) || /^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(e)) continue;
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 14).map(([e]) => e);
}

function topTerms(words: string[]): string[] {
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length < 4 || STOP.has(w)) continue;
    uni.set(w, (uni.get(w) ?? 0) + 1);
    const n = words[i + 1];
    if (n && n.length >= 4 && !STOP.has(n)) bi.set(`${w} ${n}`, (bi.get(`${w} ${n}`) ?? 0) + 1);
  }
  const b = [...bi.entries()].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([t]) => t);
  const u = [...uni.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t]) => t);
  return [...b, ...u.filter((t) => !b.some((x) => x.includes(t)))].slice(0, 12);
}

export function deepPage(
  html: string,
  url: string,
  base: { title: string | null; meta: string | null; h1: string[]; internal: string[]; external: string[]; lang: string | null },
): PageDeep | null {
  if (!html) return null;
  base = { ...base, title: base.title ? decodeEntities(base.title) : null, meta: base.meta ? decodeEntities(base.meta) : null, h1: base.h1.map(decodeEntities) };
  let path = '/';
  try {
    path = new URL(url).pathname;
  } catch {
    // keep '/'
  }
  const slug = path.replace(/^\/+|\/+$/g, '').split('/').pop() ?? '';
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 20000);
  const bodyHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const content = bodyHtml.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = plain(content);
  const allWords: string[] = text.match(/[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'’-]*/g) ?? [];
  const lower = allWords.map((w) => w.toLowerCase());
  const total = allWords.length;

  // ---- paragraphs / sentences / readability ---------------------------------------------------------------
  const paras = Array.from(content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map((m) => plain(m[1])).filter((p) => wc(p) >= 3);
  const sentences = paras.flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/)).map((s) => s.trim()).filter((s) => wc(s) >= 3);
  const sc = Math.max(sentences.length, 1);
  const sentLens = sentences.map(wc);
  const paraLens = paras.map(wc);
  const syl = allWords.reduce((s, w) => s + syllables(w), 0);
  const avgSentence = sentences.length ? sentLens.reduce((a, b) => a + b, 0) / sentences.length : 0;
  const flesch = total && sentences.length ? Math.round(206.835 - 1.015 * (total / sc) - 84.6 * (syl / total)) : 0;
  const complex = allWords.filter((w) => syllables(w) >= 3 && !/^[A-Z]/.test(w)).length;
  let runs = 0;
  for (let i = 0; i + 2 < sentences.length; ) {
    const f = (x: string) => x.split(/\s+/)[0].toLowerCase();
    let j = i;
    while (j + 1 < sentences.length && f(sentences[j + 1]) === f(sentences[i])) j++;
    if (j - i + 1 >= 3) {
      runs++;
      i = j + 1;
    } else i++;
  }
  const sections = content.split(/<h[2-6]\b/i).map((s) => wc(plain(s)));
  const inclusive = INCLUSIVE.filter(([re]) => re.test(text)).map(([, label]) => label);

  // ---- dates / author ---------------------------------------------------------------------------------------
  const pub = isoDate(html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ?? metaOf(html, 'property', 'article:published_time') ?? html.match(/itemprop=["']datePublished["'][^>]*(?:content|datetime)=["']([^"']+)["']/i)?.[1] ?? html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1]);
  const mod = isoDate(html.match(/"dateModified"\s*:\s*"([^"]+)"/)?.[1] ?? metaOf(html, 'property', 'article:modified_time') ?? metaOf(html, 'property', 'og:updated_time') ?? html.match(/itemprop=["']dateModified["'][^>]*(?:content|datetime)=["']([^"']+)["']/i)?.[1]);
  const author =
    html.match(/"author"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"author"\s*:\s*"([^"]+)"/)?.[1] ??
    metaOf(html, 'name', 'author') ??
    plain(html.match(/<a[^>]+rel=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '') ??
    null;
  const byline = author || plain(html.match(/<[a-z]+[^>]+class=["'][^"']*(?:author|byline)[^"']*["'][^>]*>([\s\S]{1,160}?)<\/[a-z]+>/i)?.[1] ?? '') || null;

  // ---- schema ---------------------------------------------------------------------------------------------------
  const schema = readSchemaDeep(html);
  const ogType = metaOf(html, 'property', 'og:type');

  // ---- page type / intent ---------------------------------------------------------------------------------------
  const isHome = path === '/' || path === '';
  const pageType: PageDeep['pageType'] = isHome
    ? 'home'
    : schema.nodeTypes.some((t) => /Article|BlogPosting|NewsArticle/.test(t)) || /article/i.test(ogType ?? '') || /\/(blog|news|insights?|articles?|posts?|guides?|resources?)\//i.test(path)
      ? 'article'
      : schema.nodeTypes.includes('Product') || /\/(shop|products?|store)\//i.test(path)
        ? 'product'
        : /contact/i.test(path)
          ? 'contact'
          : /about|team|our-story/i.test(path)
            ? 'about'
            : /service|solution|seo|marketing|automation|consult|agency|pricing|plans?/i.test(path) || schema.nodeTypes.includes('Service')
              ? 'service'
              : 'other';

  // ---- keyphrase ------------------------------------------------------------------------------------------------
  const metaKeywords = metaOf(html, 'name', 'keywords')?.split(',')[0]?.trim().toLowerCase() || '';
  const titleHead = (base.title ?? '').split(/\s[|\-–—:•·]\s|[|•·]/)[0];
  const rawSeq = `${base.h1[0] ?? ''} ${titleHead}`.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const cands = new Map<string, number>();
  const body = lower.join(' ');
  const countIn = (hay: string, needle: string): number => {
    if (!needle) return 0;
    let c = 0;
    let i = hay.indexOf(needle);
    while (i !== -1) {
      c++;
      i = hay.indexOf(needle, i + needle.length);
    }
    return c;
  };
  for (const seq of [(base.h1[0] ?? '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean), titleHead.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean)]) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= seq.length; i++) {
        const g = seq.slice(i, i + n);
        if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue;
        const phrase = g.join(' ');
        cands.set(phrase, (cands.get(phrase) ?? 0) + 1 + Math.min(countIn(body, phrase), 8) * 0.5 + (slug.replace(/-/g, ' ').includes(phrase) ? 2 : 0) + n * 0.2);
      }
    }
  }
  // The meta keywords tag is only trusted when it is specific to the page (a phrase that appears in its title or H1); many sites repeat one generic word on every page.
  let keyphrase = metaKeywords.length >= 6 && ((base.title ?? '').toLowerCase().includes(metaKeywords) || (base.h1[0] ?? '').toLowerCase().includes(metaKeywords)) ? metaKeywords : '';
  let keyphraseSource: PageDeep['keyphraseSource'] = 'meta keywords';
  if (!keyphrase) {
    const best = [...cands.entries()].sort((a, b) => b[1] - a[1])[0];
    keyphrase = best?.[0] ?? '';
    keyphraseSource = 'title / H1';
  }
  if (!keyphrase) {
    keyphrase = slug.replace(/[-_]+/g, ' ').trim();
    keyphraseSource = 'url';
  }
  if (!rawSeq.length && !keyphrase) keyphrase = '';
  const kpLower = keyphrase.toLowerCase();
  const subheads = Array.from(content.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)).map((m) => plain(m[2]).toLowerCase());
  const firstPara = (paras.find((p) => wc(p) >= 12) ?? '').toLowerCase();
  const kpCount = kpLower ? countIn(body, kpLower) : 0;

  // ---- images ---------------------------------------------------------------------------------------------------
  const imgTags = Array.from(bodyHtml.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0]);
  const isLazy = (t: string) => /loading=["']lazy["']/i.test(t) || /\sdata-(lazy-)?src=/i.test(t);
  const heroTag = Array.from(content.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0]).find((t) => !/logo|icon|avatar|sprite|pixel|spacer/i.test(t) && !/width=["']?\d{1,2}["']?[\s>]/i.test(t));
  const ogImage = metaOf(html, 'property', 'og:image');
  const heroSrc = heroTag?.match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? heroTag?.match(/data-src=["']([^"']+)["']/i)?.[1] ?? null;
  const altsText = imgTags.map((t) => t.match(/\balt=["']([^"']*)["']/i)?.[1]?.toLowerCase() ?? '').join(' ');

  // ---- scripts / css ----------------------------------------------------------------------------------------------
  const scriptTags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  const headScripts = Array.from(head.matchAll(/<script\b([^>]*)>/gi)).map((m) => m[1]);
  const srcScripts = scriptTags.filter((m) => /\ssrc=/i.test(m[1]));
  const inlineBytes = scriptTags.filter((m) => !/\ssrc=/i.test(m[1]) && !/type=["']application\/(ld\+json|json)|text\/template/i.test(m[1])).reduce((s, m) => s + m[2].length, 0);
  const oldJquery = /jquery[-.\/@]v?(\d+)\.(\d+)/i.exec(html);
  const sheets = Array.from(html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)).map((m) => m[0]);
  const styleBlocks = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi));
  const assets = [
    ...srcScripts.map((m) => m[1].match(/src=["']([^"']+)["']/i)?.[1]),
    ...sheets.map((t) => t.match(/href=["']([^"']+)["']/i)?.[1]),
  ]
    .filter((u): u is string => !!u && !/^(data:|\/\/(?!\w))/i.test(u))
    .map((u) => {
      try {
        return new URL(u, url).toString();
      } catch {
        return '';
      }
    })
    .filter((u) => /^https?:/i.test(u) && hostOf(u) === hostOf(url))
    .slice(0, 14);

  // ---- anchors (links in the content) -------------------------------------------------------------------------------
  const host = hostOf(url);
  let aTotal = 0, descriptive = 0, generic = 0, naked = 0, imageOnly = 0;
  const aCount = new Map<string, number>();
  for (const m of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].match(/href=["']([^"']+)["']/i)?.[1];
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let internal = true;
    try {
      internal = hostOf(new URL(href, url).toString()) === host;
    } catch {
      continue;
    }
    if (!internal) continue;
    aTotal++;
    const t = plain(m[2]);
    const key = t.toLowerCase();
    if (!t) {
      imageOnly++;
      continue;
    }
    aCount.set(key, (aCount.get(key) ?? 0) + 1);
    if (/^(click here|here|read more|more|learn more|link|this|continue|details|know more|view more|see more|get started)$/i.test(t)) generic++;
    else if (/^(https?:\/\/|www\.)\S+$/i.test(t)) naked++;
    else descriptive++;
  }
  const topA = [...aCount.entries()].sort((a, b) => b[1] - a[1])[0];

  const faqHeads = subheads.filter((h) => /\?$/.test(h) || /^(what|why|how|when|where|who|which|can|does|do|is|are|should)\b/.test(h)).length;
  const intentText = `${kpLower} ${(base.title ?? '').toLowerCase()} ${slug}`;
  const intent: PageDeep['intent'] = /\b(near me|in [a-z]+ (city|area)|local)\b/.test(intentText) || (pageType === 'contact')
    ? 'local'
    : /\b(buy|price|pricing|cost|quote|hire|book|order|get started|free trial|demo|services?|agency|consult)\b/.test(intentText)
      ? 'transactional'
      : /\b(best|top|vs|versus|review|reviews|compare|comparison|alternative|alternatives)\b/.test(intentText)
        ? 'commercial'
        : /\b(how|what|why|when|guide|tips|tutorial|learn|checklist|ideas|examples?|meaning|definition|steps)\b/.test(intentText)
          ? 'informational'
          : pageType === 'home'
            ? 'navigational'
            : 'informational';

  const internalUrls = base.internal.join(' ').toLowerCase();
  return {
    pageName: (base.h1[0] || base.title || slug || '').slice(0, 120),
    lead: (paras.find((p) => wc(p) >= 12) ?? '').slice(0, 200),
    slug,
    pageType,
    intent,
    author: byline,
    published: pub,
    modified: mod,
    keyphrase,
    keyphraseSource,
    kp: {
      inTitle: !!kpLower && (base.title ?? '').toLowerCase().includes(kpLower),
      inMeta: !!kpLower && (base.meta ?? '').toLowerCase().includes(kpLower),
      inH1: !!kpLower && (base.h1[0] ?? '').toLowerCase().includes(kpLower),
      inSlug: !!kpLower && slug.replace(/[-_]+/g, ' ').toLowerCase().includes(kpLower.split(' ')[0]) && kpLower.split(' ').every((w) => slug.toLowerCase().includes(w.slice(0, 4))),
      inFirstPara: !!kpLower && firstPara.includes(kpLower),
      inAlt: !!kpLower && altsText.includes(kpLower),
      inSubheadings: !kpLower ? 0 : subheads.filter((h) => h.includes(kpLower)).length,
      count: kpCount,
      density: total && kpLower ? Math.round(((kpCount * kpLower.split(' ').length) / total) * 1000) / 10 : 0,
    },
    hero: {
      src: ogImage ?? heroSrc,
      og: !!ogImage,
      inContent: !!heroTag,
      alt: heroTag ? /\balt=["'][^"']+["']/i.test(heroTag) : null,
      dims: heroTag ? /\bwidth=/i.test(heroTag) && /\bheight=/i.test(heroTag) : null,
      lazy: heroTag ? isLazy(heroTag) : null,
      modern: heroSrc ? /\.(webp|avif|svg)(\?|$)/i.test(heroSrc) : ogImage ? /\.(webp|avif|svg)(\?|$)/i.test(ogImage) : null,
    },
    read: {
      sentences: sentences.length,
      avgSentence: Math.round(avgSentence * 10) / 10,
      longSentencePct: sentences.length ? Math.round((sentLens.filter((n) => n > 20).length / sentences.length) * 100) : 0,
      paragraphs: paras.length,
      avgParagraph: paras.length ? Math.round(paraLens.reduce((a, b) => a + b, 0) / paras.length) : 0,
      longestParagraph: paraLens.length ? Math.max(...paraLens) : 0,
      longSections: sections.filter((n) => n > 300).length,
      transitionPct: sentences.length ? Math.round((sentences.filter((s) => TRANS_RE.test(s)).length / sentences.length) * 100) : 0,
      passivePct: sentences.length ? Math.round((sentences.filter((s) => PASSIVE_RE.test(s)).length / sentences.length) * 100) : 0,
      consecutiveRuns: runs,
      inclusive,
      flesch: Math.max(0, Math.min(100, flesch)),
      complexPct: total ? Math.round((complex / total) * 100) : 0,
    },
    textToHtmlPct: html.length ? Math.round((text.length / html.length) * 1000) / 10 : 0,
    img: { total: imgTags.length, noSrcset: imgTags.filter((t) => !/\ssrcset=/i.test(t) && !/\.svg(\?|["'])/i.test(t)).length, lazy: imgTags.filter(isLazy).length, firstLazy: imgTags.length > 0 && isLazy(imgTags[0]) },
    js: {
      total: srcScripts.length,
      blockingInHead: headScripts.filter((a) => /\ssrc=/i.test(a) && !/\s(async|defer)\b/i.test(a) && !/type=["']module["']/i.test(a)).length,
      inlineKb: Math.round(inlineBytes / 102.4) / 10,
      docWrite: /document\.write\s*\(/i.test(html),
      oldJquery: !!oldJquery && Number(oldJquery[1]) < 3,
    },
    css: {
      sheets: sheets.length,
      blockingInHead: sheets.filter((t) => !/media=["']print["']/i.test(t) && !/onload=/i.test(t)).length,
      styleBlocks: styleBlocks.length,
      styleAttrs: (html.match(/\sstyle=["']/gi) ?? []).length,
      imports: styleBlocks.filter((m) => /@import/i.test(m[1])).length,
    },
    assets,
    og: { title: metaOf(html, 'property', 'og:title'), description: metaOf(html, 'property', 'og:description'), image: ogImage, type: ogType, url: metaOf(html, 'property', 'og:url') },
    twitter: { card: metaOf(html, 'name', 'twitter:card'), title: !!metaOf(html, 'name', 'twitter:title'), description: !!metaOf(html, 'name', 'twitter:description'), image: !!metaOf(html, 'name', 'twitter:image') },
    schema,
    faq: { questionHeadings: faqHeads },
    anchors: { total: aTotal, descriptive, generic, naked, imageOnly, topText: topA?.[0] ?? '', topShare: aTotal && topA ? Math.round((topA[1] / aTotal) * 100) : 0 },
    entities: capitalised(sentences),
    terms: topTerms(lower),
    trust: {
      about: /about/.test(internalUrls),
      contact: /contact/.test(internalUrls),
      privacy: /privacy/.test(internalUrls),
      terms: /terms|conditions/.test(internalUrls),
      phone: /href=["']tel:/i.test(html) || /"telephone"/.test(html),
      address: /<address\b/i.test(html) || /"streetAddress"/.test(html),
      reviews: /AggregateRating|"@type"\s*:\s*"Review"|testimonial|customer reviews?|what our (clients|customers)/i.test(html),
    },
    authoritativeOutbound: base.external.filter((u) => AUTHORITY_HOST.test(hostOf(u))).length,
    sig: minhash(text),
  };
}
