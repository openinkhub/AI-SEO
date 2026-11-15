// Layers 15-17 - Topical Blog Intent cluster: PURE planner (no Nest / DB imports, unit-testable).
//
// 6 Admin-picked target pages x 5 website articles = 30 (Layer 15)
// each website article  -> 6 Tier 1 articles (Layer 16, 30 sites x 6 = 180)
// each Tier 1 article   -> 1 Tier 2 article  (Layer 17, 30 sites x 6 = 180)
// each Tier 2 article   -> 3 Tier 3 follow-ups (Layer 17, 90 sites x 6 = 540)           total 930
// Link chain: Tier 3 -> Tier 2 -> Tier 1 -> Website Blog URL -> Target page.
//
// Every article gets a complete writing brief built by a deterministic template + meta algorithm (no AI call):
// keyword mapping, title, meta title (<=60), meta description (<=155), meta tags, slug, intent, journey stage, objective, angle,
// audience/tone, intro, outline, word target, keyword-placement rules, link plan with anchor text, CTA, schema, image brief, dates.

export interface PoolItem { text: string; rank: number; tag?: string }
export interface ClusterPage { id: string; url: string; name: string | null; h1: string | null }
export interface ClusterInput {
  brand: string;
  industry?: string | null;
  nextMonthStart: string; // YYYY-MM-DD, first day of the cycle the articles publish in
  pages: ClusterPage[]; // the 6 Admin-picked target pages, in pick order
  l14: PoolItem[]; // Layer 14 keywords (rank order); tag = 'H1' | 'H2'
  pools: { h3: PoolItem[]; h4: PoolItem[]; paa: PoolItem[]; similar: PoolItem[]; faq: PoolItem[]; quora: PoolItem[] };
}

export const CLUSTER = { pages: 6, perPage: 5, blogs: 30, tier1PerBlog: 6, siteArticles: 6, tier3PerTier2Site: 3, total: 930 };
export const SLOT_KEYS = ['h3', 'h4', 'paa', 'similar', 'faq', 'quora'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];
export type Intent = 'Informational' | 'Commercial' | 'Transactional' | 'Local';
export type Journey = 'Awareness' | 'Consideration' | 'Decision';

export interface LinkStep { role: 'target-page' | 'parent' | 'sibling'; toCode: string | null; targetUrl: string | null; anchor: string; rel: 'dofollow'; position: string }
export interface OutlineItem { level: 2 | 3; text: string }

export interface ArticleDraft {
  layerNo: 15 | 16 | 17;
  tier: 0 | 1 | 2 | 3;
  code: string; // W07 | T1-S07-A4 | T2-S07-A4 | T3-S07-B2-A4
  seq: number; // 1..930 in plan order
  blogNo: number; // root website blog (1..30)
  pageSlot: number; // 1..6
  articleInPage: number | null; // 1..5 (tier 0 only)
  siteNo: number | null; // tier 1/2: 1..30, tier 3: 1..90
  subSite: number | null; // tier 3: 1..3 under its Tier 2 site
  articleNo: number | null; // 1..6 inside a site
  parentCode: string | null;
  targetPageUrl: string;
  // keyword mapping
  h1: string | null; h2: string | null; h3: string | null; h4: string | null; paa: string | null; similar: string | null; faq: string | null; quora: string | null;
  primaryKeyword: string;
  hierarchy: string; // where the primary keyword comes from: H1 | H2 | 11-B .. 11-G
  secondaryKeywords: string[];
  sources: Record<string, number | boolean | null>;
  // writing brief
  role: string; // pillar | how-to | comparison | faq | local | explainer | long-tail | question | alternatives | faq-roundup | community
  title: string; slug: string; metaTitle: string; metaDescription: string; metaTags: string;
  intentType: Intent; journeyStage: Journey; objective: string; angle: string; audience: string; tone: string;
  intro: string; outline: OutlineItem[]; wordTarget: number; placementRules: string;
  linkPlan: LinkStep[]; anchorText: string | null; cta: string; schemaType: string; imageBrief: string; avoid: string;
  publishDate: string;
}

