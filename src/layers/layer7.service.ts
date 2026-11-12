import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { CustomerApisService } from '../customer-apis/customer-apis.service';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { todayInTz } from '../projects/month-cycle';
import { AI_PLATFORMS } from './ai-platforms';
import { LayersService } from './layers.service';
import { Layer4Keyword } from './layer4.entities';
import { Layer7Question, Layer7State } from './layer7.entities';

export const L7_MAX = 30;
export const L7_MAX_QUERIES = 12;
export const L7_SOURCE = 'Google People Also Ask';
const STALE_RUN_MS = 10 * 60 * 1000;
const TIMEOUT = 45000;
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const cleanUrl = (u: unknown): string => {
  const s = typeof u === 'string' ? u.trim() : '';
  return /^https?:\/\//i.test(s) ? s.slice(0, 1000) : '';
};

export interface PaaRow { question: string; searchQuery: string; sourceUrl: string; provider: string }

// Port of the plugin's KP21_Layers::layer7_extract_paa. SerpApi: related_questions. Scrape.do: the same plus
// people_also_ask / peopleAlsoAsk / paa. Exact questions only, de-duplicated, never rewritten or invented.
export function parsePaa(json: any, provider: 'serpapi' | 'scrapedo', query: string): PaaRow[] {
  const out: PaaRow[] = [];
  const seen = new Set<string>();
  const add = (question: unknown, link: unknown) => {
    const q = stripTags(String(question ?? '')).slice(0, 600);
    const n = norm(q);
    if (!q || !n || seen.has(n)) return;
    seen.add(n);
    out.push({ question: q, searchQuery: query.slice(0, 300), sourceUrl: cleanUrl(link), provider });
  };
  const keys = provider === 'serpapi' ? ['related_questions'] : ['related_questions', 'people_also_ask', 'peopleAlsoAsk', 'paa'];
  for (const k of keys) {
    const arr = json && Array.isArray(json[k]) ? json[k] : [];
    for (const x of arr) {
      if (typeof x === 'string') add(x, '');
      else if (x && typeof x === 'object') add(x.question ?? x.title ?? x.text ?? '', x.link ?? x.url ?? '');
    }
  }
  return out;
}

// Search queries for the month (port of layer7_search_queries): the month's Layer 4 keywords (best-ranked first),
// then each product / service with the location, then the industry. At most 12.
export function layer7Queries(c: Customer, l4: string[]): string[] {
  const p = (c.profile || {}) as Record<string, any>;
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    const t = q.trim();
    const n = norm(t);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(t);
  };
  l4.slice(0, 40).forEach(add);
  const loc = list(p.locations)[0] || list(p.areas_served)[0] || str(p.service_area);
  list(p.products_services).forEach((x) => add(x + (loc ? ' ' + loc : '')));
  if (!out.length && str(p.industry)) add(str(p.industry) + (loc ? ' ' + loc : ''));
  return out.slice(0, L7_MAX_QUERIES);
}

// Manual lines: question | search query (query optional).
export function parseManualLines(text: string): Array<{ question: string; searchQuery: string }> {
  const out: Array<{ question: string; searchQuery: string }> = [];
  const seen = new Set<string>();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const parts = raw.split('|').map((x) => x.trim());
    const q = (parts[0] || '').replace(/^\d+[.)]\s*/, '').slice(0, 600);
    const n = norm(q);
    if (!q || !n || /^question$/i.test(q) || seen.has(n)) continue;
    seen.add(n);
    out.push({ question: q, searchQuery: (parts[1] || 'manual entry').slice(0, 300) });
    if (out.length >= L7_MAX) break;
  }
  return out;
}

interface Sources { serpKey: string | null; serpFrom: string; scrapeKey: string | null }

@Injectable()
export class Layer7Service {
  private readonly log = new Logger('Layer7');
  private lastCall = 0;

