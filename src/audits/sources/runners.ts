import { mangoolsGet } from '../../customer-apis/mangools/client';
import { serpSearch, SerpResult } from './serp';
import { captureHomepage } from './screenshots';
import { analyseGsc } from './gsc';

export interface Research {
  type: string; // evidence type
  tool: string; // 'mangools' | 'serpapi'
  label: string;
  data: Record<string, any>;
}

export interface ResearchInput {
  domain: string;
  companyName: string;
  industry: string | null;
  description: string | null;
  competitors: string[];
  profile: Record<string, any>;
  mangools?: Record<string, string>;
  serpApiKey?: string;
  customerId?: string;
  screenshotKey?: string;
  // Pulls the raw Search Console export from WordPress (plugin route); undefined when the customer has no WP user.
  gscFetch?: () => Promise<Record<string, any>>;
  storeImage?: (name: string, buf: Buffer, contentType: string) => Promise<string | null>;
}

const num = (v: unknown): number | null => (v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null);
const asList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n;]+/) : []).map((x) => String(x).trim()).filter(Boolean);

export function seedKeywords(i: ResearchInput): string[] {
  const p = i.profile ?? {};
  const seeds = [...asList(p.seed_keywords), ...asList(p.products_services), ...(i.industry ? [i.industry] : [])];
  const uniq = [...new Set(seeds.map((s) => s.toLowerCase()))].filter((s) => s.length > 2 && s.length < 60);
  return uniq.slice(0, 3);
}

const cityOf = (i: ResearchInput): string => String(i.profile?.city || i.profile?.target_location || i.profile?.service_area || '').trim();

export async function runKeywordResearch(i: ResearchInput): Promise<Research[]> {
  const seeds = seedKeywords(i);
  if (!seeds.length) throw new Error('No seed keywords on the customer profile (seed_keywords / products & services / industry).');
  const out: Research[] = [];
  const kw: any[] = [];
  const warn: string[] = [];
  if (i.mangools?.apiKey) {
    const loc = num(i.mangools.locationId) ?? 0;
    const lang = num(i.mangools.languageId) ?? 1000;
    for (const seed of seeds) {
      try {
        const r = await mangoolsGet(i.mangools.apiKey, 'kwfinder/related-keywords', { kw: seed, location_id: loc, language_id: lang });
        const list: any[] = Array.isArray(r?.keywords) ? r.keywords : [];
        list.slice(0, 15).forEach((k) => kw.push({ seed, keyword: String(k.kw ?? ''), volume: num(k.sv), cpc: num(k.cpc), difficulty: num(k.seo), }));
      } catch (e: any) {
        warn.push(`KWFinder "${seed}": ${String(e?.message ?? e).slice(0, 100)}`);
        if (e?.kind === 'CreditLimit' || e?.kind === 'Auth') break;
      }
    }
  } else warn.push('Mangools key not set - no search volumes.');
  const serps: SerpResult[] = [];
  if (i.serpApiKey) {
    for (const seed of seeds) {
      try {
        serps.push(await serpSearch(i.serpApiKey, seed, { ownDomain: i.domain }));
      } catch (e: any) {
        warn.push(String(e?.message ?? e).slice(0, 120));
      }
    }
  } else warn.push('SerpApi key not set - no Google results.');
  if (!kw.length && !serps.length) throw new Error(`No keyword data could be collected. ${warn.join(' | ')}`);
  out.push({
    type: 'research_keywords',
    tool: 'mangools',
    label: 'Keyword research',
    data: {
      seeds,
      keywords: kw.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 40),
      rankChecks: serps.map((s) => ({ query: s.query, ownPosition: s.ownPosition, top: s.top.slice(0, 5), aiOverview: s.hasAiOverview })),
      relatedSearches: [...new Set(serps.flatMap((s) => s.related))].slice(0, 15),
      questions: [...new Set(serps.flatMap((s) => s.questions))].slice(0, 12),
      notes: warn,
    },
  });
  return out;
}

