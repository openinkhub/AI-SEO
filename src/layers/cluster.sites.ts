// Layers 18-20 - platform mapping for the 930-article cluster: PURE (no Nest / DB imports, unit-testable).
//
//   Layer 18  Tier 1  30 sites x 6 articles = 180   (site N hosts the 6 articles that link to website blog N)
//   Layer 19  Tier 2  30 sites x 6 articles = 180   (site N, article A links to Tier 1 site N, article A)
//   Layer 20  Tier 3  90 sites x 6 articles = 540   (Tier 2 site N has 3 follow-up sites: B1 app., B2 site., B3 one of the 30 extra hosts)
//
// The site lists are the ones supplied by the Admin (2026-11-15). Tier 1 public platforms are listed by their home page - the account / blog
// URL is only known once the article is published (Layer 21 fills publishedUrl).

export interface PublishSite { no: number; name: string; url: string; kind: 'public' | 'own' }
export interface SiteRef { tier: 1 | 2 | 3; siteNo: number; subSite: number | null; name: string; url: string; kind: 'public' | 'own'; host: string }

const pub = (name: string, url: string) => ({ name, url, kind: 'public' as const });
const own = (name: string, url: string) => ({ name, url, kind: 'own' as const });
const num = <T>(xs: T[]): Array<T & { no: number }> => xs.map((x, i) => ({ ...x, no: i + 1 }));

// Tier 1 (30): the 15 public platforms of the old plugin (Evernote dropped), then the 15 self-hosted sites.
export const TIER1_SITES: PublishSite[] = num([
  pub('Google Sites', 'https://sites.google.com'), pub('Blogger', 'https://www.blogger.com'), pub('WordPress', 'https://wordpress.com'), pub('Medium', 'https://medium.com'),
  pub('Substack', 'https://substack.com'), pub('Notion', 'https://www.notion.so'), pub('Weebly', 'https://www.weebly.com'), pub('Strikingly', 'https://www.strikingly.com'),
  pub('Hashnode', 'https://hashnode.com'), pub('Beehiiv', 'https://www.beehiiv.com'), pub('LiveJournal', 'https://www.livejournal.com'), pub('Pearltrees', 'https://www.pearltrees.com'),
  pub('WriteUpCafe', 'https://writeupcafe.com'), pub('Misar', 'https://www.misar.blog'), pub('JustPaste.it', 'https://justpaste.it'),
  own('Nexorapress', 'https://nexorapress.blog'), own('Primenarrative', 'https://primenarrative.blog'), own('Startupstack', 'https://startupstack.blog'), own('Beyondmetrics', 'https://beyondmetrics.blog'),
  own('Nextreach', 'https://nextreach.blog'), own('Growthscript', 'https://growthscript.blog'), own('SignalLoom', 'https://signalloom.blog'), own('Openinkhub', 'https://openinkhub.blog'),
  own('World Buzz', 'https://worldbuzz.wiki'), own('Startupseo', 'https://startupseo.blog'), own('Ranklaunch', 'https://ranklaunch.blog'), own('Seedtosearch', 'https://seedtosearch.blog'),
  own('Growthserp', 'https://growthserp.blog'), own('Startupvision', 'https://startupvision.blog'), own('Openink Blogspot', 'https://blog.openinkhub.cloud'),
]);

// Tier 2 (30), in the order supplied.
export const TIER2_SITES: PublishSite[] = num([
  own('trendnest', 'https://trendnest.buzz'), own('buzzchronicle', 'https://buzzchronicle.forum'), own('wisdomtrack', 'https://wisdomtrack.study'), own('futurebytes', 'https://futurebytes.cyou'),
  own('storyforum', 'https://storyforum.sbs'), own('exploreworld', 'https://exploreworld.surf'), own('creativeorbit', 'https://creativeorbit.space'), own('digitalexpress', 'https://digitalexpress.click'),
  own('modernjournal', 'https://modernjournal.living'), own('studybeacon', 'https://studybeacon.cfd'), own('visualstories', 'https://visualstories.pics'), own('contentjunction', 'https://contentjunction.casa'),
  own('Rankquest Blog', 'https://rankquest.cfd'), own('creativecasa', 'https://creativecasa.homes'), own('homejournal', 'https://homejournal.rest'), own('restandread', 'https://restandread.cfd'),
  own('rankquest', 'https://rankquest.sbs'), own('trendpilot', 'https://trendpilot.cyou'), own('growthvision', 'https://growthvision.cfd'), own('startupgrowth', 'https://startupgrowth.online'),
  own('nexorapress', 'https://nexorapress.courses'), own('primenarrative', 'https://primenarrative.site'), own('webbuzzdaily', 'https://webbuzzdaily.cfd'), own('growthserp', 'https://growthserp.store'),
  own('nextreach', 'https://nextreach.quest'), own('growthscript', 'https://growthscript.website'), own('startupgrowth', 'https://startupgrowth.cyou'), own('dailysurf', 'https://dailysurf.cyou'),
  own('blogspace', 'https://blogspace.cyou'), own('shopstories', 'https://shopstories.sbs'),
]);