// ---------- text helpers ----------
const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'your', 'are', 'what', 'how', 'why', 'who', 'does', 'can', 'best', 'top', 'near', 'from', 'that', 'this', 'into', 'about', 'which', 'when', 'where', 'should', 'have', 'has', 'was', 'will']);
export const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function tokens(s: unknown): Set<string> {
  const out = new Set<string>();
  for (const w of norm(s).split(' ')) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  }
  return out;
}
const overlap = (a: Set<string>, b: Set<string>): number => { let n = 0; for (const t of a) if (b.has(t)) n++; return n; };
const union = (...sets: Array<Set<string>>): Set<string> => new Set(sets.flatMap((s) => [...s]));
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
export function titleCase(s: string): string {
  return String(s || '').trim().replace(/\s+/g, ' ').split(' ').map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
const sentenceCase = (s: string): string => { const t = String(s || '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const isQuestion = (s: string): boolean => /\?\s*$/.test(s) || /^(what|how|why|when|where|which|who|can|could|does|do|is|are|should|will)\b/i.test(s.trim());
const clean = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s+([,.?!:;])/g, '$1').trim();
const TRAIL_SMALL = /\s(a|an|and|the|of|for|to|in|on|with|or|vs|at|by)$/i;
export function cutWords(s: string, max: number): string {
  const t = clean(s);
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const i = head.lastIndexOf(' ');
  let out = (i > Math.floor(max / 2) ? head.slice(0, i) : t.slice(0, max)).replace(/[\s,:;\-–|?]+$/, '');
  while (TRAIL_SMALL.test(out)) out = out.replace(/\s\S+$/, '');
  return out;
}
export function slugOf(s: string, max = 60): string {
  const base = norm(s).split(' ').filter(Boolean).join('-');
  return cutWords(base.replace(/-/g, ' '), max).replace(/ /g, '-');
}
const addDays = (iso: string, n: number): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const base = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : Date.now();
  return new Date(base + n * 86400000).toISOString().slice(0, 10);
};

// Meta title <= 60: "<hook> | Brand", else "<hook>", else the bare keyword; the keyword is never cut from the front.
export function fitTitle(hook: string, kw: string, brand: string, max = 60): string {
  const cands = [brand ? `${hook} | ${brand}` : '', hook, titleCase(kw)].map(clean).filter(Boolean);
  for (const c of cands) if (c.length <= max) return c;
  return cutWords(titleCase(kw), max);
}
// Meta description <= 155: lead (carries the keyword), value, call to action - trailing parts are dropped until it fits.
export function fitDescription(parts: string[], max = 155): string {
  const ps = parts.map(clean).filter(Boolean);
  for (let n = ps.length; n >= 1; n--) {
    const s = ps.slice(0, n).join(' ');
    if (s.length <= max) return s;
  }
  const cut = cutWords(ps[0] || '', max - 1);
  return /[.!?]$/.test(cut) ? cut : cut + '.';
}
export function metaTagsOf(...kws: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of kws) {
    const t = String(k || '').toLowerCase().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 80) continue;
    const n = norm(t);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(t);
    if (out.length >= 8) break;
  }
  return out.join(', ');
}

// Intent from the wording of the keyword (+ the article's form).
export function intentOf(kw: string): Intent {
  const k = ` ${norm(kw)} `;
  if (/ near me | nearby | open now /.test(k)) return 'Local';
  if (/ (buy|book|booking|hire|order|appointment|quote|get a|call|contact|enquire|enquiry) /.test(k)) return 'Transactional';
  if (/ (best|top|vs|versus|compare|comparison|review|reviews|price|prices|pricing|cost|costs|cheap|affordable|package|packages|service|services|company|companies|agency|agencies|alternative|alternatives) /.test(k)) return 'Commercial';
  return 'Informational';
}
const journeyOf = (i: Intent): Journey => (i === 'Informational' ? 'Awareness' : i === 'Transactional' ? 'Decision' : 'Consideration');

// ---------- picker: least-used first, then most relevant to the context, then best rank ----------
class Picker {
  private uses: number[];
  private toks: Array<Set<string>>;
  private keys: string[];
  readonly items: PoolItem[];
  constructor(items: PoolItem[]) {
    const seen = new Set<string>();
    this.items = [];
    for (const i of items || []) {
      const t = String(i.text || '').trim();
      const n = norm(t);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      this.items.push({ text: t, rank: i.rank, tag: i.tag });
    }
    this.uses = this.items.map(() => 0);
    this.toks = this.items.map((i) => tokens(i.text));
    this.keys = this.items.map((i) => norm(i.text));
  }
  get size(): number { return this.items.length; }
  pick(ctx: Set<string>, avoid?: Set<string>): (PoolItem & { reused: boolean }) | null {
    let best = -1;
    let bu = Infinity, bs = -1, br = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      if (avoid && avoid.has(this.keys[i])) continue;
      const u = this.uses[i];
      const s = overlap(ctx, this.toks[i]);
      const r = this.items[i].rank;
      if (u < bu || (u === bu && (s > bs || (s === bs && r < br)))) { best = i; bu = u; bs = s; br = r; }
    }
    if (best < 0) return null;
    this.uses[best]++;
    return { ...this.items[best], reused: bu > 0 };
  }
}

