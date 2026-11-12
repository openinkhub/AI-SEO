import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { todayInTz } from '../projects/month-cycle';
import { AI_PLATFORMS, AI_PLATFORM_KEYS, askGoogleAi, askPlatform } from './ai-platforms';
import { LayersService } from './layers.service';
import { Layer6Keyword, Layer6Platform } from './layer6.entities';

export const L6_INTENTS = ['Informational', 'Navigational', 'Commercial', 'Transactional', 'Local', 'Purchase', 'Evaluational', 'Compliance'];
export const L6_DEMANDS = ['High', 'Medium-High', 'Medium', 'Low'];
export const L6_PER_PLATFORM = 10;
const STALE_RUN_MS = 10 * 60 * 1000;
const dateInTz = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date(d));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (value: string, allowed: string[]): string | null => allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase()) ?? null;
const vol = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const words = (s: string): number => norm(s).split(' ').filter(Boolean).length;

// Port of the plugin's Layer 6 Master Prompt (KP21_Layers::layer6_prompt, v8.9.280), with the platform search rule and the
// output instruction filled in. The business input is the profile only.
export function layer6Prompt(c: Customer, platformKey: string): string {
  const p = (c.profile || {}) as Record<string, any>;
  const def = AI_PLATFORMS.find((x) => x.key === platformKey);
  const search = platformKey === 'google_ai'
    ? 'Search using Google AI Mode / live Google results for this Layer only.'
    : `Search on your ${def?.label || platformKey} platform only. Do not use another AI platform or external search engine.`;
  const block = (label: string, v: string) => `${label}:\n${v}\n\n`;
  return (
    'ROLE\nYou are an AI Search Long-Tail Keyword Research expert.\n\nBUSINESS INPUT\n\n' +
    block('Industry', str(p.industry)) +
    block('Sector', str(p.sector)) +
    block('Products / Services', list(p.products_services).join('\n')) +
    block('Product / Service Description', str(p.product_description) || str(p.product_short_description) || str(p.company_profile)) +
    block('Target Customer Segments', list(p.target_customer_segments ?? p.target_customer_segment).join('\n')) +
    block('Areas Served', list(p.areas_served).join('\n') || str(p.service_area)) +
    block('Target Location', list(p.locations).join('\n')) +
    `PLATFORM SEARCH INSTRUCTION\n${search}\n\n` +
    'TASK\nIdentify exactly 10 realistic, highly relevant long-tail search queries users are likely to use on the selected platform when researching, comparing, evaluating or purchasing the supplied products/services.\n\n' +
    'Use the Business Input as the primary relevance constraint. Do not introduce products, services, customer segments or locations that are not supported by the Business Input.\n\n' +
    'Cover an appropriate mix of product/service, informational, commercial, transactional, buyer-intent, evaluation/comparison, industry-specific, local, niche and compliance searches where relevant.\n\n' +
    'A long-tail keyword must be a specific natural-language multi-word search query, not merely a generic keyword with extra filler words.\n\n' +
    `INTENT - allowed values only\n${L6_INTENTS.join('\n')}\n\n` +
    `DEMAND - allowed values only\n${L6_DEMANDS.join('\n')}\n\n` +
    'VALIDATION\nExactly 10 records.\nRank 1-10 exactly once.\nNo blank records.\nNo duplicates or near-duplicates.\nEvery result must be directly relevant to the Business Input.\nEvery result must be a genuine long-tail query.\nUse only the allowed Intent and Demand values.\n\n' +
    'OUTPUT INSTRUCTION\nReturn ONLY a valid JSON array containing exactly these keys for each record: rank, long_tail_keyword, intent, demand. Exactly 10 records; no markdown or commentary.'
  );
}

// Port of the plugin's layer6_keyword_type: a label worked out from the keyword and its intent.
export function keywordTypeFor(keyword: string, intent: string): string {
  const k = keyword.toLowerCase();
  if (/\b(what|how|why|when|where|which|who)\b/.test(k)) return 'Question';
  if (intent === 'Local' || /\b(near me|nearby| in )\b/.test(k)) return 'Local';
  if (/\b(vs|versus|compare|comparison|alternative|alternatives)\b/.test(k)) return 'Comparison';
  if (/\b(problem|issue|fix|solution|solve)\b/.test(k)) return 'Problem-Solution';
  if (intent === 'Transactional' || intent === 'Purchase') return 'Buyer Intent';
  if (intent === 'Commercial' || intent === 'Evaluational') return 'Commercial / Evaluation';
  return 'Product / Service';
}

