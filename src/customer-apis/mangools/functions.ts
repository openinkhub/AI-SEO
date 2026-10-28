import { mangoolsGet } from './client';

// Each Mangools function is its own unit: its own API call(s), its own evidence card and its own limit.
// Limit field semantics (customer API settings): blank = default, 0 = switched off, N = max rows.
export interface MangoolsFnDef {
  key: string;
  label: string;
  field: string; // settings field name
  fieldLabel: string;
  evidenceType: string;
  defaultLimit: number;
  onOff?: boolean; // limit is only an on/off switch (rows do not apply)
  run(ctx: Ctx, limit: number): Promise<Record<string, any>>;
}

export interface Ctx {
  apiKey: string;
  domain: string;
  homepage: string;
  cache: Record<string, any>;
}

const n = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null);

// SiteProfiler needs an overview lookup within 24h before backlink-profile / competitors / top-content.
async function overviewRaw(ctx: Ctx): Promise<any> {
  if (!ctx.cache.overview) ctx.cache.overview = await mangoolsGet(ctx.apiKey, 'siteprofiler/overview', { url: ctx.domain });
  return ctx.cache.overview;
}

async function topContentRaw(ctx: Ctx): Promise<any[]> {
  if (!ctx.cache.topContent) {
    await overviewRaw(ctx);
    const r = await mangoolsGet(ctx.apiKey, 'siteprofiler/top-content', { url: ctx.domain });
    ctx.cache.topContent = Array.isArray(r?.topContent) ? r.topContent : Array.isArray(r) ? r : [];
  }
  return ctx.cache.topContent;
}

function rankSummary(rankDist: any): Record<string, any> | null {
  const rec = Array.isArray(rankDist) ? rankDist[0] : null;
  const months = rec?.metrics_absolute && typeof rec.metrics_absolute === 'object' ? Object.keys(rec.metrics_absolute).sort() : [];
  const m = months.length ? rec.metrics_absolute[months[months.length - 1]]?.organic : null;
  if (!m) return null;
  const p = (k: string) => n(m[k]) ?? 0;
  return {
    month: months[months.length - 1],
    keywords: n(m.count),
    top3: p('pos_1') + p('pos_2_3'),
    top10: p('pos_1') + p('pos_2_3') + p('pos_4_10'),
    top20: p('pos_1') + p('pos_2_3') + p('pos_4_10') + p('pos_11_20'),
    estimatedTraffic: m.etv != null ? Math.round(Number(m.etv) * 10) / 10 : null,
    newKeywords: n(m.is_new),
    lostKeywords: n(m.is_lost),
    improved: n(m.is_up),
    dropped: n(m.is_down),
  };
}

const spOverview: MangoolsFnDef = {
  key: 'sp_overview',
  label: 'SiteProfiler - Authority overview',
  field: 'mgSpOverview',
  fieldLabel: 'SiteProfiler authority overview (0 = off, blank = on)',
  evidenceType: 'mangools_sp_overview',
  defaultLimit: 1,
  onOff: true,
  async run(ctx) {
    const o = await overviewRaw(ctx);
    return {
      domain: o?.domain ?? ctx.domain,
      authority: { domainAuthority: n(o?.moz?.pda), pageAuthority: n(o?.moz?.upa), citationFlow: n(o?.majestic?.CitationFlow), trustFlow: n(o?.majestic?.TrustFlow) },
      referringIps: n(o?.majestic?.RefIPs),
      topRank: n(o?.topRank?.rank ?? o?.topRank?.current),
      organic: rankSummary(o?.rankDist),
    };
  },
};