// ---------- writing templates ----------
// Placeholders: {kw} {Kw} {Kws} the article's primary keyword (lower / Title Case / Sentence case); {root} the keyword of the root
// website blog (tiers) or the target page keyword (blog); {brand}; {page}; {h3} {h4} {paa} {similar} {faq} {quora}; {h2}.
// A line with an empty placeholder is dropped from the outline.
interface FormSpec {
  role: string; angle: string; objective: string; words: number; schema: string; intent?: Intent;
  hooks: string[]; lead: [string, string]; value: string; cta: string;
  intro: [string, string]; introRest: string; outline: string[];
}
const FORMS: Record<string, FormSpec> = {
  pillar: {
    role: 'pillar', angle: 'Complete guide that anchors the target page', objective: 'Rank for the page keyword and give readers everything needed to decide', words: 1800, schema: 'Article',
    hooks: ['{Kw}: The Complete Guide', 'The Complete Guide to {Kw}', '{Kw}: What to Know Before You Choose'],
    lead: ['Looking for {kw}? This guide covers what it is, how to choose and what to expect.', 'Wondering {kw} This guide gives a clear, complete answer.'],
    value: 'Practical advice from {brand}.', cta: 'Read the full guide.',
    intro: ['{Kws} is one of the most searched topics for people comparing their options.', '{Kws} is a common question, and the answer depends on a few clear factors.'],
    introRest: 'This guide from {brand} explains the essentials, from what matters most to the mistakes to avoid. By the end you will know how to decide with confidence and what to do next.',
    outline: ['2|What is {kw}?', '2|Why {kw} matters', '3|{h3}', '2|How to choose: {h2}', '3|{h4}', '2|Common mistakes to avoid', '2|Frequently asked questions', '3|{paa}', '3|{faq}', '2|Next steps with {brand}'],
  },
  howto: {
    role: 'how-to', angle: 'Step-by-step practical guide', objective: 'Help readers act on the topic and link them to the target page', words: 1400, schema: 'HowTo',
    hooks: ['How to Choose {Kw}: Step by Step', '{Kw}: A Practical How-To Guide', '{Kw}: How It Works, Step by Step'],
    lead: ['A step-by-step guide to {kw}: what to check, what to avoid and how to get it right.', 'A step-by-step answer to {kw}'],
    value: 'Clear steps from {brand}.', cta: 'Follow the steps.',
    intro: ['Getting {kw} right is easier with a clear process.', 'Here is a clear process to answer: {kw}'],
    introRest: 'This how-to guide breaks the topic into simple steps with the checks that matter most. Follow it in order and you will avoid the usual pitfalls.',
    outline: ['2|Before you start', '2|Step 1: Define what you need', '2|Step 2: {h2}', '3|{h4}', '2|Step 3: Compare your options', '3|{similar}', '2|Step 4: Check quality and proof', '2|Questions people ask', '3|{paa}', '3|{quora}', '2|Take the next step with {brand}'],
  },
  comparison: {
    role: 'comparison', angle: 'Side-by-side comparison of options', objective: 'Support the decision stage and pass authority to the target page', words: 1400, schema: 'Article',
    hooks: ['{Kw}: Options Compared', '{Kw} Compared: What Sets Them Apart', '{Kw}: How to Compare Your Options'],
    lead: ['Comparing {kw}? See how the options differ on quality, price and results.', 'Comparing options for: {kw}'],
    value: 'An honest comparison from {brand}.', cta: 'See the comparison.',
    intro: ['Choosing between {kw} options is easier with a fair, side-by-side view.', 'Choosing between the options for this question is easier with a fair, side-by-side view: {kw}'],
    introRest: 'This comparison looks at what each option offers, where it falls short and who it suits best. Use it to shortlist with confidence.',
    outline: ['2|What to compare', '2|Option overview: {h2}', '3|{similar}', '2|Quality, price and results', '3|{h4}', '2|Which option suits whom', '2|Frequently asked questions', '3|{faq}', '3|{paa}', '2|Our recommendation'],
  },
  faq: {
    role: 'faq', angle: 'Questions and answers around the topic', objective: 'Capture question searches and AI-answer citations', words: 1400, schema: 'FAQPage', intent: 'Informational',
    hooks: ['{Kw}: Your Questions Answered', '{Kw} FAQs: Clear Answers', '{Kw}: Frequently Asked Questions'],
    lead: ['Answers to the most common questions about {kw}, in plain language.', 'A plain-language answer to: {kw}'],
    value: 'Straight answers from {brand}.', cta: 'Get the answers.',
    intro: ['People ask the same questions about {kw} again and again.', 'This is a question many people ask: {kw}'],
    introRest: 'This page collects the clearest answers in one place, grouped by topic, so you can find yours quickly.',
    outline: ['2|The basics', '3|{paa}', '3|{faq}', '2|Choosing and pricing', '3|{quora}', '3|{h4}', '2|More about {h2}', '2|Still have a question?'],
  },
  local: {
    role: 'local', angle: 'Local relevance, proof and results', objective: 'Build trust and local relevance that supports the target page', words: 1400, schema: 'LocalBusiness',
    hooks: ['{Kw}: Local Insights and Results', '{Kw}: What Local Customers Should Know', '{Kw}: Real Results, Local Experience'],
    lead: ['What local customers should know about {kw}, with real examples and results.', 'A local view of: {kw}'],
    value: 'Local experience from {brand}.', cta: 'See the results.',
    intro: ['Local experience makes a real difference when it comes to {kw}.', 'Local experience makes a real difference to this question: {kw}'],
    introRest: 'This article shares what we see locally, the results customers get and what to ask before you decide.',
    outline: ['2|Why local experience matters', '2|What customers ask us', '3|{quora}', '2|Results and proof', '3|{h4}', '2|How {brand} can help', '2|Frequently asked questions', '3|{faq}'],
  },
  explainer: {
    role: 'explainer', angle: 'Clear explanation of the topic as an AI-answer style article', objective: 'Earn citations in AI answers and pass authority to the parent article', words: 0, schema: 'Article',
    hooks: ['{Kw}: A Clear Explanation', '{Kw} Explained Simply', '{Kw}: What You Need to Know'],
    lead: ['{Kws} explained: the key points, in plain language.', 'A clear answer to: {kw}'],
    value: 'Explained by {brand}.', cta: 'Read the explanation.',
    intro: ['{Kws} is easier to understand when you break it down.', 'Here is a clear answer to the question: {kw}'],
    introRest: 'This article explains the key points in plain language and links to the full guide for more detail.',
    outline: ['2|The short answer', '2|How it works', '3|{root}', '2|Key things to remember', '2|Learn more', '3|{similar}'],
  },
  longtail: {
    role: 'long-tail', angle: 'Detailed guide for a specific long-tail need', objective: 'Capture a specific long-tail search and link to the parent article', words: 0, schema: 'Article',
    hooks: ['{Kw}: A Detailed Guide', '{Kw}: Tips, Costs and What to Expect', '{Kw}: What to Know First'],
    lead: ['A detailed guide to {kw}: tips, costs and what to expect.', 'A detailed answer to: {kw}'],
    value: 'Detailed advice from {brand}.', cta: 'Read the guide.',
    intro: ['If you are searching for {kw}, the details matter.', 'If you are asking this, the details matter: {kw}'],
    introRest: 'This guide covers the specifics, from what to expect to what to check before you decide.',
    outline: ['2|What to expect', '2|Key details that matter', '3|{h4}', '2|Tips from experience', '2|Costs and timing', '2|Where to go next', '3|{root}'],
  },
  question: {
    role: 'question', angle: 'Direct answer to a real search question', objective: 'Win the question search and link to the parent article', words: 0, schema: 'FAQPage', intent: 'Informational',
    hooks: ['{Kw}', '{Kw} Here Is the Answer', '{Kw}: The Short Answer'],
    lead: ['The short answer to {kw}, plus what to check next.', 'The short answer to: {kw}'],
    value: 'Answered by {brand}.', cta: 'Get the answer.',
    intro: ['The short answer to {kw}', 'The short answer to this question: {kw}'],
    introRest: 'is explained below in a few clear steps, with links to the full guide if you want more detail.',
    outline: ['2|The short answer', '2|Why it matters', '2|What to do next', '3|{root}'],
  },
  alternatives: {
    role: 'alternatives', angle: 'Alternatives and comparison for the same need', objective: 'Reach readers comparing options and link to the parent article', words: 0, schema: 'Article', intent: 'Commercial',
    hooks: ['{Kw}: Alternatives Compared', '{Kw} vs Other Options', '{Kw}: How It Compares'],
    lead: ['Comparing {kw} with the alternatives: what differs and who each suits.', 'Comparing the alternatives for: {kw}'],
    value: 'A fair view from {brand}.', cta: 'Compare now.',
    intro: ['{Kws} is one choice among several.', 'There are several choices for this question: {kw}'],
    introRest: 'This article compares the main alternatives so you can see the trade-offs side by side.',
    outline: ['2|The main options', '3|{similar}', '2|How they compare', '2|Which to choose', '3|{root}'],
  },
  faqround: {
    role: 'faq-roundup', angle: 'FAQ roundup', objective: 'Capture FAQ searches and link to the parent article', words: 0, schema: 'FAQPage', intent: 'Informational',
    hooks: ['{Kw}: Top FAQs Answered', '{Kw}: Frequently Asked Questions', '{Kw} FAQs'],
    lead: ['Frequently asked questions about {kw}, answered clearly.', 'A clear answer to the FAQ: {kw}'],
    value: 'Answers from {brand}.', cta: 'Read the FAQs.',
    intro: ['Here are the questions people ask most about {kw}.', 'This is one of the questions people ask most: {kw}'],
    introRest: 'Each answer is short and practical, with a link to the full guide.',
    outline: ['2|Most asked questions', '3|{faq}', '3|{paa}', '2|More answers', '3|{quora}', '2|Read the full guide', '3|{root}'],
  },
  community: {
    role: 'community', angle: 'Community question and expert answer', objective: 'Reach people on question-and-answer style platforms and link to the parent article', words: 0, schema: 'QAPage', intent: 'Informational',
    hooks: ['{Kw}: Real Questions, Real Answers', '{Kw}: What People Are Asking', '{Kw}: Community Answers'],
    lead: ['A real question people ask: {kw} An expert answer with practical next steps.', 'A real question people ask: {kw} An expert answer follows.'],
    value: 'Answered by {brand}.', cta: 'Read the answer.',
    intro: ['People often ask about {kw}.', 'People often ask: {kw}'],
    introRest: 'Here is a practical answer drawn from real experience, with pointers to the full guide.',
    outline: ['2|The question', '2|A practical answer', '3|{quora}', '2|Related questions', '3|{paa}', '2|Where to learn more', '3|{root}'],
  },
};
const BLOG_FORMS = ['pillar', 'howto', 'comparison', 'faq', 'local'];
const TIER_FORMS = ['explainer', 'longtail', 'question', 'alternatives', 'faqround', 'community'];
const TIER_WORDS: Record<number, number> = { 1: 1000, 2: 800, 3: 600 };
const ANCHOR_KINDS = ['exact', 'learn', 'brand', 'related', 'guide', 'brand-kw'];
const AVOID = 'No unverifiable claims, no guaranteed rankings or results, no competitor names, no copied text; keep facts specific and checkable.';
const PLACEMENT = 'Primary keyword in the title, the first 100 words, one H2, the meta description and the URL slug; each mapped H2/H3 keyword used once where it fits naturally; keyword density 0.5-1.5%; no stuffing.';

