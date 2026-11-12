import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { todayInTz } from '../projects/month-cycle';
import { AI_PLATFORMS, AI_PLATFORM_KEYS, askGoogleAi, askPlatform } from './ai-platforms';
import { LayersService } from './layers.service';
import { Layer8Item, Layer8Platform } from './layer8.entities';

export const L8_RELATIONSHIPS = ['Similar Product', 'Similar Service', 'Alternative Product', 'Alternative Service', 'Substitute', 'Complementary', 'Related Solution'];
export const L8_INTENTS = ['Informational', 'Commercial', 'Transactional', 'Local', 'Purchase', 'Evaluational'];
export const L8_RELEVANCE = ['High', 'Medium-High', 'Medium'];
export const L8_PER_PLATFORM = 10;
const STALE_RUN_MS = 10 * 60 * 1000;
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (value: string, allowed: string[]): string | null => allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase()) ?? null;

// Port of the plugin's Layer 8 Master Prompt (KP21_Layers::layer8_prompt, v8.9.280), with the platform search rule and the
// output instruction filled in. The business input is the profile only.
export function layer8Prompt(c: Customer, platformKey: string): string {
  const p = (c.profile || {}) as Record<string, any>;
  const def = AI_PLATFORMS.find((x) => x.key === platformKey);
  const search = platformKey === 'google_ai'
    ? 'Search using Google AI Mode / live Google results for this Layer only.'
    : `Search on your ${def?.label || platformKey} platform only. Do not use another AI platform or external search engine.`;
  const line = (label: string, v: string) => `${label}: ${v}\n`;
  return (
    'ROLE\n\nYou are a Similar Products & Services discovery and search-intent analysis engine.\n\n' +
    'Your responsibility is to identify products, services, solutions or alternatives that people are looking for which are directly related to the supplied Business Inputs.\n\nBUSINESS INPUTS\n\n' +
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
    'TASK\n\nIdentify exactly 10 relevant similar products, services, solutions or alternatives that people are looking for in relation to the supplied Products / Services and Business Inputs.\n\n' +
    'The purpose of this Layer is to discover adjacent customer demand: what potential customers may also search for, ask about, compare, evaluate or consider as an alternative to the supplied products/services.\n\n' +
    "DISCOVERY RULES\n\nEvery result must have a direct and explainable relationship to the supplied Products / Services. Do not return unrelated items merely because they belong to the same broad industry. Do not simply repeat the customer's existing product/service using different wording. Do not create duplicates or near-duplicates. Do not invent unsupported products, services, capabilities or customer requirements. Use Areas Served and Target Location only when location affects relevance.\n\n" +
    `RELATIONSHIP TYPE - allowed values only\n${L8_RELATIONSHIPS.join('\n')}\n\n` +
    `SEARCH INTENT - allowed values only\n${L8_INTENTS.join('\n')}\n\n` +
    `RELEVANCE - allowed values only\n${L8_RELEVANCE.join('\n')}\n\nDo not accept Low relevance records.\n\n` +
    'VALIDATION\n\nExactly 10 valid records when sufficient relevant results exist. Rank 1-10 exactly once. Reject blanks, duplicates, near-duplicates, mere rewrites of the original product/service, unsupported business capabilities, invalid relationship/search-intent/relevance values, Low relevance or records unrelated to the Business Inputs. Never fabricate records to reach 10.\n\n' +
    'OUTPUT INSTRUCTION\n\nReturn ONLY a valid JSON array containing exactly these keys for each record: rank, similar_product_service, relationship_type, search_intent, relevance. No markdown or commentary.'
  );
}

export interface ItemRow { item: string; relationshipType: string; searchIntent: string; relevance: string }

