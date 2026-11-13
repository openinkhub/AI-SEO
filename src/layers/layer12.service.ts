import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { CustomerApisService } from '../customer-apis/customer-apis.service';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { mangoolsPost } from '../customer-apis/mangools/client';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { Layer12Row, Layer12State } from './layer12.entities';
import { competitorHosts, locationQuery, normKw, starOf } from './layer11.service';
import { Layer11MasterService, fmt, stars } from './layer11master.service';
import { competitorStrength, geekflareFacts, logScore, mangoolsRows, matchCompetitors, num, resolveMangoolsLocation, round2, weightedAvailable } from './layer12.helpers';

// Layer 12 - Keyword Market Validation (port of the plugin's layer12_*): the 11-AAA master keywords validated with Mangools / KWFinder
// (volume, KD, CPC), SerpApi (which of the customer's competitor sites rank for the keyword) and Geekflare (facts of the best
// competitor page). Runs on its set date (Day 12) or on demand. Mangools and SerpApi are required for "complete"; Geekflare is optional evidence.
// Google Search Console / GA4 are not part of the Engine: own-site visibility is simply not available (its weight is redistributed).
export const L12_PAGE_MAX = 20;
const STALE_RUN_MS = 30 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const FATAL = /invalid api key|run out of searches|unauthor|forbidden|\b40[123]\b|account|credit|quota/i;
const STAGES = ['mangools', 'serpapi', 'geekflare'] as const;
type Stage = (typeof STAGES)[number];

// Recalculates the Layer 12 strength and weightage of one row from whatever evidence it holds (missing KPI weights are redistributed).
export function recalcL12(r: Pick<Layer12Row, 'baseWeightage' | 'estVolume' | 'searchVolume' | 'kd' | 'competitorCount' | 'bestCompetitorPosition' | 'page'>) {
  const strength = competitorStrength(r.competitorCount, r.bestCompetitorPosition, num(r.page?.page_strength_score));
  const w = weightedAvailable({
    layer11: [r.baseWeightage, 35],
    est_volume: [logScore(r.estVolume, 28), 10],
    mangools_volume: [logScore(r.searchVolume, 28), 15],
    kd_inverse: [r.kd !== null ? Math.max(0, 100 - r.kd) : null, 10],
    competitor_evidence: [strength, 10],
  });
  const weightage = round2(w.score !== null ? w.score : r.baseWeightage);
  return { strength: strength === null ? null : round2(strength), weightage, star: starOf(weightage), used: w.used };
}

interface Keys { mangools: string; locationId: number; languageId: number; serp: string; geek: string }

@Injectable()
export class Layer12Service {
  private readonly log = new Logger('Layer12');
  private readonly running = new Set<string>();
  private last = 0;

  constructor(
    @InjectRepository(Layer12Row) private readonly rr: Repository<Layer12Row>,
    @InjectRepository(Layer12State) private readonly sr: Repository<Layer12State>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly customerApis: CustomerApisService,
    private readonly globalApis: GlobalApisService,
    private readonly layers: LayersService,
    private readonly master: Layer11MasterService,
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
    const g: any = await this.globalApis.getKeys().catch(() => ({}));
    const n = (v: unknown) => {
      const x = parseInt(String(v ?? ''), 10);
      return isNaN(x) || x <= 0 ? 0 : x;
    };
    return { mangools: String(k['mangools']?.apiKey || ''), locationId: n(k['mangools']?.locationId), languageId: n(k['mangools']?.languageId) || 1000, serp: String(k['serpapi']?.apiKey || g['google_ai']?.apiKey || ''), geek: String(k['geekflare']?.apiKey || '') };
  }

  private async state(project: Project): Promise<Layer12State> {
    return (await this.sr.findOne({ where: { projectId: project.id } })) || this.sr.create({ customerId: project.customerId, projectId: project.id, status: 'idle', message: null, warnings: null, locationId: null, lastRunAt: null });
  }