function fill(tpl: string, v: Record<string, string>): string | null {
  let empty = false;
  const out = tpl.replace(/\{(\w+)\}/g, (_m, k) => {
    const val = v[k];
    if (!val) { empty = true; return ''; }
    return val;
  });
  return empty ? null : clean(out);
}

interface BriefCtx {
  form: string; kw: string; root: string; brand: string; page: string; map: Record<SlotKey | 'h2', string>;
  variant: number; audience: string; secondary: string[]; tier: number;
}
function writeBrief(c: BriefCtx) {
  const f = FORMS[c.form];
  const q = isQuestion(c.kw) ? 1 : 0;
  const v: Record<string, string> = {
    kw: c.kw, Kw: titleCase(c.kw), Kws: sentenceCase(c.kw), root: c.root, brand: c.brand, page: c.page,
    h2: c.map.h2, h3: c.map.h3, h4: c.map.h4, paa: c.map.paa, similar: c.map.similar, faq: c.map.faq, quora: c.map.quora,
  };
  const hook = clean((f.hooks[c.variant % f.hooks.length] || f.hooks[0]).replace(/\{Kw\}/g, v.Kw).replace(/\{kw\}/g, v.kw));
  const metaTitle = fitTitle(hook, c.kw, c.brand, 60);
  const lead = fill(f.lead[q], v) || fill(f.lead[0], v) || c.kw;
  const metaDescription = fitDescription([lead, fill(f.value, v) || '', f.cta], 155);
  const intro = clean([fill(f.intro[q], v) || fill(f.intro[0], v) || '', fill(f.introRest, v) || ''].map((s, i) => (i === 0 && q && !/[.?!]$/.test(s) ? s + '.' : s)).join(' '));
  const outline: OutlineItem[] = [];
  for (const line of f.outline) {
    const [lv, text] = line.split('|');
    const t = fill(text, v);
    if (t) outline.push({ level: lv === '2' ? 2 : 3, text: sentenceCase(t) });
  }
  return { f, metaTitle, metaDescription, intro, outline, title: metaTitle.replace(/\s*\|\s*[^|]*$/, '').trim() || metaTitle, tags: metaTagsOf(c.kw, c.root, ...c.secondary, c.page) };
}