// Tier 3 extra hosts (30): 15 "App" hosts then the 15 matching "Site" hosts. Tier 2 site N uses extra host N as its third follow-up site (B3).
const EXTRA_BASES: Array<{ name: string; app: string; site: string }> = [
  { name: 'StartupSEO', app: 'app.startupseo.blog', site: 'site.startupseo.blog' }, { name: 'RankLaunch', app: 'app.ranklaunch.blog', site: 'site.ranklaunch.blog' },
  { name: 'SeedToSearch', app: 'app.seedtosearch.blog', site: 'site.seedtosearch.blog' }, { name: 'GrowthSERP', app: 'app.growthserp.blog', site: 'site.growthserp.blog' },
  { name: 'StartupVision', app: 'app.startupvision.blog', site: 'site.startupvision.blog' }, { name: 'Openinkblogspot', app: 'web.openinkhub.cloud', site: 'site.openinkhub.cloud' },
  { name: 'signalloom', app: 'app.signalloom.blog', site: 'site.signalloom.blog' }, { name: 'beyondmetrics', app: 'app.beyondmetrics.blog', site: 'site.beyondmetrics.blog' },
  { name: 'openinkhub', app: 'app.openinkhub.blog', site: 'site.openinkhub.blog' }, { name: 'primenarrative', app: 'app.primenarrative.blog', site: 'site.primenarrative.blog' },
  { name: 'nexorapress', app: 'app.nexorapress.blog', site: 'site.nexorapress.blog' }, { name: 'nextreach', app: 'app.nextreach.blog', site: 'site.nextreach.blog' },
  { name: 'startupstack', app: 'app.startupstack.blog', site: 'site.startupstack.blog' }, { name: 'growthscript', app: 'app.growthscript.blog', site: 'site.growthscript.blog' },
  { name: 'World Buzz', app: 'app.worldbuzz.wiki', site: 'site.worldbuzz.wiki' },
];
export const TIER3_EXTRA: PublishSite[] = num([
  ...EXTRA_BASES.map((b) => own(`${b.name} App`, `https://${b.app}`)),
  ...EXTRA_BASES.map((b) => own(`${b.name} Site`, `https://${b.site}`)),
]);

export const SITE_COUNTS = { tier1: 30, tier2: 30, tier3: 90, perSite: 6, perTier2: 3 };

const hostOf = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

// The site that hosts an article. Tier 3 siteNo is 1..90 (3 per Tier 2 site) and subSite 1..3.
export function siteFor(tier: number, siteNo: number | null, subSite?: number | null): SiteRef | null {
  if (!siteNo) return null;
  if (tier === 1) { const s = TIER1_SITES[siteNo - 1]; return s ? { tier: 1, siteNo, subSite: null, name: s.name, url: s.url, kind: s.kind, host: hostOf(s.url) } : null; }
  if (tier === 2) { const s = TIER2_SITES[siteNo - 1]; return s ? { tier: 2, siteNo, subSite: null, name: s.name, url: s.url, kind: s.kind, host: hostOf(s.url) } : null; }
  if (tier === 3) {
    const t2No = Math.ceil(siteNo / SITE_COUNTS.perTier2);
    const b = subSite || ((siteNo - 1) % SITE_COUNTS.perTier2) + 1;
    const t2 = TIER2_SITES[t2No - 1];
    if (!t2 || b < 1 || b > 3) return null;
    if (b === 3) { const x = TIER3_EXTRA[t2No - 1]; return { tier: 3, siteNo, subSite: 3, name: x.name, url: x.url, kind: x.kind, host: hostOf(x.url) }; }
    const prefix = b === 1 ? 'app' : 'site';
    const url = `https://${prefix}.${hostOf(t2.url)}`;
    return { tier: 3, siteNo, subSite: b, name: `${t2.name} ${b === 1 ? 'App' : 'Site'}`, url, kind: 'own', host: hostOf(url) };
  }
  return null;
}