export interface KeywordRow { keyword: string; intent: string; demand: string; estVolume?: number | null }

// Reads the JSON array out of a model reply and keeps only valid rows (the plugin's validator rules: rank 1-10 once,
// at least 3 words, no duplicates, allowed Intent and Demand), max 10.
export function parseLayer6Reply(text: string): KeywordRow[] {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return [];
  let arr: any;
  try { arr = JSON.parse(text.slice(s, e + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const rows = arr
    .map((x: any, i: number) => ({ rank: Number(x?.rank) || i + 1, keyword: str(x?.long_tail_keyword ?? x?.keyword), intent: pick(str(x?.intent), L6_INTENTS), demand: pick(str(x?.demand), L6_DEMANDS) }))
    .filter((x) => x.keyword && x.intent && x.demand && x.rank >= 1 && x.rank <= 10 && words(x.keyword) >= 3)
    .sort((a, b) => a.rank - b.rank);
  const seenRank = new Set<number>();
  const seen = new Set<string>();
  const out: KeywordRow[] = [];
  for (const r of rows) {
    const n = norm(r.keyword);
    if (!n || seen.has(n) || seenRank.has(r.rank)) continue;
    seen.add(n);
    seenRank.add(r.rank);
    out.push({ keyword: r.keyword.slice(0, 255), intent: r.intent as string, demand: r.demand as string, estVolume: null });
    if (out.length >= L6_PER_PLATFORM) break;
  }
  return out;
}

// Manual entry: one per line, "keyword | Intent | Demand | est. volume" (all but the keyword optional).
export function parseManualLines(text: string): KeywordRow[] {
  const seen = new Set<string>();
  const out: KeywordRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/\t|\|/).map((x) => x.trim());
    if (!parts[0]) continue;
    const n = norm(parts[0]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ keyword: parts[0].slice(0, 255), intent: pick(parts[1] || '', L6_INTENTS) || 'Informational', demand: pick(parts[2] || '', L6_DEMANDS) || 'Medium', estVolume: vol(parts[3]) });
    if (out.length >= L6_PER_PLATFORM) break;
  }
  return out;
}

// Second, small call per platform: the platform's own estimate of monthly searches for each long-tail keyword.
export function layer6VolumePrompt(c: Customer, items: Array<{ rank: number; query: string }>): string {
  const p = (c.profile || {}) as Record<string, any>;
  const where = list(p.locations).join(', ') || list(p.areas_served).join(', ') || 'the target country';
  return (
    'You are a keyword research expert.\n\n' +
    `For each search query below, estimate its average monthly searches in the Target Location / Country as a whole number (never leave it out; use your best estimate, 0 only if the query is not searched). Use your own platform knowledge.\n\nTarget Location: ${where}\n\nQUERIES\n` +
    JSON.stringify(items) +
    '\n\nReturn ONLY a valid JSON array with exactly these keys per record: rank, est_volume. One record per query, using the same rank. No markdown or commentary.'
  );
}

export function parseVolumeReply(text: string): Map<number, number> {
  const out = new Map<number, number>();
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return out;
  let arr: any;
  try { arr = JSON.parse(text.slice(s, e + 1)); } catch { return out; }
  if (!Array.isArray(arr)) return out;
  for (const x of arr) {
    const rank = Number(x?.rank);
    const v = vol(x?.est_volume ?? x?.estimated_volume ?? x?.volume);
    if (rank >= 1 && v !== null) out.set(rank, v);
  }
  return out;
}

@Injectable()
export class Layer6Service {
  private readonly log = new Logger('Layer6');
  private readonly lastCall = new Map<string, number>();