const AUDIENCE = (brand: string, industry?: string | null): string => `Prospective customers researching ${industry ? industry.toLowerCase() : 'this service'} and comparing providers such as ${brand}; plain, non-technical readers.`;
const TONE = 'Helpful, confident and plain-spoken; short paragraphs; second person; no hype.';

function anchorFor(kind: string, parentKw: string, parentSupport: string, brand: string): string {
  switch (kind) {
    case 'exact': return parentKw;
    case 'learn': return `learn more about ${parentKw}`;
    case 'brand': return brand;
    case 'related': return parentSupport || parentKw;
    case 'guide': return `this ${parentKw} guide`;
    default: return `${brand} ${parentKw}`;
  }
}
const pad = (n: number): string => String(n).padStart(2, '0');
const pageWords = (p: ClusterPage): string => [p.name, p.h1, (p.url || '').replace(/^https?:\/\/[^/]+/i, '').replace(/[-_/]+/g, ' ')].filter(Boolean).join(' ');

// ---------- the plan ----------
export function planCluster(input: ClusterInput): { articles: ArticleDraft[]; checks: PlanChecks } {
  if (input.pages.length !== CLUSTER.pages) throw new Error(`Exactly ${CLUSTER.pages} target pages are required (got ${input.pages.length}).`);
  const brand = (input.brand || '').trim() || 'our team';
  const audience = AUDIENCE(brand, input.industry);
  const l14 = new Picker(input.l14);
  const pools: Record<SlotKey, Picker> = { h3: new Picker(input.pools.h3), h4: new Picker(input.pools.h4), paa: new Picker(input.pools.paa), similar: new Picker(input.pools.similar), faq: new Picker(input.pools.faq), quora: new Picker(input.pools.quora) };
  const POOL_TAG: Record<SlotKey, string> = { h3: '11-B', h4: '11-C', paa: '11-D', similar: '11-E', faq: '11-F', quora: '11-G' };
  const out: ArticleDraft[] = [];
  const byCode = new Map<string, ArticleDraft>();
  let seq = 0;
  const reuse: Record<string, number> = {};
  const note = (k: string, r: boolean) => { if (r) reuse[k] = (reuse[k] || 0) + 1; };

  // 1) page primary keyword: the most relevant Layer 14 keyword per page
  const pageCtx = input.pages.map((p) => tokens(pageWords(p)));
  const pageKw = input.pages.map((_p, i) => { const k = l14.pick(pageCtx[i]); if (k) note('L14', k.reused); return k; });
  const fallbackKw = (i: number): string => pageKw[i]?.text || input.pages[i].h1 || input.pages[i].name || brand;

  // 2) 30 website blogs, round-robin so no page starves the others
  interface Slot { page: number; art: number; h2: (PoolItem & { reused: boolean }) | null }
  const slots: Slot[] = [];
  for (let a = 1; a <= CLUSTER.perPage; a++) for (let p = 0; p < CLUSTER.pages; p++) {
    const ctx = union(pageCtx[p], tokens(fallbackKw(p)));
    const h2 = l14.pick(ctx, a === 1 ? undefined : new Set([norm(fallbackKw(p))]));
    if (h2) note('L14', h2.reused);
    slots.push({ page: p, art: a, h2 });
  }
  const picked = new Map<string, Record<SlotKey, (PoolItem & { reused: boolean }) | null>>();
  for (const s of slots) {
    const primary = s.art === 1 ? fallbackKw(s.page) : s.h2?.text || fallbackKw(s.page);
    const ctx = union(pageCtx[s.page], tokens(primary));
    const m = {} as Record<SlotKey, (PoolItem & { reused: boolean }) | null>;
    for (const k of SLOT_KEYS) { m[k] = pools[k].pick(ctx); if (m[k]) note(POOL_TAG[k], m[k]!.reused); }
    picked.set(`${s.page}-${s.art}`, m);
  }
  const blogs: ArticleDraft[] = [];
  for (let p = 0; p < CLUSTER.pages; p++) {
    for (let a = 1; a <= CLUSTER.perPage; a++) {
      const s = slots.find((x) => x.page === p && x.art === a)!;
      const m = picked.get(`${p}-${a}`)!;
      const blogNo = p * CLUSTER.perPage + a;
      const h1 = fallbackKw(p);
      const primary = a === 1 ? h1 : s.h2?.text || h1;
      const form = BLOG_FORMS[a - 1];
      const map = { h2: s.h2?.text || '', h3: m.h3?.text || '', h4: m.h4?.text || '', paa: m.paa?.text || '', similar: m.similar?.text || '', faq: m.faq?.text || '', quora: m.quora?.text || '' };
      const page = input.pages[p];
      const b = writeBrief({ form, kw: primary, root: h1, brand, page: page.name || page.h1 || '', map, variant: blogNo, audience, secondary: [h1, map.h2, map.h3], tier: 0 });
      const intent = FORMS[form].intent || intentOf(primary);
      const sibling = p * CLUSTER.perPage + (a === CLUSTER.perPage ? 1 : a + 1);
      const draft: ArticleDraft = {
        layerNo: 15, tier: 0, code: `W${pad(blogNo)}`, seq: 0, blogNo, pageSlot: p + 1, articleInPage: a, siteNo: null, subSite: null, articleNo: null, parentCode: null, targetPageUrl: page.url,
        h1, h2: map.h2 || null, h3: map.h3 || null, h4: map.h4 || null, paa: map.paa || null, similar: map.similar || null, faq: map.faq || null, quora: map.quora || null,
        primaryKeyword: primary, hierarchy: a === 1 ? 'H1' : s.h2?.tag || 'H2', secondaryKeywords: [h1, map.h2, map.h3].filter((x) => x && norm(x) !== norm(primary)),
        sources: { H1: pageKw[p]?.rank ?? null, H2: s.h2?.rank ?? null, '11-B': m.h3?.rank ?? null, '11-C': m.h4?.rank ?? null, '11-D': m.paa?.rank ?? null, '11-E': m.similar?.rank ?? null, '11-F': m.faq?.rank ?? null, '11-G': m.quora?.rank ?? null, reused: !!(s.h2?.reused || m.h3?.reused) },
        role: b.f.role, title: b.title, slug: slugOf(b.title), metaTitle: b.metaTitle, metaDescription: b.metaDescription, metaTags: b.tags,
        intentType: intent, journeyStage: journeyOf(intent), objective: b.f.objective, angle: b.f.angle, audience, tone: TONE, intro: b.intro, outline: b.outline,
        wordTarget: a === 1 ? 1800 : b.f.words, placementRules: PLACEMENT, anchorText: null,
        linkPlan: [
          { role: 'target-page', toCode: null, targetUrl: page.url, anchor: h1, rel: 'dofollow', position: 'paragraph 2' },
          { role: 'sibling', toCode: `W${pad(sibling)}`, targetUrl: null, anchor: '', rel: 'dofollow', position: 'closing section' },
        ],
        cta: ctaOf(intent, brand), schemaType: b.f.schema, imageBrief: `Featured image showing ${primary}; alt text: "${primary}" - ${brand}`, avoid: AVOID,
        publishDate: addDays(input.nextMonthStart, blogNo - 1),
      };
      blogs.push(draft);
    }
  }
  blogs.sort((x, y) => x.blogNo - y.blogNo);
  // sibling anchors point to the sibling's own primary keyword
  for (const b of blogs) { const sib = blogs.find((x) => x.code === b.linkPlan[1].toCode); b.linkPlan[1].anchor = sib ? sib.primaryKeyword : b.primaryKeyword; }
  for (const b of blogs) { b.seq = ++seq; out.push(b); byCode.set(b.code, b); }

  // 3) tiers: each article draws the supporting keyword of one slot type; the angle follows the slot type
  const make = (tier: 1 | 2 | 3, parent: ArticleDraft, siteNo: number, subSite: number | null, articleNo: number): ArticleDraft => {
    const root = byCode.get(`W${pad(parent.blogNo)}`)!;
    const key = SLOT_KEYS[articleNo - 1];
    const ctx = union(tokens(pageWords(input.pages[root.pageSlot - 1])), tokens(root.primaryKeyword), tokens(parent.primaryKeyword));
    const sup = pools[key].pick(ctx, new Set([norm(parent.primaryKeyword), norm(root.primaryKeyword)]));
    if (sup) note(POOL_TAG[key], sup.reused);
    const kw = sup?.text || `${root.primaryKeyword} ${['overview', 'tips', 'questions', 'alternatives', 'faqs', 'advice'][articleNo - 1]}`;
    const form = TIER_FORMS[articleNo - 1];
    const map = { h2: '', h3: '', h4: '', paa: '', similar: '', faq: '', quora: '' } as Record<string, string>;
    map[key] = kw;
    const page = input.pages[root.pageSlot - 1];
    const variant = (siteNo + articleNo + (subSite || 0)) % 3;
    const b = writeBrief({ form, kw, root: root.primaryKeyword, brand, page: page.name || page.h1 || '', map: map as any, variant, audience, secondary: [root.primaryKeyword, parent.primaryKeyword], tier });
    const intent = FORMS[form].intent || intentOf(kw);
    const code = tier === 3 ? `T3-S${pad(Math.ceil(siteNo / 3))}-B${subSite}-A${articleNo}` : `T${tier}-S${pad(siteNo)}-A${articleNo}`;
    const kind = ANCHOR_KINDS[(articleNo - 1 + (subSite || 0)) % ANCHOR_KINDS.length];
    const related = [parent.h2, parent.h3, parent.h4, parent.similar, parent.paa].find((x) => x && norm(x) !== norm(parent.primaryKeyword)) || '';
    const anchor = anchorFor(kind, parent.primaryKeyword, related, brand);
    const gap = tier === 1 ? articleNo : 7;
    const d: ArticleDraft = {
      layerNo: tier === 1 ? 16 : 17, tier, code, seq: 0, blogNo: root.blogNo, pageSlot: root.pageSlot, articleInPage: null, siteNo, subSite, articleNo, parentCode: parent.code, targetPageUrl: root.targetPageUrl,
      h1: null, h2: null, h3: map.h3 || null, h4: map.h4 || null, paa: map.paa || null, similar: map.similar || null, faq: map.faq || null, quora: map.quora || null,
      primaryKeyword: kw, hierarchy: POOL_TAG[key], secondaryKeywords: [root.primaryKeyword, parent.primaryKeyword].filter((x, i, a) => norm(x) !== norm(kw) && a.findIndex((y) => norm(y) === norm(x)) === i),
      sources: { [POOL_TAG[key]]: sup?.rank ?? null, reused: !!sup?.reused },
      role: b.f.role, title: b.title, slug: slugOf(b.title), metaTitle: b.metaTitle, metaDescription: b.metaDescription, metaTags: b.tags,
      intentType: intent, journeyStage: journeyOf(intent), objective: b.f.objective, angle: b.f.angle, audience, tone: TONE, intro: b.intro, outline: b.outline,
      wordTarget: TIER_WORDS[tier], placementRules: PLACEMENT, anchorText: anchor,
      linkPlan: [{ role: 'parent', toCode: parent.code, targetUrl: null, anchor, rel: 'dofollow', position: tier === 1 ? 'paragraph 2' : 'paragraph 3' }],
      cta: ctaOf(intent, brand), schemaType: b.f.schema, imageBrief: `Featured image showing ${kw}; alt text: "${kw}" - ${brand}`, avoid: AVOID,
      publishDate: addDays(parent.publishDate, gap),
    };
    return d;
  };
  const tier1: ArticleDraft[] = [];
  for (const blog of blogs) for (let a = 1; a <= CLUSTER.siteArticles; a++) tier1.push(make(1, blog, blog.blogNo, null, a));
  for (const t of tier1) { t.seq = ++seq; out.push(t); byCode.set(t.code, t); }
  const tier2: ArticleDraft[] = [];
  for (const t of tier1) tier2.push(make(2, t, t.siteNo!, null, t.articleNo!));
  for (const t of tier2) { t.seq = ++seq; out.push(t); byCode.set(t.code, t); }
  const tier3: ArticleDraft[] = [];
  for (let site = 1; site <= CLUSTER.blogs; site++) for (let b = 1; b <= CLUSTER.tier3PerTier2Site; b++) for (let a = 1; a <= CLUSTER.siteArticles; a++) {
    const parent = byCode.get(`T2-S${pad(site)}-A${a}`)!;
    tier3.push(make(3, parent, (site - 1) * CLUSTER.tier3PerTier2Site + b, b, a));
  }
  for (const t of tier3) { t.seq = ++seq; out.push(t); byCode.set(t.code, t); }
  return { articles: out, checks: checkPlan(out, reuse) };
}