// Where the article is expected to live once published - only for sites on the Admin's own domains (the platform assigns the URL otherwise).
export function plannedUrl(site: SiteRef | null, slug: string): string | null {
  if (!site || site.kind !== 'own' || !slug) return null;
  return `${site.url.replace(/\/+$/, '')}/${slug}`;
}

export interface MapRow { code: string; tier: number; siteNo: number | null; subSite: number | null; articleNo: number | null; platform?: string | null }

// Checks of the finished mapping: 30 / 30 / 90 sites, 6 articles on each, no site shared between two Tier 3 slots, every article has a site.
export function checkMapping(rows: MapRow[]): { ok: boolean; counts: Record<string, number>; problems: string[] } {
  const problems: string[] = [];
  const per = new Map<string, number>();
  const t3Urls = new Map<string, string>();
  for (const r of rows) {
    if (r.tier < 1) continue;
    const s = siteFor(r.tier, r.siteNo, r.subSite);
    if (!s) { problems.push(`${r.code}: no site for tier ${r.tier} site ${r.siteNo}`); continue; }
    const k = `${r.tier}|${r.siteNo}`;
    per.set(k, (per.get(k) || 0) + 1);
    if (r.tier === 3) { const prev = t3Urls.get(s.url); if (prev && prev !== `${r.siteNo}`) problems.push(`Tier 3 sites ${prev} and ${r.siteNo} share ${s.url}`); t3Urls.set(s.url, `${r.siteNo}`); }
  }
  const sites = (t: number) => [...per.keys()].filter((k) => k.startsWith(t + '|')).length;
  const counts = { tier1Sites: sites(1), tier2Sites: sites(2), tier3Sites: sites(3), tier1: rows.filter((r) => r.tier === 1).length, tier2: rows.filter((r) => r.tier === 2).length, tier3: rows.filter((r) => r.tier === 3).length };
  if (counts.tier1Sites !== SITE_COUNTS.tier1) problems.push(`Tier 1 uses ${counts.tier1Sites} sites, expected ${SITE_COUNTS.tier1}`);
  if (counts.tier2Sites !== SITE_COUNTS.tier2) problems.push(`Tier 2 uses ${counts.tier2Sites} sites, expected ${SITE_COUNTS.tier2}`);
  if (counts.tier3Sites !== SITE_COUNTS.tier3) problems.push(`Tier 3 uses ${counts.tier3Sites} sites, expected ${SITE_COUNTS.tier3}`);
  for (const [k, n] of per) if (n !== SITE_COUNTS.perSite) problems.push(`site ${k.replace('|', ' #')} has ${n} articles, expected ${SITE_COUNTS.perSite}`);
  return { ok: problems.length === 0, counts, problems: problems.slice(0, 20) };
}

// Static check of the lists themselves (counts, no empty or repeated URL inside a tier, no URL shared between tiers).
export function checkSiteLists(): string[] {
  const problems: string[] = [];
  if (TIER1_SITES.length !== 30) problems.push(`Tier 1 has ${TIER1_SITES.length} sites`);
  if (TIER2_SITES.length !== 30) problems.push(`Tier 2 has ${TIER2_SITES.length} sites`);
  if (TIER3_EXTRA.length !== 30) problems.push(`Tier 3 extra hosts: ${TIER3_EXTRA.length}`);
  const seen = new Map<string, string>();
  const add = (label: string, url: string) => { const k = url.toLowerCase().replace(/\/+$/, ''); if (!/^https:\/\/[^/\s]+\.[^/\s]+$/.test(k)) problems.push(`${label}: bad URL ${url}`); const p = seen.get(k); if (p) problems.push(`${label} repeats ${url} (${p})`); seen.set(k, label); };
  TIER1_SITES.forEach((s) => add(`Tier 1 #${s.no}`, s.url));
  TIER2_SITES.forEach((s) => add(`Tier 2 #${s.no}`, s.url));
  for (let n = 1; n <= SITE_COUNTS.tier3; n++) { const s = siteFor(3, n); if (s) add(`Tier 3 #${n}`, s.url); else problems.push(`Tier 3 #${n}: no site`); }
  return problems;
}