// Reads the JSON array out of a model reply and keeps only valid rows (port of layer8_validate_rows: rank 1-10 once,
// allowed Relationship Type / Search Intent / Relevance, no duplicates), max 10. Items that merely repeat one of the
// customer's own products / services are dropped.
export function parseLayer8Reply(text: string, own: string[] = []): ItemRow[] {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return [];
  let arr: any;
  try { arr = JSON.parse(text.slice(s, e + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const ownSet = new Set(own.map(norm));
  const rows = arr
    .map((x: any, i: number) => ({
      rank: Number(x?.rank) || i + 1,
      item: str(x?.similar_product_service ?? x?.item ?? x?.search_query),
      rel: pick(str(x?.relationship_type), L8_RELATIONSHIPS),
      intent: pick(str(x?.search_intent ?? x?.primary_intent), L8_INTENTS),
      rev: pick(str(x?.relevance ?? x?.estimated_demand), L8_RELEVANCE),
    }))
    .filter((x) => x.item && x.rel && x.intent && x.rev && x.rank >= 1 && x.rank <= 10)
    .sort((a, b) => a.rank - b.rank);
  const seenRank = new Set<number>();
  const seen = new Set<string>();
  const out: ItemRow[] = [];
  for (const r of rows) {
    const n = norm(r.item);
    if (!n || seen.has(n) || seenRank.has(r.rank) || ownSet.has(n)) continue;
    seen.add(n);
    seenRank.add(r.rank);
    out.push({ item: r.item.slice(0, 255), relationshipType: r.rel as string, searchIntent: r.intent as string, relevance: r.rev as string });
    if (out.length >= L8_PER_PLATFORM) break;
  }
  return out;
}

// Manual entry: one per line, "similar product / service | Relationship Type | Search Intent | Relevance" (all but the first optional).
export function parseManualLines(text: string): ItemRow[] {
  const seen = new Set<string>();
  const out: ItemRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/\t|\|/).map((x) => x.trim());
    if (!parts[0]) continue;
    const n = norm(parts[0]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ item: parts[0].slice(0, 255), relationshipType: pick(parts[1] || '', L8_RELATIONSHIPS) || 'Related Solution', searchIntent: pick(parts[2] || '', L8_INTENTS) || 'Commercial', relevance: pick(parts[3] || '', L8_RELEVANCE) || 'Medium' });
    if (out.length >= L8_PER_PLATFORM) break;
  }
  return out;
}

@Injectable()
export class Layer8Service {
  private readonly log = new Logger('Layer8');
  private readonly lastCall = new Map<string, number>();

