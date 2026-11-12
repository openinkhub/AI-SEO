import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { todayInTz } from '../projects/month-cycle';
import { AI_PLATFORMS, AI_PLATFORM_KEYS, askGoogleAi, askPlatform } from './ai-platforms';
import { LayersService } from './layers.service';
import { Layer7Question } from './layer7.entities';
import { Layer9Faq, Layer9Platform } from './layer9.entities';

export const L9_TYPES = ['Product / Service', 'Information', 'Process', 'Cost / Pricing', 'Availability', 'Location', 'Comparison', 'Eligibility', 'Purchase', 'Usage', 'Support', 'Problem / Concern', 'Post-Purchase'];
export const L9_INTENTS = ['Informational', 'Commercial', 'Transactional', 'Local', 'Evaluational', 'Navigational'];
export const L9_JOURNEYS = ['Awareness', 'Consideration', 'Decision', 'Purchase', 'Post-Purchase'];
export const L9_RELEVANCE = ['High', 'Medium-High', 'Medium'];
export const L9_PER_PLATFORM = 10;
const STALE_RUN_MS = 10 * 60 * 1000;
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (value: string, allowed: string[]): string | null => allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase()) ?? null;

// Port of the plugin's Layer 9 Master Prompt (KP21_Layers::layer9_prompt, v8.9.280), with the platform search rule and the
// output instruction filled in. The business input is the profile only. Discovery only: the platform must not answer the questions.
export function layer9Prompt(c: Customer, platformKey: string): string {
  const p = (c.profile || {}) as Record<string, any>;
  const def = AI_PLATFORMS.find((x) => x.key === platformKey);
  const search = platformKey === 'google_ai'
    ? 'Search using Google AI Mode / live Google results for this Layer only.'
    : `Search on your ${def?.label || platformKey} platform only. Do not use another AI platform or external search engine.`;
  const line = (label: string, v: string) => `${label}: ${v}\n`;
  return (
    'ROLE\n\nYou are an FAQ discovery and customer-question analysis engine.\n\n' +
    'Your responsibility is to identify questions that potential customers are actually asking, searching for, or need answered about the supplied business, products, services and related customer requirements.\n\n' +
    'This is DISCOVERY.\nDo not write FAQ answers.\nDo not write an article.\nDo not create marketing copy.\n\nBUSINESS INPUTS\n\n' +
    line('Business / Brand Name', str(p.brand_name) || c.companyName || '') +
    line('Industry', str(p.industry)) +
    line('Sector', str(p.sector)) +
    line('Primary Business Category', str(p.primary_business_category)) +
    line('Secondary Business Categories', list(p.secondary_business_categories).join(', ')) +
    line('Products / Services', list(p.products_services).join('\n')) +
    line('Product / Service Description', str(p.product_description) || str(p.product_short_description) || str(p.company_profile)) +
    line('Target Customer Segments', list(p.target_customer_segments ?? p.target_customer_segment).join(', ')) +
    line('Areas Served', list(p.areas_served).join(', ') || str(p.service_area)) +
    line('Target Location', list(p.locations).join(', ')) +
    line('Target Page', str(p.target_page)) +
    `\nPLATFORM SEARCH INSTRUCTION\n\n${search}\n\n` +
    'TASK\n\nDiscover exactly 10 unique and relevant FAQ questions associated with the supplied Products / Services and Business Inputs.\n\n' +
    'Identify questions representing genuine customer information needs, search behaviour, evaluation requirements, purchase considerations, service concerns or post-purchase requirements.\n\n' +
    'IMPORTANT DISTINCTION\n\nLayer 7 = Google People Also Ask questions.\nLayer 9 = broader FAQ/customer-question discovery.\nDo NOT simply reproduce Google People Also Ask questions. Exact duplicates and near-duplicates of existing Layer 7 questions are rejected.\n\n' +
    'QUESTION RULES\n\nEvery record must be a complete natural-language question ending with a question mark. Every question must have a direct relationship to the supplied Products / Services and represent a useful customer information need. Do not generate questions solely for keyword insertion. Do not repeat the same question with minor wording changes. Do not invent unsupported products, services, policies, prices, guarantees or business capabilities. Do not answer the questions. Do not return statements, headings or keyword fragments as FAQs. Use Areas Served and Target Location only where geographic relevance materially changes the question.\n\n' +
    `FAQ TYPE - allowed values only\n${L9_TYPES.join('\n')}\n\n` +
    `SEARCH INTENT - allowed values only\n${L9_INTENTS.join('\n')}\n\n` +
    `CUSTOMER JOURNEY - allowed values only\n${L9_JOURNEYS.join('\n')}\n\n` +
    `RELEVANCE - allowed values only\n${L9_RELEVANCE.join('\n')}\n\nReject Low relevance questions.\n\n` +
    'VALIDATION\n\nExactly 10 valid records when sufficient relevant questions exist. Rank 1-10 exactly once. Reject blanks, statements, duplicates, near-duplicates, unsupported claims, invalid enum values, Low relevance and records unrelated to the Business Inputs. Never fabricate records to reach 10.\n\n' +
    'OUTPUT INSTRUCTION\n\nReturn ONLY a valid JSON array containing exactly these keys for each record: rank, faq_question, faq_type, search_intent, customer_journey, relevance. No markdown or commentary.'
  );
}