  constructor(
    @InjectRepository(Layer6Keyword) private readonly kw: Repository<Layer6Keyword>,
    @InjectRepository(Layer6Platform) private readonly pf: Repository<Layer6Platform>,
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

  // Everything the Layer 6 page shows: one block per platform with its keywords.
  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, states, globalKeys] = await Promise.all([
      this.kw.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }),
      this.pf.find({ where: { projectId: project.id } }),
      this.globalApis.getKeys(),
    ]);
    const platforms = AI_PLATFORMS.map((p) => {
      const st = states.find((s) => s.platform === p.key);
      const records = rows.filter((r) => r.platform === p.key).map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, keywordType: r.keywordType, demand: r.demand, estVolume: r.estVolume, source: r.source }));
      const mode = st?.mode || p.defaultMode;
      let status = st?.status || 'idle';
      if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
      if (status === 'idle' && records.length) status = records.length >= L6_PER_PLATFORM ? 'complete' : 'partial';
      const keyReady = p.globalKey ? !!globalKeys[p.keyProvider || p.key] : false;
      return { platform: p.key, label: p.label, mode, status, message: st?.message || '', count: records.length, expected: L6_PER_PLATFORM, keyReady, records };
    });
    return {
      month: project.monthCode,
      expected: AI_PLATFORMS.length * L6_PER_PLATFORM,
      total: platforms.reduce((a, p) => a + p.count, 0),
      completePlatforms: platforms.filter((p) => p.count >= L6_PER_PLATFORM).length,
      complete: platforms.every((p) => p.count >= L6_PER_PLATFORM),
      platforms,
    };
  }

  private async state(project: Project, platform: string): Promise<Layer6Platform> {
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

  private async replaceRows(project: Project, platform: string, rows: KeywordRow[], source: string) {
    await this.kw.delete({ projectId: project.id, platform });
    if (rows.length) {
      await this.kw.save(rows.map((r, i) => this.kw.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, platform, rank: i + 1, keyword: r.keyword, intent: r.intent, keywordType: keywordTypeFor(r.keyword, r.intent), demand: r.demand, estVolume: r.estVolume ?? null, source })));
    }
  }

  // Asks the platform for the estimated monthly searches of each stored keyword without a volume and saves them.
  // Returns how many got a volume. Never throws: a failure leaves the keywords as they are.
  async fillVolumes(project: Project, customer: Customer, platform: string, vals: Record<string, string>): Promise<number> {
    const def = this.platform(platform);
    const rows = await this.kw.find({ where: { projectId: project.id, platform }, order: { rank: 'ASC' } });
    const missing = rows.filter((r) => r.estVolume === null);
    if (!missing.length) return 0;
    try {
      await this.pace(def.keyProvider || platform);
      const prompt = layer6VolumePrompt(customer, missing.map((r) => ({ rank: r.rank, query: r.keyword })));
      const reply = platform === 'google_ai' ? await askGoogleAi(vals.apiKey, prompt) : await askPlatform(platform, vals, prompt);
      const got = parseVolumeReply(reply);
      let n = 0;
      for (const r of missing) {
        const v = got.get(r.rank);
        if (v === undefined) continue;
        r.estVolume = v;
        await this.kw.save(r);
        n++;
      }
      return n;
    } catch (err) {
      this.log.warn(`Layer 6 volumes ${platform}: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }

  // Background run of fillVolumes for one platform (button on the page).
  async startVolumes(customerId: string, month: string, platform: string) {
    const def = this.platform(platform);
    const project = await this.monthOf(customerId, month);
    const customer = await this.customerOf(customerId);
    const vals = await this.keysFor(platform);
    const st = await this.state(project, platform);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException(`${def.label} is already running.`);
    st.status = 'running';
    st.message = 'Getting volumes from ' + def.label + '…';
    st.lastRunAt = new Date();
    await this.pf.save(st);
    void (async () => {
      const n = await this.fillVolumes(project, customer, platform, vals);
      const s2 = await this.state(project, platform);
      const count = await this.kw.count({ where: { projectId: project.id, platform } });
      s2.status = count >= L6_PER_PLATFORM ? 'complete' : count ? 'partial' : 'idle';
      s2.message = n ? `Volumes saved for ${n} keyword(s).` : 'No volumes returned - try again.';
      s2.lastRunAt = new Date();
      await this.pf.save(s2);
    })().catch((err) => this.log.error(`Layer 6 volumes ${platform}: ${err?.message || err}`));
    return this.view(customerId, month);
  }

  // Keeps the Layer 6 row in the Layer schedule in step with the table: done when all 9 platforms hold 10 keywords.
  async syncLayerStatus(project: Project) {
    const rows = await this.kw.find({ where: { projectId: project.id }, select: ['platform'] });
    const complete = AI_PLATFORMS.every((p) => rows.filter((r) => r.platform === p.key).length >= L6_PER_PLATFORM);
    await this.layers.setByMonth(project.customerId, project.monthIndex, 6, complete ? 'done' : rows.length ? 'in_progress' : 'pending');
    return complete;
  }

  async saveManual(customerId: string, month: string, platform: string, text: string) {
    this.platform(platform);
    const rows = parseManualLines(String(text || ''));
    if (!rows.length) throw new BadRequestException('Add at least one keyword, one per line: keyword | Intent | Demand | est. volume.');
    const project = await this.monthOf(customerId, month);
    await this.replaceRows(project, platform, rows, 'manual');
    const st = await this.state(project, platform);
    st.mode = 'manual';
    st.status = rows.length >= L6_PER_PLATFORM ? 'complete' : 'partial';
    st.message = `${rows.length}/${L6_PER_PLATFORM} keywords saved manually.`;
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
    return this.view(customerId, month);
  }

  // Bulk import of a whole month's table (all platforms at once). One row per line, tab or | separated:
  // Platform, Rank, Keyword, Intent, Demand, Est Volume (blank or "-" = none). A header line is ignored.
  // Replaces only the platforms present in the text; the rest are kept.
  async importTable(customerId: string, month: string, text: string) {
    const alias: Record<string, string> = {
      chatgpt: 'openai', openai: 'openai', gemini: 'gemini', perplexity: 'perplexity', claude: 'anthropic', anthropic: 'anthropic',
      grok: 'xai', xai: 'xai', deepseek: 'deepseek', copilot: 'copilot', 'meta ai': 'meta', meta: 'meta', 'google ai': 'google_ai', google_ai: 'google_ai',
    };
    const groups = new Map<string, Array<{ rank: number; row: KeywordRow }>>();
    const skipped: string[] = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(line.includes('\t') ? '\t' : '|').map((x) => x.trim());
      const key = alias[(parts[0] || '').toLowerCase()];
      if (!key) { if (!/^platform$/i.test(parts[0] || '')) skipped.push(line.slice(0, 60)); continue; }
      const keyword = (parts[2] || '').slice(0, 255);
      if (!keyword) { skipped.push(line.slice(0, 60)); continue; }
      const row: KeywordRow = { keyword, intent: pick(parts[3] || '', L6_INTENTS) || 'Informational', demand: pick(parts[4] || '', L6_DEMANDS) || 'Medium', estVolume: vol(parts[5]) };
      groups.set(key, [...(groups.get(key) || []), { rank: Number(parts[1]) || (groups.get(key)?.length || 0) + 1, row }]);
    }
    if (!groups.size) throw new BadRequestException('No rows recognised. Use: Platform, Rank, Keyword, Intent, Demand, Est Volume (tab or | separated).');
    const project = await this.monthOf(customerId, month);
    const summary: Record<string, number> = {};
    for (const [key, list] of groups) {
      const rows = list.sort((a, b) => a.rank - b.rank).map((x) => x.row).slice(0, L6_PER_PLATFORM);
      await this.replaceRows(project, key, rows, 'import');
      const st = await this.state(project, key);
      st.status = rows.length >= L6_PER_PLATFORM ? 'complete' : 'partial';
      st.message = rows.length + '/' + L6_PER_PLATFORM + ' keywords imported.';
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
    if ((st.mode || def.defaultMode) === 'manual') throw new BadRequestException(`${def.label} is set to Manual - paste its keywords instead, or switch it to API.`);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException(`${def.label} is already running.`);
    const customer = await this.customerOf(customerId);
    const vals = await this.keysFor(platform);
    st.status = 'running';
    st.message = 'Asking ' + def.label + '…';
    st.lastRunAt = new Date();
    await this.pf.save(st);
    void this.execute(project, customer, platform, vals).catch((err) => this.log.error(`Layer 6 ${platform}: ${err?.message || err}`));
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
      const prompt = layer6Prompt(customer, platform);
      const reply = platform === 'google_ai' ? await askGoogleAi(vals.apiKey, prompt) : await askPlatform(platform, vals, prompt);
      const rows = parseLayer6Reply(reply);
      let withVol = 0;
      if (rows.length) {
        await this.replaceRows(project, platform, rows, 'api');
        withVol = await this.fillVolumes(project, customer, platform, vals);
      }
      st.status = rows.length >= L6_PER_PLATFORM ? 'complete' : rows.length ? 'partial' : 'failed';
      st.message = rows.length
        ? (rows.length >= L6_PER_PLATFORM ? `${rows.length}/${L6_PER_PLATFORM} valid keywords stored` : `${def.label} returned ${rows.length}/${L6_PER_PLATFORM} valid keywords`) + (withVol ? `; volume for ${withVol}.` : '; no volumes returned (use Get volumes).')
        : `${def.label} returned no valid long-tail keywords (needs a JSON array with rank, long_tail_keyword, intent, demand; 3+ words each). Existing keywords were kept.`;
    } catch (err) {
      st.status = 'failed';
      st.message = (err instanceof Error ? err.message : 'Run failed').slice(0, 380);
    }
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
  }

  // ---- Automation: the set date (Day 6 of the Month Cycle) ----------------------------------------
  // Platform-major, one call at a time, same rules as Layers 4 and 5. Skips Manual platforms, platforms already
  // attempted today and platforms already holding 10 keywords.
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
        const have = await this.kw.count({ where: { projectId: project.id, platform: def.key } });
        if (!force && have >= L6_PER_PLATFORM) continue;
        st.status = 'running'; st.message = 'Scheduled run…'; st.lastRunAt = new Date();
        await this.pf.save(st);
        await this.execute(project, customer, def.key, vals);
        calls++;
      }
    }
    for (const { project } of targets) await this.syncLayerStatus(project);
    return `${calls} platform call(s) for ${targets.length} customer month(s)`;
  }

  // ---- Customer panel: the finished table only -----------------------------------------------------
  // Returns the full 9-platform table once every platform holds its 10 keywords; nothing before that.
  async customerTable(customerId: string, month?: string) {
    let project: Project | null = null;
    if (month) project = await this.monthOf(customerId, month);
    else {
      const today = todayInTz();
      const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0] || null;
    }
    const expected = AI_PLATFORMS.length * L6_PER_PLATFORM;
    if (!project) return { layer: 6, complete: false, month: null, total: 0, expected, html: '', platforms: [] };
    const rows = await this.kw.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    const platforms = AI_PLATFORMS.map((p) => ({ platform: p.key, label: p.label, records: rows.filter((r) => r.platform === p.key) }));
    const complete = platforms.every((p) => p.records.length >= L6_PER_PLATFORM);
    if (!complete) return { layer: 6, complete: false, month: project.monthCode, total: rows.length, expected, html: '', platforms: [] };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const shown = platforms.map((p) => ({
      platform: p.platform,
      label: p.label,
      records: p.records.map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, keywordType: r.keywordType, demand: r.demand, volume: r.estVolume ?? null })),
    }));
    const body = shown
      .flatMap((p) => p.records.map((r) => `<tr><td>${esc(p.label)}</td><td>${r.rank}</td><td>${esc(r.keyword)}</td><td>${esc(r.intent)}</td><td>${esc(r.keywordType)}</td><td>${esc(r.demand)}</td><td>${r.volume == null ? '—' : r.volume.toLocaleString('en-US')}</td></tr>`))
      .join('');
    const html = `<table class="kp21-l6"><thead><tr><th>AI platform</th><th>#</th><th>Long-tail keyword</th><th>Primary intent</th><th>Keyword type</th><th>Demand</th><th>Est. monthly searches</th></tr></thead><tbody>${body}</tbody></table>`;
    return { layer: 6, complete: true, month: project.monthCode, total: rows.length, expected, html, platforms: shown };
  }

  async removeByCustomer(customerId: string) {
    await this.kw.delete({ customerId });
    await this.pf.delete({ customerId });
  }
}
