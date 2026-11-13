import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { CustomerApisService } from '../customer-apis/customer-apis.service';
import { mangoolsGet, mangoolsPost } from '../customer-apis/mangools/client';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { Layer10Quora } from './layer10.entities';
import { Layer11Keyword, Layer11State } from './layer11.entities';

// Layer 11 - Keyword Analysis (port of the plugin's 11-AA): the customer's seed keywords and the Layer 10 Quora primary
// keywords, validated with Mangools / KWFinder, plus competitor keywords from Keywords Everywhere. Runs on its set date
// (Day 11) or on demand; every step that has no API key is skipped with a warning and the Layer stays "in progress".
export const L11_SEED_MAX = 20;
export const L11_COMPETITOR_MAX = 5;
export const L11_COMPETITOR_KEYWORDS = 10;
export const L11_QUORA_MAX = 40;
export const SRC_SEED = 'Customer Seed Keyword';
export const SRC_QUORA = 'Quora Primary Keyword';
export const SRC_MANGOOLS = 'Mangools / KWFinder Seed Validation';
export const SRC_KE = 'Keywords Everywhere Competitor Keyword';
const STALE_RUN_MS = 15 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) : [];
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export const normKw = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
export const demandOf = (sv: number | null): string => (sv === null ? 'Pending Market Evidence' : sv >= 1000 ? 'High' : sv >= 250 ? 'Medium-High' : sv >= 50 ? 'Medium' : 'Low');
export const starOf = (w: number): number => Math.max(1, Math.min(5, Math.ceil(Math.max(1, w) / 20)));
// Seed: base 55 plus a volume bonus of up to 20 (plugin layer11_apply_mangools_seed).
export const seedWeight = (sv: number | null): number => (sv !== null && sv > 0 ? Math.min(100, 55 + Math.min(20, Math.log10(sv + 1) * 6)) : 55);
// Competitor keyword: 45 plus a volume bonus of up to 25 (plugin layer11_apply_ke_domain).
export const competitorWeight = (sv: number): number => Math.min(100, 45 + Math.min(25, Math.log10(Math.max(1, sv) + 1) * 7));
// Quora primary keyword, weighted by the Layer 10 relevance of its question.
export const quoraWeight = (rel: string | null | undefined): number => {
  const r = String(rel || '').toLowerCase().trim();
  return r === 'high' || r === 'very high' ? 85 : r === 'medium-high' ? 75 : r === 'medium' ? 65 : r === 'low' ? 50 : 60;
};

export interface Cand { keyword: string; volume: number | null; cpc: number | null; competition: string | null }