  constructor(
    @InjectRepository(Layer8Item) private readonly it: Repository<Layer8Item>,
    @InjectRepository(Layer8Platform) private readonly pf: Repository<Layer8Platform>,
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

  // Everything the Layer 8 page shows: one block per platform with its items.
  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, states, globalKeys] = await Promise.all([
      this.it.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }),
      this.pf.find({ where: { projectId: project.id } }),
      this.globalApis.getKeys(),
    ]);
    const platforms = AI_PLATFORMS.map((p) => {
      const st = states.find((s) => s.platform === p.key);
      const records = rows.filter((r) => r.platform === p.key).map((r) => ({ rank: r.rank, item: r.item, relationshipType: r.relationshipType, searchIntent: r.searchIntent, relevance: r.relevance, source: r.source }));
      const mode = st?.mode || p.defaultMode;
      let status = st?.status || 'idle';
      if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
      if (status === 'idle' && records.length) status = records.length >= L8_PER_PLATFORM ? 'complete' : 'partial';
      const keyReady = p.globalKey ? !!globalKeys[p.keyProvider || p.key] : false;
      return { platform: p.key, label: p.label, mode, status, message: st?.message || '', count: records.length, expected: L8_PER_PLATFORM, keyReady, records };
    });
    return {
      month: project.monthCode,
      expected: AI_PLATFORMS.length * L8_PER_PLATFORM,
      total: platforms.reduce((a, p) => a + p.count, 0),
      completePlatforms: platforms.filter((p) => p.count >= L8_PER_PLATFORM).length,
      complete: platforms.every((p) => p.count >= L8_PER_PLATFORM),
      platforms,
    };
  }

  private async state(project: Project, platform: string): Promise<Layer8Platform> {
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

  private async replaceRows(project: Project, platform: string, rows: ItemRow[], source: string) {
    await this.it.delete({ projectId: project.id, platform });
    if (rows.length) {
      await this.it.save(rows.map((r, i) => this.it.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, platform, rank: i + 1, item: r.item, relationshipType: r.relationshipType, searchIntent: r.searchIntent, relevance: r.relevance, source })));
    }
  }

  // Keeps the Layer 8 row in the Layer schedule in step with the table: done when all 9 platforms hold 10 items.
  async syncLayerStatus(project: Project) {
    const rows = await this.it.find({ where: { projectId: project.id }, select: ['platform'] });
    const complete = AI_PLATFORMS.every((p) => rows.filter((r) => r.platform === p.key).length >= L8_PER_PLATFORM);
    await this.layers.setByMonth(project.customerId, project.monthIndex, 8, complete ? 'done' : rows.length ? 'in_progress' : 'pending');
    return complete;
  }

  async saveManual(customerId: string, month: string, platform: string, text: string) {
    this.platform(platform);
    const rows = parseManualLines(String(text || ''));
    if (!rows.length) throw new BadRequestException('Add at least one item, one per line: similar product / service | Relationship Type | Search Intent | Relevance.');
    const project = await this.monthOf(customerId, month);
    await this.replaceRows(project, platform, rows, 'manual');
    const st = await this.state(project, platform);
    st.mode = 'manual';
    st.status = rows.length >= L8_PER_PLATFORM ? 'complete' : 'partial';
    st.message = `${rows.length}/${L8_PER_PLATFORM} items saved manually.`;
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
    return this.view(customerId, month);
  }

  // Bulk import of a whole month's table (all platforms at once). One row per line, tab or | separated:
  // Platform, Rank, Similar Product / Service, Relationship Type, Search Intent, Relevance. A header line is ignored.
  // Replaces only the platforms present in the text; the rest are kept.
  async importTable(customerId: string, month: string, text: string) {
    const alias: Record<string, string> = {
      chatgpt: 'openai', openai: 'openai', gemini: 'gemini', perplexity: 'perplexity', claude: 'anthropic', anthropic: 'anthropic',
      grok: 'xai', xai: 'xai', deepseek: 'deepseek', copilot: 'copilot', 'meta ai': 'meta', meta: 'meta', 'google ai': 'google_ai', google_ai: 'google_ai',
    };
    const groups = new Map<string, Array<{ rank: number; row: ItemRow }>>();
    const skipped: string[] = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(line.includes('\t') ? '\t' : '|').map((x) => x.trim());
      const key = alias[(parts[0] || '').toLowerCase()];
      if (!key) { if (!/^platform$/i.test(parts[0] || '')) skipped.push(line.slice(0, 60)); continue; }
      const item = (parts[2] || '').slice(0, 255);
      if (!item) { skipped.push(line.slice(0, 60)); continue; }
      const row: ItemRow = { item, relationshipType: pick(parts[3] || '', L8_RELATIONSHIPS) || 'Related Solution', searchIntent: pick(parts[4] || '', L8_INTENTS) || 'Commercial', relevance: pick(parts[5] || '', L8_RELEVANCE) || 'Medium' };
      groups.set(key, [...(groups.get(key) || []), { rank: Number(parts[1]) || (groups.get(key)?.length || 0) + 1, row }]);
    }
    if (!groups.size) throw new BadRequestException('No rows recognised. Use: Platform, Rank, Similar Product / Service, Relationship Type, Search Intent, Relevance (tab or | separated).');
    const project = await this.monthOf(customerId, month);
    const summary: Record<string, number> = {};
    for (const [key, rowsOf] of groups) {
      const rows = rowsOf.sort((a, b) => a.rank - b.rank).map((x) => x.row).slice(0, L8_PER_PLATFORM);
      await this.replaceRows(project, key, rows, 'import');
      const st = await this.state(project, key);
      st.status = rows.length >= L8_PER_PLATFORM ? 'complete' : 'partial';
      st.message = rows.length + '/' + L8_PER_PLATFORM + ' items imported.';
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
    if ((st.mode || def.defaultMode) === 'manual') throw new BadRequestException(`${def.label} is set to Manual - paste its items instead, or switch it to API.`);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException(`${def.label} is already running.`);
    const customer = await this.customerOf(customerId);
    const vals = await this.keysFor(platform);
    st.status = 'running';
    st.message = 'Asking ' + def.label + '...';
    st.lastRunAt = new Date();
    await this.pf.save(st);
    void this.execute(project, customer, platform, vals).catch((err) => this.log.error(`Layer 8 ${platform}: ${err?.message || err}`));
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
      const prompt = layer8Prompt(customer, platform);
      const reply = platform === 'google_ai' ? await askGoogleAi(vals.apiKey, prompt) : await askPlatform(platform, vals, prompt);
      const own = list(((customer.profile || {}) as Record<string, any>).products_services);
      const rows = parseLayer8Reply(reply, own);
      if (rows.length) await this.replaceRows(project, platform, rows, 'api');
      st.status = rows.length >= L8_PER_PLATFORM ? 'complete' : rows.length ? 'partial' : 'failed';
      st.message = rows.length
        ? rows.length >= L8_PER_PLATFORM ? `${rows.length}/${L8_PER_PLATFORM} valid items stored.` : `${def.label} returned ${rows.length}/${L8_PER_PLATFORM} valid items.`
        : `${def.label} returned no valid records (needs a JSON array with rank, similar_product_service, relationship_type, search_intent, relevance). Existing items were kept.`;
    } catch (err) {
      st.status = 'failed';
      st.message = (err instanceof Error ? err.message : 'Run failed').slice(0, 380);
    }
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
  }

  // ---- Automation: the set date (Day 8 of the Month Cycle) ----------------------------------------
  // Platform-major, one call at a time, same rules as Layers 4-6. Skips Manual platforms, platforms already
  // attempted today and platforms already holding 10 items.
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
        if (!force && have >= L8_PER_PLATFORM) continue;
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
  // Returns the full 9-platform table once every platform holds its 10 items; nothing before that.
  async customerTable(customerId: string, month?: string) {
    let project: Project | null = null;
    if (month) project = await this.monthOf(customerId, month);
    else {
      const today = todayInTz();
      const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0] || null;
    }
    const expected = AI_PLATFORMS.length * L8_PER_PLATFORM;
    if (!project) return { layer: 8, complete: false, month: null, total: 0, expected, html: '', platforms: [] };
    const rows = await this.it.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    const platforms = AI_PLATFORMS.map((p) => ({ platform: p.key, label: p.label, records: rows.filter((r) => r.platform === p.key) }));
    const complete = platforms.every((p) => p.records.length >= L8_PER_PLATFORM);
    if (!complete) return { layer: 8, complete: false, month: project.monthCode, total: rows.length, expected, html: '', platforms: [] };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const shown = platforms.map((p) => ({
      platform: p.platform,
      label: p.label,
      records: p.records.map((r) => ({ rank: r.rank, item: r.item, relationshipType: r.relationshipType, searchIntent: r.searchIntent, relevance: r.relevance })),
    }));
    const body = shown
      .flatMap((p) => p.records.map((r) => `<tr><td>${esc(p.label)}</td><td>${r.rank}</td><td>${esc(r.item)}</td><td>${esc(r.relationshipType)}</td><td>${esc(r.searchIntent)}</td><td>${esc(r.relevance)}</td></tr>`))
      .join('');
    const html = `<table class="kp21-l8"><thead><tr><th>AI platform</th><th>#</th><th>Similar product / service</th><th>Relationship type</th><th>Search intent</th><th>Relevance</th></tr></thead><tbody>${body}</tbody></table>`;
    return { layer: 8, complete: true, month: project.monthCode, total: rows.length, expected, html, platforms: shown };
  }

  async removeByCustomer(customerId: string) {
    await this.it.delete({ customerId });
    await this.pf.delete({ customerId });
  }
}