export interface FaqRow { question: string; faqType: string; searchIntent: string; customerJourney: string; relevance: string }

const tokens = (s: string): Set<string> => new Set(norm(s).split(' ').filter(Boolean));
// Exact or near duplicate (token overlap >= 0.8) of any question in `others`.
export function nearDuplicate(q: string, others: string[]): boolean {
  const a = tokens(q);
  if (!a.size) return false;
  for (const o of others) {
    const b = tokens(o);
    if (!b.size) continue;
    let inter = 0;
    a.forEach((t) => { if (b.has(t)) inter++; });
    if (inter / (a.size + b.size - inter) >= 0.8) return true;
  }
  return false;
}

// Reads the JSON array out of a model reply and keeps only valid rows (port of layer9_validate_rows: rank 1-10 once, a real
// question ending in "?", allowed FAQ Type / Search Intent / Customer Journey / Relevance, no duplicates, not a Layer 7
// People Also Ask question), max 10.
export function parseLayer9Reply(text: string, paa: string[] = []): FaqRow[] {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return [];
  let arr: any;
  try { arr = JSON.parse(text.slice(s, e + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const rows = arr
    .map((x: any, i: number) => ({
      rank: Number(x?.rank) || i + 1,
      q: str(x?.faq_question ?? x?.question),
      type: pick(str(x?.faq_type ?? x?.question_type), L9_TYPES),
      intent: pick(str(x?.search_intent ?? x?.primary_intent), L9_INTENTS),
      journey: pick(str(x?.customer_journey), L9_JOURNEYS),
      rev: pick(str(x?.relevance ?? x?.estimated_demand), L9_RELEVANCE),
    }))
    .filter((x) => x.q && x.q.endsWith('?') && x.type && x.intent && x.journey && x.rev && x.rank >= 1 && x.rank <= 10)
    .sort((a, b) => a.rank - b.rank);
  const seenRank = new Set<number>();
  const seen = new Set<string>();
  const out: FaqRow[] = [];
  for (const r of rows) {
    const n = norm(r.q);
    if (!n || seen.has(n) || seenRank.has(r.rank) || nearDuplicate(r.q, paa)) continue;
    seen.add(n);
    seenRank.add(r.rank);
    out.push({ question: r.q.slice(0, 600), faqType: r.type as string, searchIntent: r.intent as string, customerJourney: r.journey as string, relevance: r.rev as string });
    if (out.length >= L9_PER_PLATFORM) break;
  }
  return out;
}

// Manual entry: one per line, "question | FAQ Type | Search Intent | Customer Journey | Relevance" (all but the question optional).
export function parseManualLines(text: string): FaqRow[] {
  const seen = new Set<string>();
  const out: FaqRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/\t|\|/).map((x) => x.trim());
    if (!parts[0]) continue;
    const n = norm(parts[0]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ question: parts[0].slice(0, 600), faqType: pick(parts[1] || '', L9_TYPES) || 'Information', searchIntent: pick(parts[2] || '', L9_INTENTS) || 'Informational', customerJourney: pick(parts[3] || '', L9_JOURNEYS) || 'Awareness', relevance: pick(parts[4] || '', L9_RELEVANCE) || 'Medium' });
    if (out.length >= L9_PER_PLATFORM) break;
  }
  return out;
}