// Port of the plugin's external_keyword_candidates: walks any Mangools / Keywords Everywhere response and collects every
// object that carries a keyword (keyword | kw | query) with its volume (search_volume | sv | vol | volume), CPC and competition.
export function parseCandidates(node: any): Cand[] {
  const out: Cand[] = [];
  const seen = new Set<string>();
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  };
  const walk = (x: any, depth: number) => {
    if (!x || typeof x !== 'object' || depth > 8) return;
    if (!Array.isArray(x)) {
      const kw = String(x.keyword ?? x.kw ?? x.query ?? '').trim();
      if (kw) {
        const info = x.keyword_info && typeof x.keyword_info === 'object' ? x.keyword_info : {};
        const cpcRaw = info.cpc ?? (x.cpc && typeof x.cpc === 'object' ? x.cpc.value : x.cpc);
        const comp = info.competition ?? x.competition ?? x.ppc ?? info.competition_level ?? x.competition_level ?? null;
        const n = normKw(kw);
        if (n && !seen.has(n)) {
          seen.add(n);
          out.push({ keyword: kw.slice(0, 500), volume: num(info.search_volume ?? x.search_volume ?? x.sv ?? x.vol ?? x.volume), cpc: num(cpcRaw), competition: comp === null || typeof comp === 'object' ? null : String(comp).slice(0, 40) });
        }
      }
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(node, 0);
  return out;
}

const SKIP_HOSTS = /(^|\.)(apps\.apple\.com|play\.google\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com|wikipedia\.org|quora\.com|reddit\.com|pinterest\.com|medium\.com)$/;
export function hostOf(u: string): string {
  const s = u.trim();
  if (!s) return '';
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
// Distinct competitor domains of the profile (social networks, app stores and the like are not competitor sites).
export function competitorHosts(profile: Record<string, any>, max = L11_COMPETITOR_MAX): string[] {
  const out: string[] = [];
  for (const raw of list(profile.competitors)) {
    const h = hostOf(raw);
    if (!h || !h.includes('.') || SKIP_HOSTS.test(h) || out.includes(h)) continue;
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}
export function locationQuery(profile: Record<string, any>): string {
  return list(profile.locations)[0] || list(profile.areas_served)[0] || str(profile.service_area) || str(profile.town) || str(profile.state) || 'India';
}

interface Keys { mangools: string; locationId: number; languageId: number; ke: string }

@Injectable()
export class Layer11Service {
  private readonly log = new Logger('Layer11');
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(Layer11Keyword) private readonly kr: Repository<Layer11Keyword>,
    @InjectRepository(Layer11State) private readonly sr: Repository<Layer11State>,
    @InjectRepository(Layer10Quora) private readonly l10: Repository<Layer10Quora>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly customerApis: CustomerApisService,
    private readonly layers: LayersService,
  ) {}

  async monthOf(customerId: string, month: string): Promise<Project> {
    const idx = parseInt(String(month || '').replace(/^m/i, ''), 10);
    if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M3.');
    const p = await this.projects.findOne({ where: { customerId, monthIndex: idx } });
    if (!p) throw new NotFoundException(`Month M${idx} does not exist for this customer.`);
    return p;
  }

  private async customerOf(customerId: string): Promise<Customer> {
    const c = await this.customers.findOne({ where: { id: customerId } });
    if (!c) throw new NotFoundException('Customer not found.');
    return c;
  }

  private async keys(customerId: string): Promise<Keys> {
    const k: any = await this.customerApis.getKeys(customerId);
    const num = (v: unknown) => {
      const n = parseInt(String(v ?? ''), 10);
      return isNaN(n) || n <= 0 ? 0 : n;
    };
    return { mangools: String(k['mangools']?.apiKey || ''), locationId: num(k['mangools']?.locationId), languageId: num(k['mangools']?.languageId) || 1000, ke: String(k['keywords_everywhere']?.apiKey || '') };
  }

  private async state(project: Project): Promise<Layer11State> {
    const existing = await this.sr.findOne({ where: { projectId: project.id } });
    if (existing) return existing;
    return this.sr.create({ customerId: project.customerId, projectId: project.id, status: 'idle', message: null, warnings: null, locationId: null, lastRunAt: null });
  }

  // Step 1 (free): the customer's seed keywords and the Layer 10 Quora primary keywords become rows that are
  // "pending validation". Existing rows are kept as they are (validated data is never overwritten).
  private async bootstrap(project: Project, customer: Customer): Promise<void> {
    const profile = (customer.profile || {}) as Record<string, any>;
    const rows = await this.kr.find({ where: { projectId: project.id } });
    const byNorm = new Map(rows.map((r) => [r.keyNorm, r]));
    const add = (keyword: string, source: string, isSeed: boolean, weight: number) => {
      const n = normKw(keyword);
      if (!n) return;
      const have = byNorm.get(n);
      if (have) {
        if (isSeed && !have.isSeed && !have.validated) {
          have.isSeed = true;
          have.source = SRC_SEED;
          have.weightage = Math.max(have.weightage, weight);
          have.starRating = starOf(have.weightage);
        }
        return;
      }
      const row = this.kr.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, rank: 0, keyword: keyword.slice(0, 500), keyNorm: n, source, isSeed, competitorDomain: null, volume: null, cpc: null, competition: null, demand: 'Pending Market Evidence', weightage: weight, starRating: starOf(weight), validated: false, note: 'Pending API validation' });
      byNorm.set(n, row);
    };
    list(profile.seed_keywords).slice(0, L11_SEED_MAX).forEach((k) => add(k, SRC_SEED, true, 55));
    const quora = await this.l10.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    const best = new Map<string, { kw: string; w: number }>();
    for (const q of quora) {
      const kw = str(q.primaryKeyword);
      const n = normKw(kw);
      if (!n) continue;
      const w = quoraWeight(q.relevance);
      const cur = best.get(n);
      if (!cur || w > cur.w) best.set(n, { kw, w });
    }
    [...best.values()].sort((a, b) => b.w - a.w).slice(0, L11_QUORA_MAX).forEach((b) => add(b.kw, SRC_QUORA, false, b.w));
    const all = [...byNorm.values()];
    for (let i = 0; i < all.length; i += 100) await this.kr.save(all.slice(i, i + 100));
  }

  // Step 2: Mangools / KWFinder - resolve the location once, then validate the seed keywords in one bulk request.
  private async mangoolsPhase(project: Project, customer: Customer, keys: Keys, st: Layer11State, warn: string[]): Promise<boolean> {
    const seeds = await this.kr.find({ where: { projectId: project.id, isSeed: true, validated: false } });
    if (!seeds.length) return true;
    if (!keys.mangools) {
      warn.push('Mangools seed validation skipped: no Mangools key is saved for this customer.');
      return false;
    }
    let loc = keys.locationId || st.locationId || 0;
    if (!loc) {
      const query = locationQuery((customer.profile || {}) as Record<string, any>);
      try {
        const r = await mangoolsGet(keys.mangools, 'mangools/locations', { query });
        const items: any[] = Array.isArray(r) ? r : Array.isArray(r?.locations) ? r.locations : Array.isArray(r?.items) ? r.items : [];
        const hit = items.find((i) => i && i.active && Number(i._id) > 0);
        loc = hit ? Number(hit._id) : 0;
      } catch (e) {
        warn.push('Mangools location lookup failed: ' + errMsg(e));
        return false;
      }
      if (!loc) {
        warn.push(`Mangools returned no active location for "${query}". Save a KWFinder location ID in the customer's Mangools settings.`);
        return false;
      }
      st.locationId = loc;
    }
    try {
      const r = await mangoolsPost(keys.mangools, 'kwfinder/keyword-imports', { keywords: seeds.map((s) => s.keyword).slice(0, 700), location_id: loc, language_id: keys.languageId });
      const byNorm = new Map(parseCandidates(r).map((c) => [normKw(c.keyword), c]));
      let matched = 0;
      const hits = seeds.filter((s) => byNorm.has(s.keyNorm)).length;
      for (const s of seeds) {
        const c = byNorm.get(s.keyNorm);
        if (!c) {
          // Mangools answered but has no data for this one: it counts as checked (so it is not paid for again).
          if (hits > 0) { s.validated = true; s.note = 'No Mangools volume available for this keyword'; }
          continue;
        }
        matched++;
        s.volume = c.volume;
        s.cpc = c.cpc;
        s.competition = c.competition;
        s.demand = demandOf(c.volume);
        s.weightage = round2(seedWeight(c.volume));
        s.starRating = starOf(s.weightage);
        s.validated = true;
        s.source = SRC_MANGOOLS;
        s.note = null;
      }
      await this.kr.save(seeds);
      if (!matched) warn.push('Mangools answered but none of the returned keywords matched the saved seed keywords exactly.');
      return matched > 0;
    } catch (e) {
      warn.push('Mangools seed validation failed: ' + errMsg(e));
      return false;
    }
  }

  private async keDomain(key: string, host: string): Promise<any> {
    const body = new URLSearchParams({ dataSource: 'gkp', country: (process.env.KE_COUNTRY || 'in').toLowerCase(), currency: (process.env.KE_CURRENCY || 'inr').toLowerCase(), domain: host });
    const res = await fetch('https://api.keywordseverywhere.com/v1/get_domain_keywords', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let b: any = {};
    try { b = JSON.parse(text); } catch { /* keep {} */ }
    if (!res.ok) throw new Error(String(b?.message || b?.error || b?.description || `HTTP ${res.status}`));
    return b;
  }

  // Step 3: Keywords Everywhere - up to 5 competitor domains, one request each, the 10 best volume-bearing new keywords of each.
  private async kePhase(project: Project, customer: Customer, keys: Keys, warn: string[]): Promise<boolean> {
    const hosts = competitorHosts((customer.profile || {}) as Record<string, any>);
    if (!hosts.length) {
      warn.push('Keywords Everywhere skipped: the customer profile has no usable competitor website.');
      return true;
    }
    const rows = await this.kr.find({ where: { projectId: project.id } });
    const todo = hosts.filter((h) => !rows.some((r) => r.competitorDomain === h));
    if (!todo.length) return true;
    if (!keys.ke) {
      warn.push('Keywords Everywhere skipped: no key is saved for this customer.');
      return false;
    }
    const seen = new Set(rows.map((r) => r.keyNorm));
    let ok = true;
    for (let i = 0; i < todo.length; i++) {
      if (i) await sleep(1200);
      try {
        const cands = parseCandidates(await this.keDomain(keys.ke, todo[i])).filter((c) => c.volume !== null && !seen.has(normKw(c.keyword))).sort((a, b) => (b.volume as number) - (a.volume as number)).slice(0, L11_COMPETITOR_KEYWORDS);
        const fresh = cands.map((c) => {
          const n = normKw(c.keyword);
          seen.add(n);
          const w = round2(competitorWeight(c.volume as number));
          return this.kr.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, rank: 0, keyword: c.keyword, keyNorm: n, source: SRC_KE, isSeed: false, competitorDomain: todo[i], volume: c.volume, cpc: c.cpc, competition: c.competition, demand: demandOf(c.volume), weightage: w, starRating: starOf(w), validated: true, note: null });
        });
        if (fresh.length) await this.kr.save(fresh);
        else warn.push(`Keywords Everywhere returned no new volume-bearing keywords for ${todo[i]}.`);
      } catch (e) {
        ok = false;
        warn.push(`Keywords Everywhere ${todo[i]}: ${errMsg(e)}`);
        if (/credit|unauthor|invalid|401|402|403/i.test(errMsg(e))) break;
      }
    }
    return ok;
  }

  // Final rating: best weightage first, then volume, then seeds before the rest.
  private async rerank(project: Project) {
    const rows = await this.kr.find({ where: { projectId: project.id } });
    rows.sort((a, b) => b.weightage - a.weightage || (b.volume ?? -1) - (a.volume ?? -1) || Number(b.isSeed) - Number(a.isSeed) || a.keyword.localeCompare(b.keyword));
    rows.forEach((r, i) => { r.rank = i + 1; });
    for (let i = 0; i < rows.length; i += 100) await this.kr.save(rows.slice(i, i + 100));
    return { total: rows.length, withVolume: rows.filter((r) => r.volume !== null).length };
  }

  // Keeps the Layer 11 row of the Layer schedule in step: done only when every available step finished.
  async syncLayerStatus(project: Project) {
    const [n, st] = await Promise.all([this.kr.count({ where: { projectId: project.id } }), this.sr.findOne({ where: { projectId: project.id } })]);
    if (n > 0 && st?.status === 'complete') await this.layers.setByMonth(project.customerId, project.monthIndex, 11, 'done');
    else if (n > 0) await this.layers.markInProgress(project.customerId, project.monthIndex, 11);
    else await this.layers.setByMonth(project.customerId, project.monthIndex, 11, 'pending');
  }

  async execute(project: Project, customer: Customer) {
    const lock = project.id;
    if (this.running.has(lock)) return;
    this.running.add(lock);
    const st = await this.state(project);
    const warn: string[] = [];
    try {
      const keys = await this.keys(project.customerId);
      await this.bootstrap(project, customer);
      const mOk = await this.mangoolsPhase(project, customer, keys, st, warn);
      const kOk = await this.kePhase(project, customer, keys, warn);
      const { total, withVolume } = await this.rerank(project);
      st.warnings = warn;
      st.status = total === 0 ? 'failed' : mOk && kOk ? 'complete' : 'partial';
      st.message = total === 0
        ? 'No keywords: add seed keywords to the customer profile (or complete Layer 10) first.'
        : `${total} keyword(s), ${withVolume} with search volume.` + (st.status === 'partial' ? ' Some steps were skipped - see warnings.' : '');
    } catch (err) {
      st.status = 'failed';
      st.message = errMsg(err);
      st.warnings = warn;
    } finally {
      this.running.delete(lock);
    }
    st.lastRunAt = new Date();
    await this.sr.save(st);
    await this.syncLayerStatus(project);
  }

  // Admin "Run Layer 11 now": starts in the background; the page polls view().
  async startRun(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const customer = await this.customerOf(customerId);
    const st = await this.state(project);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException('Layer 11 is already running.');
    st.status = 'running';
    st.message = 'Collecting keywords...';
    st.lastRunAt = new Date();
    await this.sr.save(st);
    void this.execute(project, customer).catch((err) => this.log.error(`Layer 11: ${errMsg(err)}`));
    return this.view(customerId, month);
  }

  // Automation: the set date (Day 11 of the Month Cycle). One customer month at a time; months already complete or
  // already attempted today are skipped. Paid API calls only ever happen on the set date.
  async runDay(monthRows: Array<{ customerId: string; monthIndex: number }>, force = false): Promise<string> {
    const today = dateInTz(new Date());
    let runs = 0;
    for (const m of monthRows) {
      const project = await this.projects.findOne({ where: { customerId: m.customerId, monthIndex: m.monthIndex } });
      const customer = await this.customers.findOne({ where: { id: m.customerId } });
      if (!project || !customer) continue;
      const st = await this.state(project);
      if (!force && st.status === 'complete') continue;
      if (!force && st.lastRunAt && dateInTz(st.lastRunAt) === today && st.status !== 'idle') continue;
      await this.execute(project, customer);
      runs++;
    }
    return `${runs} customer month(s) analysed`;
  }

  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const customer = await this.customerOf(customerId);
    const [rows, st, keys] = await Promise.all([this.kr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.sr.findOne({ where: { projectId: project.id } }), this.keys(customerId)]);
    const profile = (customer.profile || {}) as Record<string, any>;
    let status = st?.status || 'idle';
    if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
    return {
      month: project.monthCode,
      total: rows.length,
      complete: rows.length > 0 && status === 'complete',
      status,
      message: st?.message || '',
      warnings: st?.warnings || [],
      lastRunAt: st?.lastRunAt ?? null,
      keys: { mangools: !!keys.mangools, keywordsEverywhere: !!keys.ke },
      locationId: keys.locationId || st?.locationId || null,
      profile: { seedKeywords: list(profile.seed_keywords).length, competitors: competitorHosts(profile, 50).length },
      records: rows.map((r) => ({ rank: r.rank, keyword: r.keyword, source: r.source, isSeed: r.isSeed, competitorDomain: r.competitorDomain, volume: r.volume, cpc: r.cpc, competition: r.competition, demand: r.demand, weightage: r.weightage, star: r.starRating, validated: r.validated, note: r.note })),
    };
  }

  // Customer panel (WordPress): the table once every available step has finished.
  async customerTable(customerId: string, month?: string) {
    let project: Project | null = null;
    if (month) project = await this.monthOf(customerId, month);
    else {
      const today = todayInTz();
      const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0] || null;
    }
    if (!project) return { layer: 11, complete: false, month: null, total: 0, expected: 0, html: '', platforms: [] };
    const [rows, st] = await Promise.all([this.kr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.sr.findOne({ where: { projectId: project.id } })]);
    const complete = rows.length > 0 && st?.status === 'complete';
    return { layer: 11, complete, month: project.monthCode, total: rows.length, expected: 0, html: complete ? renderHtml(rows) : '', platforms: [] };
  }

  async removeByCustomer(customerId: string) {
    await this.kr.delete({ customerId });
    await this.sr.delete({ customerId });
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));
const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

export function renderHtml(rows: Layer11Keyword[]): string {
  const head = ['Final Rating', 'Keyword', 'Source', 'Seed Keyword', 'Competitor Domain', 'Volume', 'Demand', 'Weightage', 'Star Rating'];
  const body = rows
    .map((r) => '<tr>' + [r.rank, r.keyword, r.source, r.isSeed ? 'Yes' : 'No', r.competitorDomain, r.volume === null ? null : r.volume.toLocaleString('en-US'), r.demand, r.weightage, stars(r.starRating)].map((c) => `<td>${dash(c)}</td>`).join('') + '</tr>')
    .join('');
  return `<table class="kp21-l11"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
