import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { todayInTz } from '../projects/month-cycle';
import { AI_PLATFORMS, AI_PLATFORM_KEYS, askGoogleAi, askPlatform } from './ai-platforms';
import { LayersService } from './layers.service';
import { Layer10Platform, Layer10Quora } from './layer10.entities';

export const L10_INTENTS = ['Informational', 'Commercial', 'Transactional', 'Navigational', 'Comparison', 'Local'];
export const L10_PER_PLATFORM = 10;
const STALE_RUN_MS = 10 * 60 * 1000;
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (value: string, allowed: string[]): string | null => allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase()) ?? null;

export interface QuoraRow { question: string; topic: string; primaryKeyword: string; searchIntent: string; relevance: string; quoraUrl: string }

// A real Quora page URL: https, host quora.com or *.quora.com, and a path (not just the home page).
export function validQuoraUrl(u: string): string | null {
  try {
    const url = new URL(u.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(host === 'quora.com' || host.endsWith('.quora.com'))) return null;
    if (url.pathname.replace(/\//g, '') === '') return null;
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
}
const urlKey = (u: string): string => u.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '').replace('://www.', '://');

const tokens = (s: string): Set<string> => new Set(norm(s).split(' ').filter(Boolean));
function similar(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return false;
  let inter = 0;
  x.forEach((t) => { if (y.has(t)) inter++; });
  return inter / (x.size + y.size - inter) >= 0.8;
}

// Search query for the Quora search: the main service in the main location, restricted to quora.com.
export function quoraQuery(c: Customer): string {
  const p = (c.profile || {}) as Record<string, any>;
  const what = list(p.products_services)[0] || list(p.seed_keywords)[0] || str(p.industry) || c.companyName || '';
  const where = list(p.locations)[0] || list(p.areas_served)[0] || '';
  return ['site:quora.com', what, where].filter(Boolean).join(' ').slice(0, 150);
}

const RETRIEVAL_METHOD =
  'Retrieve/search Quora pages only. Accept only evidence attributable to https://www.quora.com/ or a quora.com subdomain. The execution platform may discover or normalize the evidence, but Quora must remain the source. If the execution platform cannot retrieve verifiable Quora evidence, return an empty array [] rather than generating Quora-like questions.';

// Port of the plugin's Layer 10 Master Prompt (KP21_Layers::layer10_prompt, v8.9.280), with the retrieval method, the platform
// search rule and the output instruction filled in. For Google AI, the real Quora results of a site:quora.com Google search are passed in.
export function layer10Prompt(c: Customer, platformKey: string, retrieved: Array<{ title: string; link: string }> = []): string {
  const p = (c.profile || {}) as Record<string, any>;
  const def = AI_PLATFORMS.find((x) => x.key === platformKey);
  const search = platformKey === 'google_ai'
    ? 'Search using Google AI Mode / live Google results for this Layer only.'
    : `Search on your ${def?.label || platformKey} platform only. Do not use another AI platform or external search engine.`;
  const line = (label: string, v: string) => `${label}: ${v}\n`;
  return (
    "LAYER 10 - QUORA SEARCH\n\nOBJECTIVE\n\nFind real, relevant questions and discussion topics that users are asking on Quora about the customer's business, products, services, problems, needs, alternatives, comparisons and buying decisions.\n\n" +
    'SOURCE RULE\n\nSearch Quora only.\nDo not use Google People Also Ask, Reddit, other forums, general web pages or AI-platform memory as the research source.\nThe AI/API platform is only the execution method. It is NOT the research source.\nNever invent a Quora question, URL, source or discussion.\n\n' +
    `QUORA RETRIEVAL METHOD\n\n${RETRIEVAL_METHOD}\n\nBUSINESS INPUTS\n\n` +
    line('Business Name', str(p.brand_name) || c.companyName || '') +
    line('Primary Business Category', str(p.primary_business_category)) +
    line('Secondary Business Categories', list(p.secondary_business_categories).join(', ')) +
    line('Industry', str(p.industry)) +
    line('Sector', str(p.sector)) +
    line('Product / Service', list(p.products_services).join('\n')) +
    line('Product / Service Description', str(p.product_description) || str(p.product_service_description) || str(p.product_short_description) || str(p.company_profile)) +
    line('Target Customer Segments', list(p.target_customer_segments ?? p.target_customer_segment).join(', ')) +
    line('Areas Served', list(p.areas_served).join(', ') || str(p.service_area)) +
    line('Target Location', list(p.locations).join(', ')) +
    line('Target Page', str(p.target_page)) +
    `\nPLATFORM SEARCH INSTRUCTION\n\n${search}\n\n` +
    (retrieved.length ? `VERIFIED QUORA SEARCH RESULTS (Google, ${quoraQuery(c)}) - use ONLY these pages; do not add any other URL\n${JSON.stringify(retrieved)}\n\n` : '') +
    'TASK\n\nFind up to 10 unique, verified Quora questions/discussion titles directly relevant to the supplied Business Inputs. Prioritize service/product demand, user pain points, buying/selection intent, recommendations, comparisons, alternatives, cost/pricing, how-to questions and location-specific requirements.\n\n' +
    'Do not invent Quora questions. A record is valid only when it is attributable to a Quora page or Quora result and has a valid quora.com URL. Remove duplicate and near-duplicate questions. If fewer than 10 verified Quora records are available, return only those verified records. Never fabricate missing records to reach 10.\n\n' +
    'FIELD RULES\n\nrank: integer 1-10.\nquora_question: actual Quora question or discussion title found; do not rewrite it merely for SEO.\ntopic: concise classification of the discussion subject.\nprimary_keyword: most relevant keyword associated with the question.\n' +
    `search_intent: exactly one of ${L10_INTENTS.join(', ')}.\n` +
    "relevance: brief explanation of why the Quora question is relevant to the customer's product/service and target audience.\nquora_url: direct HTTPS Quora URL from quora.com. Never fabricate it.\nsource: exactly Quora.\n\n" +
    'VALIDATION\n\nReject a record when it is not sourced from Quora, the question/title is blank, the URL is absent or not on quora.com, the record is invented, it duplicates/near-duplicates another accepted record, it is unrelated to the Business Inputs, or a required field is missing.\n\n' +
    'OUTPUT INSTRUCTION\n\nReturn ONLY a valid JSON array containing exactly these keys for each record: rank, quora_question, topic, primary_keyword, search_intent, relevance, quora_url, source. Return [] if no verified Quora record exists. No markdown or commentary.'
  );
}

// Reads the JSON array out of a model reply and keeps only valid rows (port of layer10_validate_rows: rank 1-10 once, every
// field present, allowed Search Intent, https quora.com URL, source Quora, no duplicate / near-duplicate), max 10.
// `allowed` (Google AI): when given, the URL must be one of the retrieved Quora results.
export function parseLayer10Reply(text: string, allowed: string[] = []): QuoraRow[] {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return [];
  let arr: any;
  try { arr = JSON.parse(text.slice(s, e + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const allow = new Set(allowed.map(urlKey));
  const rows = arr
    .map((x: any, i: number) => ({
      rank: Number(x?.rank) || i + 1,
      q: str(x?.quora_question ?? x?.question_title ?? x?.question),
      topic: str(x?.topic),
      kw: str(x?.primary_keyword),
      intent: pick(str(x?.search_intent ?? x?.primary_intent), L10_INTENTS),
      rev: str(x?.relevance),
      url: validQuoraUrl(str(x?.quora_url)),
      src: str(x?.source) || 'Quora',
    }))
    .filter((x) => x.q && x.topic && x.kw && x.rev && x.intent && x.url && x.src.toLowerCase() === 'quora' && x.rank >= 1 && x.rank <= 10 && (!allow.size || allow.has(urlKey(x.url as string))))
    .sort((a, b) => a.rank - b.rank);
  const seenRank = new Set<number>();
  const seenUrl = new Set<string>();
  const out: QuoraRow[] = [];
  for (const r of rows) {
    const uk = urlKey(r.url as string);
    if (seenRank.has(r.rank) || seenUrl.has(uk) || out.some((o) => similar(o.question, r.q))) continue;
    seenRank.add(r.rank);
    seenUrl.add(uk);
    out.push({ question: r.q.slice(0, 600), topic: r.topic.slice(0, 200), primaryKeyword: r.kw.slice(0, 255), searchIntent: r.intent as string, relevance: r.rev.slice(0, 500), quoraUrl: r.url as string });
    if (out.length >= L10_PER_PLATFORM) break;
  }
  return out;
}

// Manual entry: one per line, "question | topic | primary keyword | search intent | relevance | quora url". The quora.com URL is required.
export function parseManualLines(text: string): QuoraRow[] {
  const seenUrl = new Set<string>();
  const out: QuoraRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/\t|\|/).map((x) => x.trim());
    const url = validQuoraUrl(parts[5] || '');
    if (!parts[0] || !url || seenUrl.has(urlKey(url))) continue;
    seenUrl.add(urlKey(url));
    out.push({ question: parts[0].slice(0, 600), topic: (parts[1] || 'General').slice(0, 200), primaryKeyword: (parts[2] || parts[0]).slice(0, 255), searchIntent: pick(parts[3] || '', L10_INTENTS) || 'Informational', relevance: (parts[4] || 'Added manually').slice(0, 500), quoraUrl: url });
    if (out.length >= L10_PER_PLATFORM) break;
  }
  return out;
}

@Injectable()
export class Layer10Service {
  private readonly log = new Logger('Layer10');
  private readonly lastCall = new Map<string, number>();

  constructor(
    @InjectRepository(Layer10Quora) private readonly qr: Repository<Layer10Quora>,
    @InjectRepository(Layer10Platform) private readonly pf: Repository<Layer10Platform>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
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

  platform(key: string) {
    const p = AI_PLATFORMS.find((x) => x.key === key);
    if (!p) throw new BadRequestException(`Unknown platform. Use one of: ${AI_PLATFORM_KEYS.join(', ')}.`);
    return p;
  }

  private async customerOf(customerId: string): Promise<Customer> {
    const c = await this.customers.findOne({ where: { id: customerId } });
    if (!c) throw new NotFoundException('Customer not found.');
    return c;
  }

  // Layer 10 is "up to 10 verified", and platforms that cannot search Quora legitimately return none, so the layer is
  // done when every API platform has finished its run (Manual platforms do not block) and at least one record exists.
  private isDone(rows: Array<{ platform: string }>, states: Layer10Platform[]): boolean {
    if (!rows.length) return false;
    return AI_PLATFORMS.every((p) => {
      if (rows.some((r) => r.platform === p.key)) return true;
      const st = states.find((s) => s.platform === p.key);
      if ((st?.mode || p.defaultMode) === 'manual') return true;
      return !!st && !!st.lastRunAt && ['complete', 'partial', 'failed'].includes(st.status);
    });
  }

  // Everything the Layer 10 page shows: one block per platform with its Quora questions.
  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, states, globalKeys] = await Promise.all([
      this.qr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }),
      this.pf.find({ where: { projectId: project.id } }),
      this.globalApis.getKeys(),
    ]);
    const platforms = AI_PLATFORMS.map((p) => {
      const st = states.find((s) => s.platform === p.key);
      const records = rows.filter((r) => r.platform === p.key).map((r) => ({ rank: r.rank, question: r.question, topic: r.topic, primaryKeyword: r.primaryKeyword, searchIntent: r.searchIntent, relevance: r.relevance, quoraUrl: r.quoraUrl, source: r.source }));
      const mode = st?.mode || p.defaultMode;
      let status = st?.status || 'idle';
      if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
      if (status === 'idle' && records.length) status = records.length >= L10_PER_PLATFORM ? 'complete' : 'partial';
      const keyReady = p.globalKey ? !!globalKeys[p.keyProvider || p.key] : false;
      return { platform: p.key, label: p.label, mode, status, message: st?.message || '', count: records.length, expected: L10_PER_PLATFORM, keyReady, records };
    });
    return {
      month: project.monthCode,
      expected: AI_PLATFORMS.length * L10_PER_PLATFORM,
      total: platforms.reduce((a, p) => a + p.count, 0),
      completePlatforms: platforms.filter((p) => p.count >= L10_PER_PLATFORM).length,
      complete: this.isDone(rows, states),
      platforms,
    };
  }

  private async state(project: Project, platform: string): Promise<Layer10Platform> {
    const existing = await this.pf.findOne({ where: { projectId: project.id, platform } });
    if (existing) return existing;
    const mode = this.platform(platform).defaultMode;
    return this.pf.create({ customerId: project.customerId, projectId: project.id, platform, mode, status: 'idle', message: null, lastRunAt: null });
  }

  async setMode(customerId: string, month: string, platform: string, mode: string) {
    this.platform(platform);
    if (mode !== 'api' && mode !== 'manual') throw new BadRequestException('mode must be api or manual.');
    const project = await this.monthOf(customerId, month);
    const st = await this.state(project, platform);
    st.mode = mode;
    await this.pf.save(st);
    await this.syncLayerStatus(project);
    return this.view(customerId, month);
  }

  private async replaceRows(project: Project, platform: string, rows: QuoraRow[], source: string) {
    await this.qr.delete({ projectId: project.id, platform });
    if (rows.length) {
      await this.qr.save(rows.map((r, i) => this.qr.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, platform, rank: i + 1, question: r.question, topic: r.topic, primaryKeyword: r.primaryKeyword, searchIntent: r.searchIntent, relevance: r.relevance, quoraUrl: r.quoraUrl, source })));
    }
  }

  // Keeps the Layer 10 row in the Layer schedule in step: done when every API platform has finished and records exist.
  async syncLayerStatus(project: Project) {
    const [rows, states] = await Promise.all([this.qr.find({ where: { projectId: project.id }, select: ['platform'] }), this.pf.find({ where: { projectId: project.id } })]);
    const done = this.isDone(rows, states);
    const started = rows.length > 0 || states.some((s) => !!s.lastRunAt);
    await this.layers.setByMonth(project.customerId, project.monthIndex, 10, done ? 'done' : started ? 'in_progress' : 'pending');
    return done;
  }

  async saveManual(customerId: string, month: string, platform: string, text: string) {
    this.platform(platform);
    const rows = parseManualLines(String(text || ''));
    if (!rows.length) throw new BadRequestException('Add at least one question, one per line: question | topic | primary keyword | search intent | relevance | quora url (a https quora.com URL is required).');
    const project = await this.monthOf(customerId, month);
    await this.replaceRows(project, platform, rows, 'manual');
    const st = await this.state(project, platform);
    st.mode = 'manual';
    st.status = rows.length >= L10_PER_PLATFORM ? 'complete' : 'partial';
    st.message = `${rows.length}/${L10_PER_PLATFORM} Quora questions saved manually.`;
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
    return this.view(customerId, month);
  }

  // Bulk import of a whole month's table (all platforms at once). One row per line, tab or | separated:
  // Platform, Rank, Quora Question, Topic, Primary Keyword, Search Intent, Relevance, Quora URL. A header line is ignored.
  // Rows without a valid https quora.com URL are skipped. Replaces only the platforms present in the text.
  async importTable(customerId: string, month: string, text: string) {
    const alias: Record<string, string> = {
      chatgpt: 'openai', openai: 'openai', gemini: 'gemini', perplexity: 'perplexity', claude: 'anthropic', anthropic: 'anthropic',
      grok: 'xai', xai: 'xai', deepseek: 'deepseek', copilot: 'copilot', 'meta ai': 'meta', meta: 'meta', 'google ai': 'google_ai', google_ai: 'google_ai',
    };
    const groups = new Map<string, Array<{ rank: number; row: QuoraRow }>>();
    const skipped: string[] = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(line.includes('\t') ? '\t' : '|').map((x) => x.trim());
      const key = alias[(parts[0] || '').toLowerCase()];
      if (!key) { if (!/^platform$/i.test(parts[0] || '')) skipped.push(line.slice(0, 60)); continue; }
      const url = validQuoraUrl(parts[7] || '');
      if (!parts[2] || !url) { skipped.push(line.slice(0, 60)); continue; }
      const row: QuoraRow = { question: parts[2].slice(0, 600), topic: (parts[3] || 'General').slice(0, 200), primaryKeyword: (parts[4] || parts[2]).slice(0, 255), searchIntent: pick(parts[5] || '', L10_INTENTS) || 'Informational', relevance: (parts[6] || 'Imported').slice(0, 500), quoraUrl: url };
      groups.set(key, [...(groups.get(key) || []), { rank: Number(parts[1]) || (groups.get(key)?.length || 0) + 1, row }]);
    }
    if (!groups.size) throw new BadRequestException('No rows recognised. Use: Platform, Rank, Quora Question, Topic, Primary Keyword, Search Intent, Relevance, Quora URL (tab or | separated; a https quora.com URL is required).');
    const project = await this.monthOf(customerId, month);
    const summary: Record<string, number> = {};
    for (const [key, rowsOf] of groups) {
      const rows = rowsOf.sort((a, b) => a.rank - b.rank).map((x) => x.row).slice(0, L10_PER_PLATFORM);
      await this.replaceRows(project, key, rows, 'import');
      const st = await this.state(project, key);
      st.status = rows.length >= L10_PER_PLATFORM ? 'complete' : 'partial';
      st.message = rows.length + '/' + L10_PER_PLATFORM + ' Quora questions imported.';
      st.lastRunAt = new Date();
      await this.pf.save(st);
      summary[key] = rows.length;
    }
    const complete = await this.syncLayerStatus(project);
    return { imported: summary, skipped, complete, view: await this.view(customerId, month) };
  }

  private async keysFor(platform: string): Promise<Record<string, string>> {
    const def = this.platform(platform);
    const kp = def.keyProvider || platform;
    const vals = (await this.globalApis.getKeys())[kp];
    if (!vals) throw new BadRequestException(`${def.label} has no key yet. Add and enable ${kp === platform ? def.label : kp === 'openrouter' ? 'OpenRouter' : kp} in Global API Settings.`);
    return vals;
  }

  // Starts a run in the background (an AI call can take a minute); the page polls view().
  async startRun(customerId: string, month: string, platform: string) {
    const def = this.platform(platform);
    const project = await this.monthOf(customerId, month);
    const st = await this.state(project, platform);
    if ((st.mode || def.defaultMode) === 'manual') throw new BadRequestException(`${def.label} is set to Manual - paste its Quora questions instead, or switch it to API.`);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException(`${def.label} is already running.`);
    const customer = await this.customerOf(customerId);
    const vals = await this.keysFor(platform);
    st.status = 'running';
    st.message = 'Asking ' + def.label + '...';
    st.lastRunAt = new Date();
    await this.pf.save(st);
    void this.execute(project, customer, platform, vals).catch((err) => this.log.error(`Layer 10 ${platform}: ${err?.message || err}`));
    return this.view(customerId, month);
  }

  // Keeps two calls to the same provider at least `ms` apart (one at a time per provider, in the order queued).
  private async pace(provider: string, ms = 3000) {
    const wait = (this.lastCall.get(provider) || 0) + ms - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall.set(provider, Date.now());
  }

  // Real Quora results for the customer's main service from a site:quora.com Google search (SerpApi). Never throws.
  private async quoraSearch(serpKey: string, customer: Customer): Promise<Array<{ title: string; link: string }>> {
    try {
      const q = new URLSearchParams({ engine: 'google', q: quoraQuery(customer), gl: (process.env.SERP_GL || 'in').toLowerCase(), hl: 'en', num: '20', api_key: serpKey });
      const res = await fetch(`https://serpapi.com/search.json?${q}`, { signal: AbortSignal.timeout(45000) });
      const b: any = await res.json().catch(() => ({}));
      if (!res.ok || b?.error) throw new Error(b?.error || `HTTP ${res.status}`);
      const out: Array<{ title: string; link: string }> = [];
      for (const r of Array.isArray(b?.organic_results) ? b.organic_results : []) {
        const link = validQuoraUrl(str(r?.link));
        if (link && !out.some((o) => urlKey(o.link) === urlKey(link))) out.push({ title: str(r?.title).slice(0, 300), link });
        if (out.length >= 15) break;
      }
      return out;
    } catch (err) {
      this.log.warn(`Layer 10 Quora search: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  async execute(project: Project, customer: Customer, platform: string, vals: Record<string, string>) {
    const def = this.platform(platform);
    const st = await this.state(project, platform);
    try {
      let retrieved: Array<{ title: string; link: string }> = [];
      if (platform === 'google_ai') {
        await this.pace('google_ai');
        retrieved = await this.quoraSearch(vals.apiKey, customer);
      }
      await this.pace(def.keyProvider || platform);
      const prompt = layer10Prompt(customer, platform, retrieved);
      const reply = platform === 'google_ai' ? await askGoogleAi(vals.apiKey, prompt) : await askPlatform(platform, vals, prompt);
      const rows = parseLayer10Reply(reply, retrieved.map((r) => r.link));
      if (rows.length) await this.replaceRows(project, platform, rows, 'api');
      st.status = rows.length >= L10_PER_PLATFORM ? 'complete' : rows.length ? 'partial' : 'failed';
      st.message = rows.length
        ? `${rows.length}/${L10_PER_PLATFORM} verified Quora questions stored` + (platform === 'google_ai' ? ` (from ${retrieved.length} real Quora search results).` : '. Fewer than 10 is allowed.')
        : `${def.label} returned no verified Quora records (a record needs a quora.com https URL, topic, keyword, intent and relevance). Existing questions were kept.`;
    } catch (err) {
      st.status = 'failed';
      st.message = (err instanceof Error ? err.message : 'Run failed').slice(0, 380);
    }
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
  }

  // ---- Automation: the set date (Day 10 of the Month Cycle) ---------------------------------------
  // Platform-major, one call at a time, same rules as Layers 4-9. Skips Manual platforms, platforms already attempted
  // today and platforms already holding 10 Quora questions.
  async runDay(monthRows: Array<{ customerId: string; monthIndex: number }>, force = false): Promise<string> {
    const today = dateInTz(new Date());
    const targets: Array<{ project: Project; customer: Customer }> = [];
    for (const m of monthRows) {
      const project = await this.projects.findOne({ where: { customerId: m.customerId, monthIndex: m.monthIndex } });
      const customer = await this.customers.findOne({ where: { id: m.customerId } });
      if (project && customer) targets.push({ project, customer });
    }
    const keys = await this.globalApis.getKeys();
    let calls = 0;
    for (const def of AI_PLATFORMS) {
      const vals = keys[def.keyProvider || def.key];
      if (def.defaultMode === 'manual' && !def.keyProvider) continue;
      for (const { project, customer } of targets) {
        const st = await this.state(project, def.key);
        if ((st.mode || def.defaultMode) === 'manual') continue;
        if (!vals) {
          if (st.lastRunAt && dateInTz(st.lastRunAt) === today) continue;
          st.status = 'failed'; st.message = `${def.label} has no key in Global API Settings.`; st.lastRunAt = new Date();
          await this.pf.save(st);
          continue;
        }
        if (!force && st.lastRunAt && dateInTz(st.lastRunAt) === today && st.status !== 'idle') continue;
        const have = await this.qr.count({ where: { projectId: project.id, platform: def.key } });
        if (!force && have >= L10_PER_PLATFORM) continue;
        st.status = 'running'; st.message = 'Scheduled run...'; st.lastRunAt = new Date();
        await this.pf.save(st);
        await this.execute(project, customer, def.key, vals);
        calls++;
      }
    }
    for (const { project } of targets) await this.syncLayerStatus(project);
    return `${calls} platform call(s) for ${targets.length} customer month(s)`;
  }

  // ---- Customer panel: the table once the layer is done ---------------------------------------------
  async customerTable(customerId: string, month?: string) {
    let project: Project | null = null;
    if (month) project = await this.monthOf(customerId, month);
    else {
      const today = todayInTz();
      const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0] || null;
    }
    const expected = AI_PLATFORMS.length * L10_PER_PLATFORM;
    if (!project) return { layer: 10, complete: false, month: null, total: 0, expected, html: '', platforms: [] };
    const [rows, states] = await Promise.all([this.qr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.pf.find({ where: { projectId: project.id } })]);
    if (!this.isDone(rows, states)) return { layer: 10, complete: false, month: project.monthCode, total: rows.length, expected, html: '', platforms: [] };
    const platforms = AI_PLATFORMS.map((p) => ({
      platform: p.key,
      label: p.label,
      records: rows.filter((r) => r.platform === p.key).map((r) => ({ rank: r.rank, question: r.question, topic: r.topic, primaryKeyword: r.primaryKeyword, searchIntent: r.searchIntent, relevance: r.relevance, quoraUrl: r.quoraUrl })),
    })).filter((p) => p.records.length);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const body = platforms
      .flatMap((p) => p.records.map((r) => `<tr><td>${esc(p.label)}</td><td>${r.rank}</td><td>${esc(r.question)}</td><td>${esc(r.topic)}</td><td>${esc(r.primaryKeyword)}</td><td>${esc(r.searchIntent)}</td><td>${esc(r.relevance)}</td><td><a href="${esc(r.quoraUrl)}" target="_blank" rel="noopener">${esc(r.quoraUrl)}</a></td></tr>`))
      .join('');
    const html = `<table class="kp21-l10"><thead><tr><th>AI platform</th><th>#</th><th>Quora question</th><th>Topic</th><th>Primary keyword</th><th>Search intent</th><th>Relevance</th><th>Quora URL</th></tr></thead><tbody>${body}</tbody></table>`;
    return { layer: 10, complete: true, month: project.monthCode, total: rows.length, expected, html, platforms };
  }

  async removeByCustomer(customerId: string) {
    await this.qr.delete({ customerId });
    await this.pf.delete({ customerId });
  }
}