export async function runCompetitorResearch(i: ResearchInput): Promise<Research[]> {
  const notes: string[] = [];
  let ownKeywords: any[] = [];
  let sharing: any[] = [];
  if (i.mangools?.apiKey) {
    try {
      const loc = num(i.mangools.locationId) ?? 0;
      const r = await mangoolsGet(i.mangools.apiKey, 'kwfinder/competitor-keywords', { url: i.domain, location_id: loc });
      ownKeywords = (Array.isArray(r?.keywords) ? r.keywords : []).slice(0, 25).map((k: any) => ({ keyword: String(k.kw ?? k.keyword ?? ''), volume: num(k.sv ?? k.volume), position: num(k.position ?? k.pos ?? k.rank), visits: num(k.etv ?? k.visits) }));
      sharing = (Array.isArray(r?.competitors) ? r.competitors : []).slice(0, 10).map((c: any) => ({ domain: String(c.domain ?? c.url ?? ''), sharedKeywords: num(c.count ?? c.keywords ?? c.shared) }));
    } catch (e: any) {
      notes.push(`KWFinder: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  } else notes.push('Mangools key not set.');
  const named = i.competitors.slice(0, 5);
  const compKeywords: any[] = [];
  if (i.mangools?.apiKey) {
    const loc = num(i.mangools.locationId) ?? 0;
    for (const c of named.slice(0, 3)) {
      try {
        const r = await mangoolsGet(i.mangools.apiKey, 'kwfinder/competitor-keywords', { url: c, location_id: loc });
        const list: any[] = Array.isArray(r?.keywords) ? r.keywords : [];
        compKeywords.push({ competitor: c, total: list.length, top: list.slice(0, 8).map((k) => ({ keyword: String(k.kw ?? k.keyword ?? ''), volume: num(k.sv ?? k.volume) })) });
      } catch (e: any) {
        notes.push(`Competitor ${c}: ${String(e?.message ?? e).slice(0, 100)}`);
        if (e?.kind === 'CreditLimit' || e?.kind === 'Auth') break;
      }
    }
  }
  if (!ownKeywords.length && !sharing.length && !compKeywords.length && !named.length) throw new Error(`No competitor data could be collected. ${notes.join(' | ')}`);
  return [{ type: 'research_competitors', tool: 'mangools', label: 'Competitor research', data: { namedCompetitors: named, ownKeywords, domainsSharingKeywords: sharing, competitorKeywords: compKeywords, notes } }];
}

// Page fetch / screenshot tools: real homepage screenshots (desktop + mobile) via ScreenshotOne. The crawl data these
// tasks also use is collected by the site scan. Without a ScreenshotOne key this simply adds no screenshot row.
export async function runFetchResearch(i: ResearchInput): Promise<Research[]> {
  if (!i.screenshotKey) return [];
  const shots = await captureHomepage(i.screenshotKey, i.domain, i.customerId ?? 'customer', i.storeImage);
  if (!shots.some((s) => s.ok)) throw new Error(`ScreenshotOne: ${shots.map((s) => `${s.device} ${s.error}`).join('; ')}`);
  return [{ type: 'screenshots', tool: 'screenshotone', label: 'Homepage screenshots', data: { site: i.domain, captured: shots } }];
}

// Search Console (clicks, queries, pages, indexing) read through the WordPress plugin's common Google account.
export async function runGscResearch(i: ResearchInput): Promise<Research[]> {
  if (!i.gscFetch) throw new Error('Search Console is not reachable: this customer has no WordPress user id, or WP_BASE_URL / WP_ENGINE_API_KEY is not set on the Engine.');
  return [{ type: 'gsc_performance', tool: 'gsc', label: 'Google Search Console', data: analyseGsc(await i.gscFetch()) }];
}

export async function runLocalResearch(i: ResearchInput): Promise<Research[]> {
  if (!i.serpApiKey) throw new Error('SerpApi key not set - the local pack needs Google results.');
  const city = cityOf(i);
  if (!city) throw new Error('No city / target location on the customer profile, so a local search cannot be run.');
  const seed = seedKeywords(i)[0];
  if (!seed) throw new Error('No seed keyword to search for locally.');
  const s = await serpSearch(i.serpApiKey, `${seed} in ${city}`, { location: city, ownDomain: i.domain });
  return [{ type: 'research_local', tool: 'serpapi', label: 'Local search', data: { query: s.query, location: city, ownOrganicPosition: s.ownPosition, ownInLocalPack: s.places.some((p) => p.own), localPack: s.places, topOrganic: s.top.slice(0, 5), relatedSearches: s.related.slice(0, 8) } }];
}