  private async pace(ms = 1200) {
    const wait = this.last + ms - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  // The rows come from the 11-AAA master list (rebuilt first). Existing rows are kept unless force is set.
  private async prepare(project: Project, force: boolean): Promise<Layer12Row[]> {
    const have = await this.rr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    if (have.length && !force) return have;
    await this.master.build(project);
    const src = await this.master.rows(project.id);
    if (force) await this.rr.delete({ projectId: project.id });
    else if (have.length) return have;
    const rows = src.map((s, i) => {
      const r = this.rr.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, rank: i + 1, keyword: s.keyword, keyNorm: s.keyNorm, intent: s.intent, demand: s.demand, baseWeightage: s.weightage, estVolume: s.estVolume ?? s.volume, searchVolume: null, kd: null, cpc: null, ppc: null, competitorCount: null, bestCompetitorPosition: null, avgCompetitorPosition: null, competitorStrength: null, competitorDomains: [], competitorUrl: null, page: null, weightage: s.weightage, starRating: s.starRating, stages: { mangools: 'pending', serpapi: 'pending', geekflare: 'pending' }, errors: {}, usedWeights: {}, overview: null });
      this.apply(r);
      return r;
    });
    for (let i = 0; i < rows.length; i += 100) await this.rr.save(rows.slice(i, i + 100));
    return rows;
  }

  private apply(r: Layer12Row) {
    const c = recalcL12(r);
    r.competitorStrength = c.strength;
    r.weightage = c.weightage;
    r.starRating = c.star;
    r.usedWeights = c.used;
    r.overview = 'Available KPI evidence only; unavailable KPI weights are redistributed. ' + [r.searchVolume === null ? 'Mangools volume unavailable.' : `Mangools volume ${r.searchVolume}.`, r.competitorCount === null ? 'Competitor SERP unavailable.' : `${r.competitorCount} mapped competitor(s) found.`].join(' ');
  }

  // A stage that was bypassed (no key, a failed call) is tried again once its key is present.
  private reopen(rows: Layer12Row[], keys: Keys) {
    const have: Record<Stage, boolean> = { mangools: !!keys.mangools, serpapi: !!keys.serp, geekflare: !!keys.geek };
    for (const r of rows) {
      r.stages = r.stages || {};
      for (const s of STAGES) if (r.stages[s] === 'bypassed' && have[s]) r.stages[s] = 'pending';
    }
  }

  private setStage(r: Layer12Row, stage: Stage, value: string, err?: string) {
    r.stages = { ...(r.stages || {}), [stage]: value };
    r.errors = { ...(r.errors || {}), [stage]: err || '' };
  }

  private async mangoolsStage(project: Project, customer: Customer, rows: Layer12Row[], keys: Keys, st: Layer12State, warn: string[]): Promise<boolean> {
    const todo = rows.filter((r) => r.stages?.mangools === 'pending');
    if (!todo.length) return true;
    if (!keys.mangools) {
      todo.forEach((r) => this.setStage(r, 'mangools', 'bypassed', 'No Mangools key is saved for this customer.'));
      warn.push('Mangools skipped: no Mangools key is saved for this customer.');
      return false;
    }
    let loc = keys.locationId || st.locationId || 0;
    if (!loc) {
      const query = locationQuery((customer.profile || {}) as Record<string, any>);
      try {
        loc = await resolveMangoolsLocation(keys.mangools, query);
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
      const map = mangoolsRows(await mangoolsPost(keys.mangools, 'kwfinder/keyword-imports', { keywords: todo.map((r) => r.keyword).slice(0, 700), location_id: loc, language_id: keys.languageId }));
      let hits = 0;
      for (const r of todo) {
        const m = map.get(r.keyNorm);
        if (m) hits++;
        r.searchVolume = m ? num(m.sv) : null;
        r.kd = m ? num(m.seo) : null;
        r.cpc = m ? num(m.cpc) : null;
        r.ppc = m ? num(m.ppc) : null;
        this.setStage(r, 'mangools', 'completed', m ? '' : 'Mangools returned no exact row for this keyword; its Mangools KPIs stay unavailable.');
      }
      if (!hits) warn.push('Mangools answered but none of the returned keywords matched the master keywords.');
      return hits > 0;
    } catch (e) {
      todo.forEach((r) => this.setStage(r, 'mangools', 'bypassed', errMsg(e)));
      warn.push('Mangools validation failed: ' + errMsg(e));
      return false;
    }
  }

  private async serpJson(key: string, q: string): Promise<any> {
    const p = new URLSearchParams({ engine: 'google', q, gl: (process.env.SERP_GL || 'in').toLowerCase(), hl: 'en', num: '10', api_key: key });
    const res = await fetch(`https://serpapi.com/search.json?${p}`, { signal: AbortSignal.timeout(45000) });
    const text = await res.text();
    let b: any = {};
    try { b = JSON.parse(text); } catch { /* keep {} */ }
    if (!res.ok || b?.error) {
      const m = b?.error?.message || b?.error || b?.message || text.slice(0, 160) || `HTTP ${res.status}`;
      throw new Error(typeof m === 'string' ? m : JSON.stringify(m));
    }
    return b;
  }

  private async serpStage(project: Project, customer: Customer, rows: Layer12Row[], keys: Keys, warn: string[]): Promise<boolean> {
    const todo = rows.filter((r) => r.stages?.serpapi === 'pending');
    if (!todo.length) return true;
    const hosts = competitorHosts((customer.profile || {}) as Record<string, any>);
    if (!hosts.length) {
      todo.forEach((r) => { this.setStage(r, 'serpapi', 'bypassed', 'The customer profile has no usable competitor website.'); this.setStage(r, 'geekflare', 'bypassed', 'No competitor page without competitor sites.'); });
      warn.push('SerpApi skipped: the customer profile has no usable competitor website (nothing to compare).');
      return true;
    }
    if (!keys.serp) {
      todo.forEach((r) => this.setStage(r, 'serpapi', 'bypassed', 'No SerpApi key (customer or Global Google AI).'));
      warn.push('SerpApi skipped: no SerpApi key (customer or Global Google AI).');
      return false;
    }
    let ok = true;
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      try {
        await this.pace();
        const m = matchCompetitors((await this.serpJson(keys.serp, r.keyword))?.organic_results || [], hosts);
        r.competitorCount = m.count;
        r.bestCompetitorPosition = m.best;
        r.avgCompetitorPosition = m.avg;
        r.competitorDomains = m.domains;
        r.competitorUrl = m.bestUrl ? m.bestUrl.slice(0, 700) : null;
        this.setStage(r, 'serpapi', 'completed');
      } catch (e) {
        ok = false;
        this.setStage(r, 'serpapi', 'bypassed', errMsg(e));
        if (FATAL.test(errMsg(e))) {
          todo.slice(i + 1).forEach((x) => this.setStage(x, 'serpapi', 'bypassed', 'Skipped after a SerpApi account error.'));
          warn.push('SerpApi stopped: ' + errMsg(e));
          return false;
        }
      }
      this.apply(r);
      if (i % 10 === 9) await this.rr.save(rows);
    }
    if (!ok) warn.push('SerpApi failed for some keywords; they are retried on the next run.');
    return ok;
  }

  // Geekflare is optional evidence: the best competitor page of the L12_PAGE_MAX best-rated keywords that have one.
  private async geekStage(rows: Layer12Row[], keys: Keys, warn: string[]) {
    const todo = rows.filter((r) => r.stages?.geekflare === 'pending');
    if (!todo.length) return;
    const withUrl = todo.filter((r) => r.stages?.serpapi === 'completed' && r.competitorUrl).sort((a, b) => b.baseWeightage - a.baseWeightage || a.rank - b.rank);
    const chosen = new Set(withUrl.slice(0, L12_PAGE_MAX).map((r) => r.id));
    for (const r of todo) {
      if (chosen.has(r.id)) continue;
      this.setStage(r, 'geekflare', 'bypassed', r.stages?.serpapi === 'completed' && r.competitorUrl ? `Geekflare covers the ${L12_PAGE_MAX} best keywords only.` : 'No competitor ranking URL for this keyword.');
    }
    if (!chosen.size) return;
    if (!keys.geek) {
      withUrl.slice(0, L12_PAGE_MAX).forEach((r) => this.setStage(r, 'geekflare', 'bypassed', 'No Geekflare key is saved for this customer.'));
      warn.push('Geekflare competitor-page facts skipped: no Geekflare key is saved for this customer (optional).');
      return;
    }
    for (const r of withUrl.slice(0, L12_PAGE_MAX)) {
      try {
        await this.pace(1000);
        const res = await fetch('https://api.geekflare.com/webscraping', { method: 'POST', headers: { 'x-api-key': keys.geek, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ url: r.competitorUrl, format: ['json'] }), signal: AbortSignal.timeout(60000) });
        const text = await res.text();
        let b: any = {};
        try { b = JSON.parse(text); } catch { /* keep {} */ }
        if (!res.ok) throw new Error(String(b?.message || b?.error || `HTTP ${res.status}`).slice(0, 160));
        const facts = geekflareFacts(b, r.competitorUrl as string);
        r.page = Object.keys(facts).length ? facts : null;
        this.setStage(r, 'geekflare', r.page ? 'completed' : 'bypassed', r.page ? '' : 'Geekflare returned no readable page content.');
      } catch (e) {
        this.setStage(r, 'geekflare', 'bypassed', errMsg(e));
        if (FATAL.test(errMsg(e))) {
          warn.push('Geekflare stopped: ' + errMsg(e));
          break;
        }
      }
      this.apply(r);
    }
  }

  private async rerank(rows: Layer12Row[]) {
    rows.sort((a, b) => b.weightage - a.weightage || (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || a.keyword.localeCompare(b.keyword));
    rows.forEach((r, i) => { r.rank = i + 1; });
    for (let i = 0; i < rows.length; i += 100) await this.rr.save(rows.slice(i, i + 100));
  }

  // Layer 12 row of the schedule: done only when the required stages finished.
  async syncLayerStatus(project: Project) {
    const [n, st] = await Promise.all([this.rr.count({ where: { projectId: project.id } }), this.sr.findOne({ where: { projectId: project.id } })]);
    if (n > 0 && st?.status === 'complete') await this.layers.setByMonth(project.customerId, project.monthIndex, 12, 'done');
    else if (n > 0) await this.layers.markInProgress(project.customerId, project.monthIndex, 12);
    else await this.layers.setByMonth(project.customerId, project.monthIndex, 12, 'pending');
  }

  async execute(project: Project, customer: Customer, force = false) {
    const lock = project.id;
    if (this.running.has(lock)) return;
    this.running.add(lock);
    const st = await this.state(project);
    const warn: string[] = [];
    try {
      const keys = await this.keys(project.customerId);
      const rows = await this.prepare(project, force);
      if (!rows.length) {
        st.status = 'failed';
        st.message = 'No 11-AAA keywords: complete Layer 4 and Layer 11 first.';
        st.warnings = [];
      } else {
        this.reopen(rows, keys);
        const mOk = await this.mangoolsStage(project, customer, rows, keys, st, warn);
        rows.forEach((r) => this.apply(r));
        await this.rr.save(rows);
        const sOk = await this.serpStage(project, customer, rows, keys, warn);
        await this.geekStage(rows, keys, warn);
        rows.forEach((r) => this.apply(r));
        await this.rerank(rows);
        st.warnings = warn;
        st.status = mOk && sOk ? 'complete' : 'partial';
        st.message = `${rows.length} keyword(s) validated.` + (st.status === 'partial' ? ' Some steps were skipped - see warnings.' : '');
      }
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

  // Admin "Run Layer 12 now": starts in the background; the page polls view().
  async startRun(customerId: string, month: string, force = false) {
    const project = await this.monthOf(customerId, month);
    const customer = await this.customerOf(customerId);
    const st = await this.state(project);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException('Layer 12 is already running.');
    st.status = 'running';
    st.message = 'Validating keywords...';
    st.lastRunAt = new Date();
    await this.sr.save(st);
    void this.execute(project, customer, force).catch((err) => this.log.error(`Layer 12: ${errMsg(err)}`));
    return this.view(customerId, month);
  }

  // Automation: the set date (Day 12). Months already complete or already attempted today are skipped; paid API calls only on the set date.
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
    return `${runs} customer month(s) validated`;
  }

  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, st, keys, masterRows] = await Promise.all([this.rr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.sr.findOne({ where: { projectId: project.id } }), this.keys(customerId), this.master.rows(project.id)]);
    let status = st?.status || 'idle';
    if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
    const stage = (s: Stage) => ({ completed: rows.filter((r) => r.stages?.[s] === 'completed').length, pending: rows.filter((r) => r.stages?.[s] === 'pending').length, bypassed: rows.filter((r) => r.stages?.[s] === 'bypassed').length });
    return {
      month: project.monthCode,
      total: rows.length,
      complete: rows.length > 0 && status === 'complete',
      status,
      message: st?.message || '',
      warnings: st?.warnings || [],
      lastRunAt: st?.lastRunAt ?? null,
      keys: { mangools: !!keys.mangools, serpapi: !!keys.serp, geekflare: !!keys.geek },
      masterKeywords: masterRows.length,
      stages: { mangools: stage('mangools'), serpapi: stage('serpapi'), geekflare: stage('geekflare') },
      records: rows.map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, demand: r.demand, searchVolume: r.searchVolume, kd: r.kd, cpc: r.cpc, competitorCount: r.competitorCount, bestPosition: r.bestCompetitorPosition, competitorStrength: r.competitorStrength, competitorDomains: r.competitorDomains || [], competitorUrl: r.competitorUrl, pageStrength: r.page?.page_strength_score ?? null, weightage: r.weightage, star: r.starRating, stages: r.stages || {}, errors: r.errors || {} })),
    };
  }

  async customerTable(customerId: string, month?: string) {
    let project: Project | null = null;
    if (month) project = await this.monthOf(customerId, month);
    else {
      const today = todayInTz();
      const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0] || null;
    }
    if (!project) return { layer: 12, complete: false, month: null, total: 0, expected: 0, html: '', platforms: [] };
    const [rows, st] = await Promise.all([this.rr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.sr.findOne({ where: { projectId: project.id } })]);
    const complete = rows.length > 0 && st?.status === 'complete';
    return { layer: 12, complete, month: project.monthCode, total: rows.length, expected: 0, html: complete ? renderL12Html(rows) : '', platforms: [] };
  }

  async removeByCustomer(customerId: string) {
    await this.rr.delete({ customerId });
    await this.sr.delete({ customerId });
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));

export function renderL12Html(rows: Layer12Row[]): string {
  const head = ['Final Rating', 'Keyword', 'Intent', 'Search Volume', 'KD', 'CPC', 'Competitors Found', 'Best Competitor Position', 'Competitor Strength', 'Competitor Page', 'Weightage', 'Star Rating'];
  const page = (r: Layer12Row) => (r.page ? [r.page.title, r.page.word_count ? r.page.word_count + ' words' : null, r.page.page_strength_score !== null && r.page.page_strength_score !== undefined ? 'strength ' + r.page.page_strength_score : null].filter(Boolean).join(' · ') : null);
  const body = rows.map((r) => '<tr>' + [r.rank, r.keyword, r.intent, fmt(r.searchVolume), r.kd, r.cpc, r.competitorCount === null ? null : r.competitorCount + (r.competitorDomains?.length ? ' (' + r.competitorDomains.join(', ') + ')' : ''), r.bestCompetitorPosition, r.competitorStrength, page(r), r.weightage, stars(r.starRating)].map((c) => `<td>${dash(c)}</td>`).join('') + '</tr>').join('');
  return `<table class="kp21-l11 kp21-l12"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
