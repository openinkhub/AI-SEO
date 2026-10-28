import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { CustomerApisService } from '../customer-apis/customer-apis.service';
import { GlobalApisService } from '../customer-apis/global-apis.service';
import { AI_PLATFORMS, AI_PLATFORM_KEYS, askGoogleAi, askPlatform } from './ai-platforms';
import { Layer4Keyword, Layer4Platform } from './layer4.entities';

export const L4_INTENTS = ['Informational', 'Navigational', 'Commercial', 'Transactional', 'Local', 'Purchase', 'Evaluational', 'Compliance'];
export const L4_DEMANDS = ['High', 'Medium-High', 'Medium', 'Low'];
export const L4_PER_PLATFORM = 10;
const STALE_RUN_MS = 10 * 60 * 1000;

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (value: string, allowed: string[]): string | null => allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase()) ?? null;

// Port of the plugin's Layer 4 prompt (KP21_Layers::prompt, $l === 4), same output contract.
export function layer4Prompt(c: Customer): string {
  const p = (c.profile || {}) as Record<string, any>;
  const line = (label: string, v: string) => `${label}: ${v}\n`;
  const body =
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
    line('Description', str(p.product_short_description) || str(p.company_profile));
  return (
    body +
    'You are an AI Search Keyword Research expert. Analyze the Industry, Sector, Products/Services, Product Description, Target Customer and Locations above to identify search keywords and queries users are likely to use when searching for these products, services and solutions ON YOUR PLATFORM ONLY. ' +
    'Do not search the web. Do not invent/create unrelated keywords. Research only from your platform/internal knowledge. Return EXACTLY 10 highly relevant records ranked from highest business/search opportunity to lowest. Avoid duplicates and near-duplicates. ' +
    `Allowed Intent values ONLY: ${L4_INTENTS.join(', ')}. Allowed Demand values ONLY: ${L4_DEMANDS.join(', ')}. ` +
    'Return ONLY a valid JSON array with EXACTLY these four keys per record: rank, keyword, intent, demand. Do not estimate or return search volume. Do not return primary_intent, secondary_intent, keyword_role, reason or any other field.'
  );
}

export interface KeywordRow { keyword: string; intent: string; demand: string }

// Reads the JSON array out of a model reply and keeps only valid, de-duplicated rows (max 10).
export function parseLayer4Reply(text: string): KeywordRow[] {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return [];
  let arr: any;
  try { arr = JSON.parse(text.slice(s, e + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const rows = arr
    .map((x: any, i: number) => ({ rank: Number(x?.rank) || i + 1, keyword: str(x?.keyword), intent: pick(str(x?.intent), L4_INTENTS), demand: pick(str(x?.demand), L4_DEMANDS) }))
    .filter((x) => x.keyword && x.intent && x.demand)
    .sort((a, b) => a.rank - b.rank);
  const seen = new Set<string>();
  const out: KeywordRow[] = [];
  for (const r of rows) {
    const n = norm(r.keyword);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ keyword: r.keyword.slice(0, 255), intent: r.intent as string, demand: r.demand as string });
    if (out.length >= L4_PER_PLATFORM) break;
  }
  return out;
}

// Manual entry: one per line, "keyword | Intent | Demand" (intent / demand optional -> Informational / Medium).
export function parseManualLines(text: string): KeywordRow[] {
  const seen = new Set<string>();
  const out: KeywordRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/\t|\|/).map((x) => x.trim());
    if (!parts[0]) continue;
    const n = norm(parts[0]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ keyword: parts[0].slice(0, 255), intent: pick(parts[1] || '', L4_INTENTS) || 'Informational', demand: pick(parts[2] || '', L4_DEMANDS) || 'Medium' });
    if (out.length >= L4_PER_PLATFORM) break;
  }
  return out;
}

@Injectable()
export class Layer4Service {
  private readonly log = new Logger('Layer4');

  constructor(
    @InjectRepository(Layer4Keyword) private readonly kw: Repository<Layer4Keyword>,
    @InjectRepository(Layer4Platform) private readonly pf: Repository<Layer4Platform>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly customerApis: CustomerApisService,
    private readonly globalApis: GlobalApisService,
  ) {}