  constructor(
    @InjectRepository(Layer7Question) private readonly qr: Repository<Layer7Question>,
    @InjectRepository(Layer7State) private readonly sr: Repository<Layer7State>,
    @InjectRepository(Layer4Keyword) private readonly l4: Repository<Layer4Keyword>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly customerApis: CustomerApisService,
    private readonly globalApis: GlobalApisService,
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

  // SerpApi (the customer's own key, else the Global Google AI SerpApi key) is the primary; the customer's Scrape.do is the fallback.
  private async sources(customerId: string): Promise<Sources> {
    const own = await this.customerApis.getKeys(customerId);
    const glob = await this.globalApis.getKeys();
    const ownSerp = own['serpapi']?.apiKey || '';
    const globSerp = glob['google_ai']?.apiKey || '';
    return {
      serpKey: ownSerp || globSerp || null,
      serpFrom: ownSerp ? "customer's SerpApi" : globSerp ? 'global SerpApi' : '',
      scrapeKey: own['scrapedo']?.apiKey || null,
    };
  }

  private async state(project: Project): Promise<Layer7State> {
    const existing = await this.sr.findOne({ where: { projectId: project.id } });
    if (existing) return existing;
    return this.sr.create({ customerId: project.customerId, projectId: project.id, status: 'idle', message: null, lastRunAt: null });
  }

  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, st, src] = await Promise.all([
      this.qr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }),
      this.sr.findOne({ where: { projectId: project.id } }),
      this.sources(customerId),
    ]);
    let status = st?.status || 'idle';
    if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
    if (status === 'idle' && rows.length) status = 'complete';
    return {
      month: project.monthCode,
      max: L7_MAX,
      total: rows.length,
      complete: rows.length > 0 && status === 'complete',
      status,
      message: st?.message || '',
      lastRunAt: st?.lastRunAt ?? null,
      keyReady: !!src.serpKey,
      keySource: src.serpKey ? src.serpFrom + (src.scrapeKey ? ' + Scrape.do fallback' : '') : src.scrapeKey ? 'Scrape.do only' : 'none',
      records: rows.map((r) => ({ rank: r.rank, question: r.question, searchQuery: r.searchQuery, source: r.source, sourceUrl: r.sourceUrl, retrievedAt: r.retrievedAt, provider: r.provider })),
    };
  }

  // Keeps the Layer 7 row in the Layer schedule in step: done once verified questions are stored.
  async syncLayerStatus(project: Project) {
    const n = await this.qr.count({ where: { projectId: project.id } });
    await this.layers.setByMonth(project.customerId, project.monthIndex, 7, n > 0 ? 'done' : 'pending');
    return n > 0;
  }

  private async pace(ms = 1500) {
    const wait = this.lastCall + ms - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
  }

  private async getJson(url: string): Promise<any> {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    const text = await res.text();
    let b: any = {};
    try { b = JSON.parse(text); } catch { /* keep {} */ }
    if (!res.ok || b?.error) {
      const msg = b?.error?.message || b?.error || b?.message || text.slice(0, 160) || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return b;
  }

  private gl(): string { return (process.env.SERP_GL || 'in').toLowerCase(); }

  // One Google search: SerpApi first; Scrape.do when SerpApi fails or returns no PAA. Never throws.
  private async searchPaa(query: string, src: Sources): Promise<{ rows: PaaRow[]; error: string }> {
    let error = '';
    if (src.serpKey) {
      try {
        await this.pace();
        const q = new URLSearchParams({ engine: 'google', q: query, gl: this.gl(), hl: 'en', api_key: src.serpKey });
        const rows = parsePaa(await this.getJson(`https://serpapi.com/search.json?${q}`), 'serpapi', query);
        if (rows.length || !src.scrapeKey) return { rows, error };
      } catch (err) {
        error = 'SerpApi: ' + (err instanceof Error ? err.message : String(err));
      }
    }
    if (src.scrapeKey) {
      try {
        await this.pace();
        const q = new URLSearchParams({ token: src.scrapeKey, q: query, gl: this.gl(), hl: 'en', device: 'desktop' });
        const rows = parsePaa(await this.getJson(`https://api.scrape.do/plugin/google/search?${q}`), 'scrapedo', query);
        return { rows, error: rows.length ? '' : error };
      } catch (err) {
        error = (error ? error + ' | ' : '') + 'Scrape.do: ' + (err instanceof Error ? err.message : String(err));
      }
    }
    return { rows: [], error };
  }

  private async queriesFor(project: Project, customer: Customer): Promise<string[]> {
    const rows = await this.l4.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    const order = AI_PLATFORMS.map((p) => p.key);
    rows.sort((a, b) => a.rank - b.rank || order.indexOf(a.platform) - order.indexOf(b.platform));
    return layer7Queries(customer, rows.map((r) => r.keyword));
  }

  private async replaceRows(project: Project, rows: PaaRow[]) {
    await this.qr.delete({ projectId: project.id });
    if (!rows.length) return;
    const now = new Date();
    await this.qr.save(rows.slice(0, L7_MAX).map((r, i) => this.qr.create({
      customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, rank: i + 1,
      question: r.question, searchQuery: r.searchQuery, source: L7_SOURCE, sourceUrl: r.sourceUrl || null, retrievedAt: now, provider: r.provider,
    })));
  }

  async execute(project: Project, customer: Customer, src: Sources) {
    const st = await this.state(project);
    try {
      const queries = await this.queriesFor(project, customer);
      if (!queries.length) throw new Error('Could not build a Google search query: add products / services or an industry to the customer profile (or run Layer 4 first).');
      const all: PaaRow[] = [];
      const seen = new Set<string>();
      const errors: string[] = [];
      let used = 0;
      for (const q of queries) {
        if (all.length >= L7_MAX) break;
        used++;
        const r = await this.searchPaa(q, src);
        if (r.error) errors.push(r.error);
        for (const row of r.rows) {
          const n = norm(row.question);
          if (seen.has(n)) continue;
          seen.add(n);
          all.push(row);
          if (all.length >= L7_MAX) break;
        }
      }
      if (all.length) {
        await this.replaceRows(project, all);
        st.status = 'complete';
        st.message = `${all.length}/${L7_MAX} verified Google People Also Ask questions from ${used} search quer${used === 1 ? 'y' : 'ies'}. Fewer than ${L7_MAX} is allowed.`;
      } else {
        st.status = 'failed';
        st.message = ('No valid People Also Ask returned for ' + used + ' search quer' + (used === 1 ? 'y' : 'ies') + '. ' + [...new Set(errors)].join(' | ')).trim().slice(0, 380) + ' Existing questions were kept.';
      }
    } catch (err) {
      st.status = 'failed';
      st.message = (err instanceof Error ? err.message : 'Run failed').slice(0, 380);
    }
    st.lastRunAt = new Date();
    await this.sr.save(st);
    await this.syncLayerStatus(project);
  }

  // Starts a run in the background (several Google searches); the page polls view().
  async startRun(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const customer = await this.customerOf(customerId);
    const src = await this.sources(customerId);
    if (!src.serpKey && !src.scrapeKey) throw new BadRequestException("No SerpApi key: add the customer's SerpApi key (Customer APIs) or the Global Google AI SerpApi key, or a Scrape.do token.");
    const st = await this.state(project);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException('Layer 7 is already running.');
    st.status = 'running';
    st.message = 'Searching Google...';
    st.lastRunAt = new Date();
    await this.sr.save(st);
    void this.execute(project, customer, src).catch((err) => this.log.error(`Layer 7: ${err?.message || err}`));
    return this.view(customerId, month);
  }

  async saveManual(customerId: string, month: string, text: string) {
    const rows = parseManualLines(text);
    if (!rows.length) throw new BadRequestException('Add at least one question, one per line: question | search query.');
    const project = await this.monthOf(customerId, month);
    await this.replaceRows(project, rows.map((r) => ({ question: r.question, searchQuery: r.searchQuery, sourceUrl: '', provider: 'manual' })));
    const st = await this.state(project);
    st.status = 'complete';
    st.message = `${rows.length}/${L7_MAX} questions saved manually.`;
    st.lastRunAt = new Date();
    await this.sr.save(st);
    await this.syncLayerStatus(project);
    return this.view(customerId, month);
  }

  // ---- Automation: the set date (Day 7 of the Month Cycle) ------------------------------------------
  // One customer month at a time. Skips months that already hold questions and months already attempted today.
  async runDay(monthRows: Array<{ customerId: string; monthIndex: number }>, force = false): Promise<string> {
    const today = dateInTz(new Date());
    let runs = 0;
    for (const m of monthRows) {
      const project = await this.projects.findOne({ where: { customerId: m.customerId, monthIndex: m.monthIndex } });
      const customer = await this.customers.findOne({ where: { id: m.customerId } });
      if (!project || !customer) continue;
      const st = await this.state(project);
      if (!force && st.lastRunAt && dateInTz(st.lastRunAt) === today && st.status !== 'idle') continue;
      if (!force && (await this.qr.count({ where: { projectId: project.id } })) > 0) continue;
      const src = await this.sources(m.customerId);
      if (!src.serpKey && !src.scrapeKey) {
        st.status = 'failed'; st.message = 'No SerpApi key (customer or Global Google AI) and no Scrape.do token.'; st.lastRunAt = new Date();
        await this.sr.save(st);
        continue;
      }
      st.status = 'running'; st.message = 'Scheduled run...'; st.lastRunAt = new Date();
      await this.sr.save(st);
      await this.execute(project, customer, src);
      runs++;
    }
    return `${runs} customer month(s) searched`;
  }

  // ---- Customer panel: the table once questions are stored ------------------------------------------
  async customerTable(customerId: string, month?: string) {
    let project: Project | null = null;
    if (month) project = await this.monthOf(customerId, month);
    else {
      const today = todayInTz();
      const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0] || null;
    }
    if (!project) return { layer: 7, complete: false, month: null, total: 0, max: L7_MAX, html: '', records: [] };
    const rows = await this.qr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    const st = await this.sr.findOne({ where: { projectId: project.id } });
    const complete = rows.length > 0 && (!st || st.status === 'complete' || st.status === 'idle');
    if (!complete) return { layer: 7, complete: false, month: project.monthCode, total: rows.length, max: L7_MAX, html: '', records: [] };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const records = rows.map((r) => ({ rank: r.rank, question: r.question, searchQuery: r.searchQuery, source: r.source, sourceUrl: r.sourceUrl || '', retrievedAt: r.retrievedAt }));
    const body = records
      .map((r) => `<tr><td>${r.rank}</td><td>${esc(r.question)}</td><td>${esc(r.searchQuery)}</td><td>${esc(r.source)}</td><td>${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.sourceUrl)}</a>` : '-'}</td></tr>`)
      .join('');
    const html = `<table class="kp21-l7"><thead><tr><th>#</th><th>People Also Ask question</th><th>Google search query</th><th>Source</th><th>Source URL</th></tr></thead><tbody>${body}</tbody></table>`;
    return { layer: 7, complete: true, month: project.monthCode, total: rows.length, max: L7_MAX, html, records };
  }

  async removeByCustomer(customerId: string) {
    await this.qr.delete({ customerId });
    await this.sr.delete({ customerId });
  }
}
