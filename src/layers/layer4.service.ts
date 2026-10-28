import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { CustomerApisService } from '../customer-apis/customer-apis.service';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { todayInTz } from '../projects/month-cycle';
import { AI_PLATFORMS, AI_PLATFORM_KEYS, askGoogleAi, askPlatform, googleAiOverview } from './ai-platforms';
import { LayersService } from './layers.service';
import { Layer4Keyword, Layer4Platform } from './layer4.entities';

export const L4_INTENTS = ['Informational', 'Navigational', 'Commercial', 'Transactional', 'Local', 'Purchase', 'Evaluational', 'Compliance'];
export const L4_DEMANDS = ['High', 'Medium-High', 'Medium', 'Low'];
export const L4_PER_PLATFORM = 10;
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

// The business inputs block shared by every platform's prompt.
function businessInputs(c: Customer): string {
  const p = (c.profile || {}) as Record<string, any>;
  const line = (label: string, v: string) => `${label}: ${v}\n`;
  return (
    line('Domain', str(p.domain) || c.website || '') +
    line('Target Page', str(p.target_page)) +
    line('Industry', str(p.industry)) +
    line('Sector', str(p.sector)) +
    line('Products/Services', list(p.products_services).join(', ')) +
    line('Target Customer', list(p.target_customer_segments).join(', ')) +
    line('Areas Served', list(p.areas_served).join(', ') || str(p.service_area)) +
    line('Target Location', list(p.locations).join(', ')) +
    line('Seed Keywords', list(p.seed_keywords).join(', ')) +
    line('Brand', str(p.brand_name) || c.companyName || '') +
    line('Description', str(p.product_short_description) || str(p.company_profile))
  );
}

const OUTPUT_RULES =
  `Allowed Intent values ONLY: ${L4_INTENTS.join(', ')}. Allowed Demand values ONLY: ${L4_DEMANDS.join(', ')}. ` +
  'Return ONLY a valid JSON array with EXACTLY these five keys per record: rank, keyword, intent, demand, est_volume. ' +
  'est_volume = your best estimate of the keyword\'s average monthly searches in the Target Location / Country as a whole number (never leave it out; use your best estimate, 0 only if the keyword is not searched). ' +
  'Do not return primary_intent, secondary_intent, keyword_role, reason or any other field.';

// Layer 4 prompt (port of the plugin's, plus est_volume). Every platform gets this one.
export function layer4Prompt(c: Customer): string {
  return (
    businessInputs(c) +
    'You are an AI Search Keyword Research expert. Analyze the Industry, Sector, Products/Services, Product Description, Target Customer and Locations above to identify search keywords and queries users are likely to use when searching for these products, services and solutions ON YOUR PLATFORM ONLY. ' +
    'Do not search the web. Do not invent/create unrelated keywords. Research only from your platform/internal knowledge. Return EXACTLY 10 highly relevant records ranked from highest business/search opportunity to lowest. Avoid duplicates and near-duplicates. ' +
    OUTPUT_RULES
  );
}

// Search query handed to Google AI Overview: the main service in the main location, as a person would type it.
export function overviewQuery(c: Customer): string {
  const p = (c.profile || {}) as Record<string, any>;
  const what = list(p.seed_keywords)[0] || list(p.products_services)[0] || str(p.industry) || c.companyName || '';
  const where = list(p.locations)[0] || list(p.areas_served)[0] || '';
  return [what, where].filter(Boolean).join(' ').slice(0, 120);
}

// Google AI prompt: AI Mode answers from live Google results, so it may use them; the Google AI Overview for the
// main search query is passed in as grounding. Same output contract as every other platform.
export function layer4GooglePrompt(c: Customer, query: string, overview: string): string {
  return (
    businessInputs(c) +
    'You are an AI Search Keyword Research expert working inside Google AI Mode. Using Google search results for the business above' +
    (overview ? `, and the Google AI Overview for the search "${query}" quoted below,` : '') +
    ' identify the search keywords and queries users type or ask when looking for these products, services and solutions. Do not invent unrelated keywords. ' +
    'Return EXACTLY 10 highly relevant records ranked from highest business/search opportunity to lowest. Avoid duplicates and near-duplicates. ' +
    (overview ? `\nGOOGLE AI OVERVIEW for "${query}":\n${overview}\n\n` : '') +
    OUTPUT_RULES
  );
}