  private async month(customerId: string, month: string): Promise<Project> {
    const idx = parseInt(String(month || '').replace(/^m/i, ''), 10);
    if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M3.');
    const p = await this.projects.findOne({ where: { customerId, monthIndex: idx } });
    if (!p) throw new NotFoundException(`Month M${idx} does not exist for this customer.`);
    return p;
  }

  private platform(key: string) {
    const p = AI_PLATFORMS.find((x) => x.key === key);
    if (!p) throw new BadRequestException(`Unknown platform. Use one of: ${AI_PLATFORM_KEYS.join(', ')}.`);
    return p;
  }

  // Everything the Layer 4 page shows: one block per platform with its keywords.
  async view(customerId: string, month: string) {
    const project = await this.month(customerId, month);
    const [rows, states, globalKeys, custKeys] = await Promise.all([
      this.kw.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }),
      this.pf.find({ where: { projectId: project.id } }),
      this.globalApis.getKeys(),
      this.customerApis.getKeys(customerId),
    ]);
    const platforms = AI_PLATFORMS.map((p) => {
      const st = states.find((s) => s.platform === p.key);
      const records = rows.filter((r) => r.platform === p.key).map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, demand: r.demand, source: r.source }));
      const mode = st?.mode || p.defaultMode;
      let status = st?.status || 'idle';
      if (status === 'running' && st?.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() > STALE_RUN_MS) status = 'failed';
      if (status === 'idle' && records.length) status = records.length >= L4_PER_PLATFORM ? 'complete' : 'partial';
      const keyReady = p.key === 'google_ai' ? !!custKeys.serpapi : p.globalKey ? !!globalKeys[p.keyProvider || p.key] : false;
      return { platform: p.key, label: p.label, mode, status, message: st?.message || '', count: records.length, expected: L4_PER_PLATFORM, keyReady, records };
    });
    return {
      month: project.monthCode,
      expected: AI_PLATFORMS.length * L4_PER_PLATFORM,
      total: platforms.reduce((a, p) => a + p.count, 0),
      completePlatforms: platforms.filter((p) => p.count >= L4_PER_PLATFORM).length,
      platforms,
    };
  }

  private async state(project: Project, platform: string): Promise<Layer4Platform> {
    const existing = await this.pf.findOne({ where: { projectId: project.id, platform } });
    if (existing) return existing;
    return this.pf.create({ customerId: project.customerId, projectId: project.id, platform, mode: this.platform(platform).defaultMode, status: 'idle', message: null, lastRunAt: null });
  }

  async setMode(customerId: string, month: string, platform: string, mode: string) {
    this.platform(platform);
    if (mode !== 'api' && mode !== 'manual') throw new BadRequestException('mode must be api or manual.');
    const project = await this.month(customerId, month);
    const st = await this.state(project, platform);
    st.mode = mode;
    await this.pf.save(st);
    return this.view(customerId, month);
  }

  private async replaceRows(project: Project, platform: string, rows: KeywordRow[], source: string) {
    await this.kw.delete({ projectId: project.id, platform });
    if (rows.length) {
      await this.kw.save(rows.map((r, i) => this.kw.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, platform, rank: i + 1, keyword: r.keyword, intent: r.intent, demand: r.demand, source })));
    }
  }

  async saveManual(customerId: string, month: string, platform: string, text: string) {
    this.platform(platform);
    const rows = parseManualLines(String(text || ''));
    if (!rows.length) throw new BadRequestException('Add at least one keyword, one per line: keyword | Intent | Demand.');
    const project = await this.month(customerId, month);
    await this.replaceRows(project, platform, rows, 'manual');
    const st = await this.state(project, platform);
    st.mode = 'manual';
    st.status = rows.length >= L4_PER_PLATFORM ? 'complete' : 'partial';
    st.message = `${rows.length}/${L4_PER_PLATFORM} keywords saved manually.`;
    st.lastRunAt = new Date();
    await this.pf.save(st);
    return this.view(customerId, month);
  }

  // Starts the run in the background (an AI call can take a minute); the page polls view().
  async startRun(customerId: string, month: string, platform: string) {
    const def = this.platform(platform);
    const project = await this.month(customerId, month);
    const st = await this.state(project, platform);
    if ((st.mode || def.defaultMode) === 'manual') throw new BadRequestException(`${def.label} is set to Manual - paste its keywords instead, or switch it to API.`);
    if (st.status === 'running' && st.lastRunAt && Date.now() - new Date(st.lastRunAt).getTime() < STALE_RUN_MS) throw new BadRequestException(`${def.label} is already running.`);
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found.');
    let vals: Record<string, string> | undefined;
    if (platform === 'google_ai') {
      vals = (await this.customerApis.getKeys(customerId)).serpapi;
      if (!vals) throw new BadRequestException('Google AI needs this customer\'s SerpApi key (Profile > API settings).');
    } else {
      const kp = def.keyProvider || platform;
      vals = (await this.globalApis.getKeys())[kp];
      if (!vals) throw new BadRequestException(`${def.label} has no key yet. Add and enable ${kp === platform ? def.label : 'OpenRouter'} in Global API Settings.`);
    }
    st.status = 'running';
    st.message = 'Asking ' + def.label + '…';
    st.lastRunAt = new Date();
    await this.pf.save(st);
    void this.execute(project, customer, platform, vals).catch((err) => this.log.error(`Layer 4 ${platform}: ${err?.message || err}`));
    return this.view(customerId, month);
  }

  private async execute(project: Project, customer: Customer, platform: string, vals: Record<string, string>) {
    const def = this.platform(platform);
    const st = await this.state(project, platform);
    try {
      const prompt = layer4Prompt(customer);
      const reply = platform === 'google_ai' ? await askGoogleAi(vals.apiKey, prompt) : await askPlatform(platform, vals, prompt);
      const rows = parseLayer4Reply(reply);
      if (rows.length) await this.replaceRows(project, platform, rows, 'api');
      st.status = rows.length >= L4_PER_PLATFORM ? 'complete' : rows.length ? 'partial' : 'failed';
      st.message = rows.length
        ? rows.length >= L4_PER_PLATFORM ? `${rows.length}/${L4_PER_PLATFORM} valid keywords stored.` : `${def.label} returned ${rows.length}/${L4_PER_PLATFORM} valid keywords (previous results for other rows were replaced).`
        : `${def.label} returned no valid keyword records (needs a JSON array with rank, keyword, intent, demand). Existing keywords were kept.`;
    } catch (err) {
      st.status = 'failed';
      st.message = (err instanceof Error ? err.message : 'Run failed').slice(0, 380);
    }
    st.lastRunAt = new Date();
    await this.pf.save(st);
  }

  // The SEO report's "AI Search Keywords": the latest month that has Layer 4 keywords, merged across platforms
  // (same keyword = one row listing every platform that returned it), most-agreed first.
  async reportKeywords(customerId: string): Promise<Array<{ keyword: string; intent: string; demand: string; platforms: string[] }>> {
    const rows = await this.kw.find({ where: { customerId }, order: { monthIndex: 'DESC', rank: 'ASC' } });
    if (!rows.length) return [];
    const latest = rows[0].monthIndex;
    const labels = new Map(AI_PLATFORMS.map((p) => [p.key, p.label]));
    const demandOrder = ['High', 'Medium-High', 'Medium', 'Low'];
    const by = new Map<string, { keyword: string; intent: string; demand: string; platforms: string[]; best: number }>();
    for (const r of rows.filter((x) => x.monthIndex === latest)) {
      const k = norm(r.keyword);
      const label = labels.get(r.platform) || r.platform;
      const cur = by.get(k);
      if (!cur) by.set(k, { keyword: r.keyword, intent: r.intent, demand: r.demand, platforms: [label], best: r.rank });
      else {
        if (!cur.platforms.includes(label)) cur.platforms.push(label);
        cur.best = Math.min(cur.best, r.rank);
        if (demandOrder.indexOf(r.demand) < demandOrder.indexOf(cur.demand)) cur.demand = r.demand;
      }
    }
    return [...by.values()]
      .sort((a, b) => b.platforms.length - a.platforms.length || a.best - b.best)
      .map(({ keyword, intent, demand, platforms }) => ({ keyword, intent, demand, platforms }));
  }

  async removeByCustomer(customerId: string) {
    await this.kw.delete({ customerId });
    await this.pf.delete({ customerId });
  }
}