@Injectable()
export class Layer9Service {
  private readonly log = new Logger('Layer9');
  private readonly lastCall = new Map<string, number>();

  constructor(
    @InjectRepository(Layer9Faq) private readonly it: Repository<Layer9Faq>,
    @InjectRepository(Layer9Platform) private readonly pf: Repository<Layer9Platform>,
    @InjectRepository(Layer7Question) private readonly l7: Repository<Layer7Question>,
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

  // Everything the Layer 9 page shows: one block per platform with its items.
  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, states, globalKeys] = await Promise.all([
      this.it.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }),
      this.pf.find({ where: { projectId: project.id } }),
      this.globalApis.getKeys(),
    ]);
    const platforms = AI_PLATFORMS.map((p) => {
      const st = states.find((s) => s.platform === p.key);
      const records = rows.filter((r) => r.platform === p.key).map((r) => ({ rank: r.rank, question: r.question, faqType: r.faqType, searchIntent: r.searchIntent, customerJourney: r.customerJourney, relevance: r.relevance, source: r.source }));
      const mode = st?.mode || p.defaultMode;
      let status = st?.status || 'idle';
      if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
      if (status === 'idle' && records.length) status = records.length >= L9_PER_PLATFORM ? 'complete' : 'partial';
      const keyReady = p.globalKey ? !!globalKeys[p.keyProvider || p.key] : false;
      return { platform: p.key, label: p.label, mode, status, message: st?.message || '', count: records.length, expected: L9_PER_PLATFORM, keyReady, records };
    });
    return {
      month: project.monthCode,
      expected: AI_PLATFORMS.length * L9_PER_PLATFORM,
      total: platforms.reduce((a, p) => a + p.count, 0),
      completePlatforms: platforms.filter((p) => p.count >= L9_PER_PLATFORM).length,
      complete: platforms.every((p) => p.count >= L9_PER_PLATFORM),
      platforms,
    };
  }

  private async state(project: Project, platform: string): Promise<Layer9Platform> {
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
    return this.view(customerId, month);
  }

  private async replaceRows(project: Project, platform: string, rows: FaqRow[], source: string) {
    await this.it.delete({ projectId: project.id, platform });
    if (rows.length) {
      await this.it.save(rows.map((r, i) => this.it.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, platform, rank: i + 1, question: r.question, faqType: r.faqType, searchIntent: r.searchIntent, customerJourney: r.customerJourney, relevance: r.relevance, source })));
    }
  }

  // Keeps the Layer 9 row in the Layer schedule in step with the table: done when all 9 platforms hold 10 questions.
  async syncLayerStatus(project: Project) {
    const rows = await this.it.find({ where: { projectId: project.id }, select: ['platform'] });
    const complete = AI_PLATFORMS.every((p) => rows.filter((r) => r.platform === p.key).length >= L9_PER_PLATFORM);
    await this.layers.setByMonth(project.customerId, project.monthIndex, 8, complete ? 'done' : rows.length ? 'in_progress' : 'pending');
    return complete;
  }

  async saveManual(customerId: string, month: string, platform: string, text: string) {
    this.platform(platform);
    const rows = parseManualLines(String(text || ''));
    if (!rows.length) throw new BadRequestException('Add at least one question, one per line: question | FAQ Type | Search Intent | Customer Journey | Relevance.');
    const project = await this.monthOf(customerId, month);
    await this.replaceRows(project, platform, rows, 'manual');
    const st = await this.state(project, platform);
    st.mode = 'manual';
    st.status = rows.length >= L9_PER_PLATFORM ? 'complete' : 'partial';
    st.message = `${rows.length}/${L9_PER_PLATFORM} questions saved manually.`;
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
    return this.view(customerId, month);
  }

  // Bulk import of a whole month's table (all platforms at once). One row per line, tab or | separated:
  // Platform, Rank, Question, FAQ Type, Search Intent, Customer Journey, Relevance. A header line is ignored.
  // Replaces only the platforms present in the text; the rest are kept.
  async importTable(customerId: string, month: string, text: string) {
    const alias: Record<string, string> = {
      chatgpt: 'openai', openai: 'openai', gemini: 'gemini', perplexity: 'perplexity', claude: 'anthropic', anthropic: 'anthropic',
      grok: 'xai', xai: 'xai', deepseek: 'deepseek', copilot: 'copilot', 'meta ai': 'meta', meta: 'meta', 'google ai': 'google_ai', google_ai: 'google_ai',
    };
    const groups = new Map<string, Array<{ rank: number; row: FaqRow }>>();
    const skipped: string[] = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(line.includes('\t') ? '\t' : '|').map((x) => x.trim());
      const key = alias[(parts[0] || '').toLowerCase()];
      if (!key) { if (!/^platform$/i.test(parts[0] || '')) skipped.push(line.slice(0, 60)); continue; }
      const question = (parts[2] || '').slice(0, 600);
      if (!question) { skipped.push(line.slice(0, 60)); continue; }
      const row: FaqRow = { question, faqType: pick(parts[3] || '', L9_TYPES) || 'Information', searchIntent: pick(parts[4] || '', L9_INTENTS) || 'Informational', customerJourney: pick(parts[5] || '', L9_JOURNEYS) || 'Awareness', relevance: pick(parts[6] || '', L9_RELEVANCE) || 'Medium' };
      groups.set(key, [...(groups.get(key) || []), { rank: Number(parts[1]) || (groups.get(key)?.length || 0) + 1, row }]);
    }
    if (!groups.size) throw new BadRequestException('No rows recognised. Use: Platform, Rank, Question, FAQ Type, Search Intent, Customer Journey, Relevance (tab or | separated).');
    const project = await this.monthOf(customerId, month);
    const summary: Record<string, number> = {};
    for (const [key, rowsOf] of groups) {
      const rows = rowsOf.sort((a, b) => a.rank - b.rank).map((x) => x.row).slice(0, L9_PER_PLATFORM);
      await this.replaceRows(project, key, rows, 'import');
      const st = await this.state(project, key);
      st.status = rows.length >= L9_PER_PLATFORM ? 'complete' : 'partial';
      st.message = rows.length + '/' + L9_PER_PLATFORM + ' questions imported.';
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
    if ((st.mode || def.defaultMode) === 'manual') throw new BadRequestException(`${def.label} is set to Manual - paste its questions instead, or switch it to API.`);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException(`${def.label} is already running.`);
    const customer = await this.customerOf(customerId);
    const vals = await this.keysFor(platform);
    st.status = 'running';
    st.message = 'Asking ' + def.label + '...';
    st.lastRunAt = new Date();
    await this.pf.save(st);
    void this.execute(project, customer, platform, vals).catch((err) => this.log.error(`Layer 9 ${platform}: ${err?.message || err}`));
    return this.view(customerId, month);
  }

  // Keeps two calls to the same provider at least `ms` apart (one at a time per provider, in the order queued).
  private async pace(provider: string, ms = 3000) {
    const wait = (this.lastCall.get(provider) || 0) + ms - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall.set(provider, Date.now());
  }

  async execute(project: Project, customer: Customer, platform: string, vals: Record<string, string>) {
    const def = this.platform(platform);
    const st = await this.state(project, platform);
    try {
      await this.pace(def.keyProvider || platform);
      const prompt = layer9Prompt(customer, platform);
      const reply = platform === 'google_ai' ? await askGoogleAi(vals.apiKey, prompt) : await askPlatform(platform, vals, prompt);
      const paa = (await this.l7.find({ where: { projectId: project.id }, select: ['question'] })).map((r) => r.question);
      const rows = parseLayer9Reply(reply, paa);
      if (rows.length) await this.replaceRows(project, platform, rows, 'api');
      st.status = rows.length >= L9_PER_PLATFORM ? 'complete' : rows.length ? 'partial' : 'failed';
      st.message = rows.length
        ? rows.length >= L9_PER_PLATFORM ? `${rows.length}/${L9_PER_PLATFORM} valid questions stored.` : `${def.label} returned ${rows.length}/${L9_PER_PLATFORM} valid questions.`
        : `${def.label} returned no valid records (needs a JSON array with rank, faq_question, faq_type, search_intent, customer_journey, relevance; each a question ending in ?). Existing questions were kept.`;
    } catch (err) {
      st.status = 'failed';
      st.message = (err instanceof Error ? err.message : 'Run failed').slice(0, 380);
    }
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
  }

  // ---- Automation: the set date (Day 9 of the Month Cycle) ----------------------------------------
  // Platform-major, one call at a time, same rules as Layers 4-6. Skips Manual platforms, platforms already
  // attempted today and platforms already holding 10 questions.
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
        const have = await this.it.count({ where: { projectId: project.id, platform: def.key } });
        if (!force && have >= L9_PER_PLATFORM) continue;
        st.status = 'running'; st.message = 'Scheduled run...'; st.lastRunAt = new Date();
        await this.pf.save(st);
        await this.execute(project, customer, def.key, vals);
        calls++;
      }
    }
    for (const { project } of targets) await this.syncLayerStatus(project);
    return `${calls} platform call(s) for ${targets.length} customer month(s)`;
  }

  // ---- Customer panel: the finished table only -----------------------------------------------------
  // Returns the full 9-platform table once every platform holds its 10 questions; nothing before that.
  async customerTable(customerId: string, month?: string) {
    let project: Project | null = null;
    if (month) project = await this.monthOf(customerId, month);
    else {
      const today = todayInTz();
      const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0] || null;
    }
    const expected = AI_PLATFORMS.length * L9_PER_PLATFORM;
    if (!project) return { layer: 8, complete: false, month: null, total: 0, expected, html: '', platforms: [] };
    const rows = await this.it.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    const platforms = AI_PLATFORMS.map((p) => ({ platform: p.key, label: p.label, records: rows.filter((r) => r.platform === p.key) }));
    const complete = platforms.every((p) => p.records.length >= L9_PER_PLATFORM);
    if (!complete) return { layer: 8, complete: false, month: project.monthCode, total: rows.length, expected, html: '', platforms: [] };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const shown = platforms.map((p) => ({
      platform: p.platform,
      label: p.label,
      records: p.records.map((r) => ({ rank: r.rank, question: r.question, faqType: r.faqType, searchIntent: r.searchIntent, customerJourney: r.customerJourney, relevance: r.relevance })),
    }));
    const body = shown
      .flatMap((p) => p.records.map((r) => `<tr><td>${esc(p.label)}</td><td>${r.rank}</td><td>${esc(r.question)}</td><td>${esc(r.faqType)}</td><td>${esc(r.searchIntent)}</td><td>${esc(r.customerJourney)}</td><td>${esc(r.relevance)}</td></tr>`))
      .join('');
    const html = `<table class="kp21-l8"><thead><tr><th>AI platform</th><th>#</th><th>FAQ question</th><th>FAQ type</th><th>Search intent</th><th>Customer journey</th><th>Relevance</th></tr></thead><tbody>${body}</tbody></table>`;
    return { layer: 8, complete: true, month: project.monthCode, total: rows.length, expected, html, platforms: shown };
  }

  async removeByCustomer(customerId: string) {
    await this.it.delete({ customerId });
    await this.pf.delete({ customerId });
  }
}