export interface KeywordRow { keyword: string; intent: string; demand: string; estVolume: number | null }

// Reads the JSON array out of a model reply and keeps only valid, de-duplicated rows (max 10).
export function parseLayer4Reply(text: string): KeywordRow[] {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return [];
  let arr: any;
  try { arr = JSON.parse(text.slice(s, e + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const rows = arr
    .map((x: any, i: number) => ({ rank: Number(x?.rank) || i + 1, keyword: str(x?.keyword), intent: pick(str(x?.intent), L4_INTENTS), demand: pick(str(x?.demand), L4_DEMANDS), estVolume: vol(x?.est_volume ?? x?.estimated_volume ?? x?.volume) }))
    .filter((x) => x.keyword && x.intent && x.demand)
    .sort((a, b) => a.rank - b.rank);
  const seen = new Set<string>();
  const out: KeywordRow[] = [];
  for (const r of rows) {
    const n = norm(r.keyword);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ keyword: r.keyword.slice(0, 255), intent: r.intent as string, demand: r.demand as string, estVolume: r.estVolume });
    if (out.length >= L4_PER_PLATFORM) break;
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
    out.push({ keyword: parts[0].slice(0, 255), intent: pick(parts[1] || '', L4_INTENTS) || 'Informational', demand: pick(parts[2] || '', L4_DEMANDS) || 'Medium', estVolume: vol(parts[3]) });
    if (out.length >= L4_PER_PLATFORM) break;
  }
  return out;
}

@Injectable()
export class Layer4Service {
  private readonly log = new Logger('Layer4');
  private readonly lastCall = new Map<string, number>();

  constructor(
    @InjectRepository(Layer4Keyword) private readonly kw: Repository<Layer4Keyword>,
    @InjectRepository(Layer4Platform) private readonly pf: Repository<Layer4Platform>,
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

  platform(key: string) {
    const p = AI_PLATFORMS.find((x) => x.key === key);
    if (!p) throw new BadRequestException(`Unknown platform. Use one of: ${AI_PLATFORM_KEYS.join(', ')}.`);
    return p;
  }

  // Everything the Layer 4 page shows: one block per platform with its keywords.
  async view(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, states, globalKeys] = await Promise.all([
      this.kw.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }),
      this.pf.find({ where: { projectId: project.id } }),
      this.globalApis.getKeys(),
    ]);
    const platforms = AI_PLATFORMS.map((p) => {
      const st = states.find((s) => s.platform === p.key);
      const records = rows.filter((r) => r.platform === p.key).map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, demand: r.demand, estVolume: r.estVolume, volume: r.volume, volumeSource: r.volumeSource, source: r.source }));
      const mode = st?.mode || p.defaultMode;
      let status = st?.status || 'idle';
      if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
      if (status === 'idle' && records.length) status = records.length >= L4_PER_PLATFORM ? 'complete' : 'partial';
      const keyReady = p.globalKey ? !!globalKeys[p.keyProvider || p.key] : false;
      return { platform: p.key, label: p.label, mode, status, message: st?.message || '', count: records.length, expected: L4_PER_PLATFORM, keyReady, records };
    });
    const complete = platforms.every((p) => p.count >= L4_PER_PLATFORM);
    return {
      month: project.monthCode,
      expected: AI_PLATFORMS.length * L4_PER_PLATFORM,
      total: platforms.reduce((a, p) => a + p.count, 0),
      completePlatforms: platforms.filter((p) => p.count >= L4_PER_PLATFORM).length,
      complete,
      platforms,
    };
  }

  private async state(project: Project, platform: string): Promise<Layer4Platform> {
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
      await this.kw.save(rows.map((r, i) => this.kw.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, platform, rank: i + 1, keyword: r.keyword, intent: r.intent, demand: r.demand, estVolume: r.estVolume, volume: null, volumeSource: null, source })));
    }
  }

  // Keeps the Layer 4 row in the Layer schedule in step with the table: done when all 9 platforms hold 10 keywords.
  async syncLayerStatus(project: Project) {
    const rows = await this.kw.find({ where: { projectId: project.id }, select: ['platform'] });
    const complete = AI_PLATFORMS.every((p) => rows.filter((r) => r.platform === p.key).length >= L4_PER_PLATFORM);
    await this.layers.setByMonth(project.customerId, project.monthIndex, 4, complete ? 'done' : rows.length ? 'in_progress' : 'pending');
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
    st.status = rows.length >= L4_PER_PLATFORM ? 'complete' : 'partial';
    st.message = `${rows.length}/${L4_PER_PLATFORM} keywords saved manually.`;
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
    return this.view(customerId, month);
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
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const vals = await this.keysFor(platform);
    st.status = 'running';
    st.message = 'Asking ' + def.label + '…';
    st.lastRunAt = new Date();
    await this.pf.save(st);
    void this.execute(project, customer, platform, vals).catch((err) => this.log.error(`Layer 4 ${platform}: ${err?.message || err}`));
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
      let reply: string;
      if (platform === 'google_ai') {
        const q = overviewQuery(customer);
        let overview = '';
        try { overview = q ? await googleAiOverview(vals.apiKey, q) : ''; } catch (e) { this.log.warn(`Google AI Overview skipped: ${e instanceof Error ? e.message : e}`); }
        reply = await askGoogleAi(vals.apiKey, layer4GooglePrompt(customer, q, overview));
      } else {
        reply = await askPlatform(platform, vals, layer4Prompt(customer));
      }
      const rows = parseLayer4Reply(reply);
      if (rows.length) await this.replaceRows(project, platform, rows, 'api');
      st.status = rows.length >= L4_PER_PLATFORM ? 'complete' : rows.length ? 'partial' : 'failed';
      st.message = rows.length
        ? rows.length >= L4_PER_PLATFORM ? `${rows.length}/${L4_PER_PLATFORM} valid keywords stored.` : `${def.label} returned ${rows.length}/${L4_PER_PLATFORM} valid keywords.`
        : `${def.label} returned no valid keyword records (needs a JSON array with rank, keyword, intent, demand, est_volume). Existing keywords were kept.`;
    } catch (err) {
      st.status = 'failed';
      st.message = (err instanceof Error ? err.message : 'Run failed').slice(0, 380);
    }
    st.lastRunAt = new Date();
    await this.pf.save(st);
    await this.syncLayerStatus(project);
  }

  // ---- Automation: the set date (Day 4 of the Month Cycle) ----------------------------------------
  // Platform-major, one call at a time: every due customer on ChatGPT, then every due customer on Gemini, ...
  // Skips Manual platforms, platforms already attempted today and platforms already holding 10 keywords.
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
        if (!force && have >= L4_PER_PLATFORM) continue;
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
    if (!project) return { layer: 4, complete: false, month: null, total: 0, expected: AI_PLATFORMS.length * L4_PER_PLATFORM, html: '', platforms: [] };
    const rows = await this.kw.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
    const platforms = AI_PLATFORMS.map((p) => ({ platform: p.key, label: p.label, records: rows.filter((r) => r.platform === p.key) }));
    const complete = platforms.every((p) => p.records.length >= L4_PER_PLATFORM);
    const expected = AI_PLATFORMS.length * L4_PER_PLATFORM;
    if (!complete) return { layer: 4, complete: false, month: project.monthCode, total: rows.length, expected, html: '', platforms: [] };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const shown = platforms.map((p) => ({
      platform: p.platform,
      label: p.label,
      records: p.records.map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, demand: r.demand, volume: r.estVolume ?? null })),
    }));
    const body = shown
      .flatMap((p) => p.records.map((r) => `<tr><td>${esc(p.label)}</td><td>${r.rank}</td><td>${esc(r.keyword)}</td><td>${esc(r.intent)}</td><td>${esc(r.demand)}</td><td>${r.volume == null ? '—' : r.volume.toLocaleString('en-US')}</td></tr>`))
      .join('');
    const html = `<table class="kp21-l4"><thead><tr><th>AI platform</th><th>#</th><th>Keyword</th><th>Intent</th><th>Demand</th><th>Est. monthly searches</th></tr></thead><tbody>${body}</tbody></table>`;
    return { layer: 4, complete: true, month: project.monthCode, total: rows.length, expected, html, platforms: shown };
  }

  async removeByCustomer(customerId: string) {
    await this.kw.delete({ customerId });
    await this.pf.delete({ customerId });
  }
}