function ctaOf(intent: Intent, brand: string): string {
  return intent === 'Transactional' ? `Book or enquire with ${brand} today.` : intent === 'Commercial' || intent === 'Local' ? `See how ${brand} can help - get in touch for a quote.` : `Explore more guides from ${brand}.`;
}

// ---------- checks ----------
export interface PlanChecks { ok: boolean; counts: Record<string, number>; reuse: Record<string, number>; problems: string[] }
export function checkPlan(a: ArticleDraft[], reuse: Record<string, number> = {}): PlanChecks {
  const problems: string[] = [];
  const counts = { blogs: 0, tier1: 0, tier2: 0, tier3: 0, total: a.length } as Record<string, number>;
  const codes = new Set<string>();
  for (const x of a) {
    counts[x.tier === 0 ? 'blogs' : 'tier' + x.tier]++;
    if (codes.has(x.code)) problems.push('duplicate code ' + x.code);
    codes.add(x.code);
  }
  const want: Record<string, number> = { blogs: 30, tier1: 180, tier2: 180, tier3: 540, total: CLUSTER.total };
  for (const k of Object.keys(want)) if (counts[k] !== want[k]) problems.push(`${k}: ${counts[k]} (expected ${want[k]})`);
  const children = new Map<string, number>();
  for (const x of a) {
    if (x.parentCode) { if (!codes.has(x.parentCode)) problems.push(`${x.code}: parent ${x.parentCode} missing`); children.set(x.parentCode, (children.get(x.parentCode) || 0) + 1); }
    if (x.metaTitle.length > 60) problems.push(`${x.code}: meta title ${x.metaTitle.length} > 60`);
    if (x.metaDescription.length > 155) problems.push(`${x.code}: meta description ${x.metaDescription.length} > 155`);
    if (!x.title || !x.intro || !x.outline.length) problems.push(`${x.code}: incomplete brief`);
  }
  for (const x of a) {
    const want2 = x.tier === 0 ? 6 : x.tier === 1 ? 1 : x.tier === 2 ? 3 : 0;
    if ((children.get(x.code) || 0) !== want2) problems.push(`${x.code}: ${children.get(x.code) || 0} children (expected ${want2})`);
  }
  return { ok: problems.length === 0, counts, reuse, problems: problems.slice(0, 50) };
}