const spBacklinks: MangoolsFnDef = {
  key: 'sp_backlinks',
  label: 'SiteProfiler - Backlink profile',
  field: 'mgSpBacklinks',
  fieldLabel: 'SiteProfiler backlink profile: max rows (0 = off, blank = 10)',
  evidenceType: 'mangools_sp_backlinks',
  defaultLimit: 10,
  async run(ctx, limit) {
    await overviewRaw(ctx);
    const r = await mangoolsGet(ctx.apiKey, 'siteprofiler/backlink-profile', { url: ctx.domain });
    const m = r?.majestic ?? {};
    const cal: any[] = Array.isArray(r?.majesticBackLinkCalendar) ? r.majesticBackLinkCalendar.slice(-30) : [];
    return {
      backlinks: { total: n(m.ExtBackLinks), deleted: n(m.NonUniqueLinkTypeDeleted), nofollow: n(m.NonUniqueLinkTypeNoFollow), text: n(m.NonUniqueLinkTypeTextLink), image: n(m.NonUniqueLinkTypeImageLink), toHomepage: n(m.NonUniqueLinkTypeHomepages) },
      referring: { domains: n(m.RefDomains), ips: n(m.RefIPs), subnets: n(m.RefSubNets), edu: n(m.RefDomainsEDU), gov: n(m.RefDomainsGOV) },
      flow: { citationFlow: n(m.CitationFlow), trustFlow: n(m.TrustFlow) },
      indexedUrls: n(m.IndexedURLs),
      last30Days: cal.length ? { newLinks: cal.reduce((s, x) => s + (n(x?.NewLinks) ?? 0), 0), lostLinks: cal.reduce((s, x) => s + (n(x?.LostLinks) ?? 0), 0) } : null,
      topReferringDomains: (Array.isArray(r?.majesticRefDomains) ? r.majesticRefDomains : []).slice(0, limit).map((d: any) => ({ domain: d?.domain, cf: n(d?.citationFlow), tf: n(d?.trustFlow), links: n(d?.matchedLinks) })),
      anchors: (Array.isArray(r?.majesticAnchors) ? r.majesticAnchors : []).slice(0, limit).map((a: any) => ({ text: String(a?.anchorText ?? '').slice(0, 120), type: a?.class ?? '', refDomains: n(a?.refDomains), total: n(a?.totalLinks) })),
    };
  },
};

const spCompetitors: MangoolsFnDef = {
  key: 'sp_competitors',
  label: 'SiteProfiler - Competitors',
  field: 'mgSpCompetitors',
  fieldLabel: 'SiteProfiler competitors: max rows (0 = off, blank = 10)',
  evidenceType: 'mangools_sp_competitors',
  defaultLimit: 10,
  async run(ctx, limit) {
    await overviewRaw(ctx);
    const r = await mangoolsGet(ctx.apiKey, 'siteprofiler/competitors', { url: ctx.domain });
    const list: any[] = Array.isArray(r?.competitors) ? r.competitors : Array.isArray(r) ? r : [];
    return { total: list.length, competitors: list.slice(0, limit).map((c) => ({ domain: c?.domain ?? c?.domainId, overlap: n(c?.score), topRank: n(c?.topRank), referringIps: n(c?.refIps), facebookShares: n(c?.fb) })) };
  },
};

const spTopContent: MangoolsFnDef = {
  key: 'sp_top_content',
  label: 'SiteProfiler - Top content',
  field: 'mgSpTopContent',
  fieldLabel: 'SiteProfiler top content: max rows (0 = off, blank = 10)',
  evidenceType: 'mangools_sp_top_content',
  defaultLimit: 10,
  async run(ctx, limit) {
    const list = await topContentRaw(ctx);
    return { total: list.length, pages: list.slice(0, limit).map((p) => ({ url: p?.url, cf: n(p?.citationFlow), tf: n(p?.trustFlow), refDomains: n(p?.refDomains), backlinks: n(p?.extBackLinks) })) };
  },
};

const linkMiner: MangoolsFnDef = {
  key: 'linkminer',
  label: 'LinkMiner - URL link metrics',
  field: 'mgLinkMiner',
  fieldLabel: 'LinkMiner URL metrics: max URLs (0 = off, blank = 1 homepage)',
  evidenceType: 'mangools_linkminer',
  defaultLimit: 1,
  async run(ctx, limit) {
    const urls = [ctx.homepage];
    if (limit > 1) {
      const top = await topContentRaw(ctx);
      for (const p of top) if (p?.url && !urls.includes(p.url) && urls.length < limit) urls.push(p.url);
    }
    const out: any[] = [];
    for (const u of urls) {
      const r = await mangoolsGet(ctx.apiKey, 'linkminer/url-metrics', { url: u });
      const row = Array.isArray(r) ? r[0] : r;
      const v = row?.m?.majestic?.v ?? row?.majestic ?? {};
      out.push({ url: row?.url ?? u, citationFlow: n(v.CitationFlow), trustFlow: n(v.TrustFlow), refDomains: n(v.RefDomains), backlinks: n(v.ExtBackLinks), refIps: n(v.RefIPs), subnets: n(v.RefSubNets) });
    }
    return { urls: out };
  },
};

const normHost = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');

const aiWatcher: MangoolsFnDef = {
  key: 'ai_watcher',
  label: 'AI Search Watcher - AI visibility',
  field: 'mgAiWatcher',
  fieldLabel: 'AI Search Watcher: max rows (0 = off, blank = 8)',
  evidenceType: 'mangools_ai_watcher',
  defaultLimit: 8,
  async run(ctx, limit) {
    const list = await mangoolsGet(ctx.apiKey, 'aiwatcher/monitors');
    const monitors: any[] = Array.isArray(list?.monitors) ? list.monitors : Array.isArray(list) ? list : [];
    const mine = monitors.find((m) => normHost(String(m?.domain ?? '')) === normHost(ctx.domain));
    if (!mine) throw new Error(`No AI Search Watcher monitor exists for ${ctx.domain}. Create one in Mangools (AI Search Watcher) and run the audit again.`);
    const d = await mangoolsGet(ctx.apiKey, `aiwatcher/monitor/${encodeURIComponent(mine._id ?? mine.id)}`);
    let names: Record<string, string> = {};
    try {
      const mm = await mangoolsGet(ctx.apiKey, 'aiwatcher/models');
      const arr: any[] = Array.isArray(mm?.models) ? mm.models : Array.isArray(mm) ? mm : [];
      arr.forEach((x) => {
        if (x?.id != null) names[String(x.id)] = String(x.name ?? x.label ?? x.id);
      });
    } catch {
      names = {};
    }
    const mon = d?.monitor ?? mine;
    const met = d?.metrics ?? {};
    const model = (b: any) => (b ? { model: names[String(b.modelId)] ?? `Model ${b.modelId}`, value: n(b.currentValue), change: n(b.change) } : null);
    const rk = d?.rankings ?? {};
    return {
      brand: mon?.brand,
      domain: mon?.domain,
      state: mon?.monitoring_state,
      location: mon?.location?.label ?? mon?.location?.name ?? null,
      models: Array.isArray(mon?.models) ? mon.models.map((id: any) => names[String(id)] ?? `Model ${id}`) : [],
      dateRange: d?.dateRange ?? null,
      score: met.score ?? null,
      visibility: met.visibility ?? null,
      position: met.position ?? null,
      bestPerforming: model(met.bestPerforming),
      mostCited: model(met.mostCited),
      brands: (Array.isArray(rk.brands) ? rk.brands : []).slice(0, limit).map((b: any) => ({ brand: b?.brand, you: !!b?.isMatch, rank: n(b?.rank), score: n(b?.avgScore), visibility: n(b?.avgVisibility), position: n(b?.avgPosition) })),
      prompts: (Array.isArray(rk.prompts) ? rk.prompts : []).slice(0, limit).map((p: any) => ({ text: String(p?.text ?? '').slice(0, 160), score: n(p?.avgScore), visibility: n(p?.avgVisibility), position: n(p?.avgPosition), aiOverview: !!p?.aio?.hasAio })),
      citedSources: (Array.isArray(rk.domains) ? rk.domains : []).slice(0, limit).map((s: any) => ({ domain: s?.domain, title: String(s?.title ?? '').slice(0, 80), mentions: n(s?.frequency), yours: !!s?.hit })),
      history: (Array.isArray(d?.timeSeries) ? d.timeSeries : []).slice(-6).map((t: any) => ({ date: t?.date, score: n(t?.score), visibility: n(t?.visibility), position: n(t?.position) })),
    };
  },
};

// Order matters for display only. Add KWFinder / SERPWatcher / SERPChecker here later as their own units.
export const MANGOOLS_FUNCTIONS: MangoolsFnDef[] = [spOverview, spBacklinks, spCompetitors, spTopContent, linkMiner, aiWatcher];

export function limitFor(def: MangoolsFnDef, raw: string | undefined): number {
  if (raw == null || String(raw).trim() === '') return def.defaultLimit;
  const v = parseInt(String(raw), 10);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 50) : def.defaultLimit;
}
