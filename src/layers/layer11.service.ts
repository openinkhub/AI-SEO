import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { AI_PLATFORMS } from './ai-platforms';
import { LayersService } from './layers.service';
import { ProjectLayer } from './project-layer.entity';
import { Layer4Keyword } from './layer4.entities';
import { Layer5Prompt } from './layer5.entities';
import { Layer6Keyword } from './layer6.entities';
import { Layer7Question } from './layer7.entities';
import { Layer8Item } from './layer8.entities';
import { Layer9Faq } from './layer9.entities';
import { Layer10Quora } from './layer10.entities';
import { Layer11Record } from './layer11.entities';

// Layer 11 - Keyword Analysis: one consolidated block per source Layer, numbered by the ORIGINAL Layer (Layer 4 .. Layer 10). Port of the plugin's layer11_consolidate_source.
// Each block is built automatically right after its source Layer is complete (the Layer 4 block right after Layer 4, the Layer 5 block after Layer 5, ...).
// 11-AA (seed + competitor + Quora keywords) and 11-AAA (master keywords) need Keywords Everywhere / Mangools and are not built yet.
export interface BlockDef { block: string; layer: number; label: string; max: number }
const PER = AI_PLATFORMS.length * 10;
export const L11_BLOCKS: BlockDef[] = [
  { block: 'L4', layer: 4, label: 'Layer 4 - AI Search Keywords', max: PER },
  { block: 'L5', layer: 5, label: 'Layer 5 - AI Search Prompts', max: PER },
  { block: 'L6', layer: 6, label: 'Layer 6 - Long-Tail Keywords', max: PER },
  { block: 'L7', layer: 7, label: 'Layer 7 - Google People Also Ask', max: 30 },
  { block: 'L8', layer: 8, label: 'Layer 8 - Similar Products / Services', max: PER },
  { block: 'L9', layer: 9, label: 'Layer 9 - FAQ & Answers', max: PER },
  { block: 'L10', layer: 10, label: 'Layer 10 - Quora Q&A Insights', max: PER },
];
export const L11_SOURCE_LAYERS = L11_BLOCKS.map((b) => b.layer);

export interface SrcRow { platform: string; value: string; intent: string; demand: string; est: number | null; extra: Record<string, any> }
export interface Consolidated { rank: number; record: string; intent: string; demand: string; weightage: number; star: number; occurrences: number; platforms: string[]; est: number | null; extra: Record<string, any>; overview: string }

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9À-ɏ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;
const REL: Record<string, number> = { High: 100, 'Very High': 100, 'Medium-High': 85, Medium: 70, Low: 45 };

// Weighted mean over the metrics that have a value (same as the plugin's weighted_available).
function weighted(metrics: Record<string, [number | null, number]>): number | null {
  let sum = 0;
  let w = 0;
  for (const [v, wt] of Object.values(metrics)) {
    if (v === null || !Number.isFinite(v) || wt <= 0) continue;
    sum += Math.max(0, Math.min(100, v)) * wt;
    w += wt;
  }
  return w ? round2(sum / w) : null;
}
export const starFromWeightage = (w: number): number => Math.max(1, Math.min(5, Math.ceil(Math.max(1, Math.max(0, Math.min(100, w))) / 20)));

// Pure consolidation of one source Layer's rows: de-duplicate, score, sort, rank. `l4` is only used for Layer 7
// (a People Also Ask question takes the intent/demand of the Layer 4 keyword it was searched for).
export function consolidateRows(layer: number, rows: SrcRow[], l4: Array<{ keyword: string; intent: string; demand: string }>): Consolidated[] {
  const max = L11_BLOCKS.find((b) => b.layer === layer)?.max ?? PER;
  const map = new Map<string, { record: string; intents: Map<string, number>; demands: Map<string, number>; platforms: Set<string>; occ: number; est: number[]; first: SrcRow }>();
  for (const r of rows) {
    const v = (r.value || '').trim();
    const n = norm(v);
    if (!v || !n) continue;
    let x = map.get(n);
    if (!x) { x = { record: v, intents: new Map(), demands: new Map(), platforms: new Set(), occ: 0, est: [], first: r }; map.set(n, x); }
    x.occ++;
    if (r.platform) x.platforms.add(r.platform);
    if (r.intent) x.intents.set(r.intent, (x.intents.get(r.intent) || 0) + 1);
    if (r.demand) x.demands.set(r.demand, (x.demands.get(r.demand) || 0) + 1);
    if ([4, 5, 6].includes(layer) && r.est !== null && Number.isFinite(r.est)) x.est.push(Math.max(0, r.est));
  }
  const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const out: Array<Omit<Consolidated, 'rank'>> = [];
  for (const x of map.values()) {
    const pc = x.platforms.size;
    const app = layer === 7 || layer === 10 ? 1 : AI_PLATFORMS.length;
    const coverage = Math.min(100, (100 * Math.max(1, pc)) / app);
    const est = x.est.length ? Math.round(x.est.reduce((a, b) => a + b, 0) / x.est.length) : null;
    const f = x.first;
    let intent = byCount(x.intents).join(' / ') || f.intent || '';
    let demand = byCount(x.demands).slice(0, 2).join(' / ') || f.demand || '';
    const extra: Record<string, any> = { ...f.extra };
    if (layer === 7) {
      const q = String(extra.search_query || '').trim().toLowerCase();
      const m = q ? l4.find((k) => k.keyword.trim().toLowerCase() === q) : undefined;
      if (m) { intent = m.intent; demand = m.demand; }
    }
    if ([8, 9, 10].includes(layer)) { intent = String(extra.search_intent || intent); demand = String(extra.relevance || demand); }
    const rel = REL[demand] ?? null;
    let metrics: Record<string, [number | null, number]> = { source_coverage: [coverage, 50] };
    if ([4, 5, 6].includes(layer)) metrics.est_volume = [est !== null ? Math.min(100, Math.log10(Math.max(1, est) + 1) * 28) : null, 50];
    else if (layer === 8 || layer === 9) metrics.relevance = [rel, 50];
    else if (layer === 10) metrics = { relevance: [rel, 35], primary_keyword: [extra.primary_keyword ? 100 : null, 25], search_intent: [extra.search_intent ? 85 : null, 20], topic: [extra.topic ? 80 : null, 10], provenance: [extra.quora_url ? 100 : null, 10] };
    else if (layer === 7) metrics = { intent: [intent !== '' ? 80 : null, 50], demand: [rel, 50] };
    const w = weighted(metrics);
    // No usable metric: a Layer 7 question with no matching Layer 4 keyword gets a neutral 60 (coverage is always 100 for it and would rank it first).
    const weight = w !== null ? w : layer === 7 ? 60 : coverage;
    out.push({ record: x.record, intent, demand, weightage: round2(weight), star: starFromWeightage(weight), occurrences: x.occ, platforms: [...x.platforms], est, extra, overview: `Consolidated from ${x.occ} source record(s); duplicate/near-identical evidence merged.` });
  }
  out.sort((a, b) => (b.weightage - a.weightage) || (a.record < b.record ? -1 : a.record > b.record ? 1 : 0));
  return out.slice(0, max).map((o, i) => ({ ...o, rank: i + 1 }));
}

const platformIdx = (p: string): number => {
  const i = AI_PLATFORMS.findIndex((x) => x.key === p);
  return i < 0 ? 99 : i;
};

@Injectable()
export class Layer11Service implements OnModuleInit {
  private readonly log = new Logger('Layer11');
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(Layer11Record) private readonly rec: Repository<Layer11Record>,
    @InjectRepository(ProjectLayer) private readonly pl: Repository<ProjectLayer>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Layer4Keyword) private readonly l4: Repository<Layer4Keyword>,
    @InjectRepository(Layer5Prompt) private readonly l5: Repository<Layer5Prompt>,
    @InjectRepository(Layer6Keyword) private readonly l6: Repository<Layer6Keyword>,
    @InjectRepository(Layer7Question) private readonly l7: Repository<Layer7Question>,
    @InjectRepository(Layer8Item) private readonly l8: Repository<Layer8Item>,
    @InjectRepository(Layer9Faq) private readonly l9: Repository<Layer9Faq>,
    @InjectRepository(Layer10Quora) private readonly l10: Repository<Layer10Quora>,
    private readonly layers: LayersService,
  ) {}

  onModuleInit() {
    // "Just after its original Layer is completed": LayersService calls this whenever a Layer 4-10 row is set to done.
    this.layers.onDone(async (customerId, monthIndex, layerNo) => {
      if (!L11_SOURCE_LAYERS.includes(layerNo)) return;
      await this.onSourceDone(customerId, monthIndex, layerNo);
    });
  }

  async monthOf(customerId: string, month?: string): Promise<Project> {
    if (month) {
      const idx = parseInt(String(month).replace(/^m/i, ''), 10);
      if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M3.');
      const p = await this.projects.findOne({ where: { customerId, monthIndex: idx } });
      if (!p) throw new NotFoundException(`Month M${idx} does not exist for this customer.`);
      return p;
    }
    const today = todayInTz();
    const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
    const p = all.find((x) => x.monthStartDate && x.monthEndDate && x.monthStartDate <= today && today <= x.monthEndDate) || all[0];
    if (!p) throw new NotFoundException('This customer has no months yet.');
    return p;
  }

  // Source rows of one Layer, in platform order then rank, as plain SrcRow objects.
  private async load(project: Project, layer: number): Promise<SrcRow[]> {
    const where = { projectId: project.id };
    const order = { rank: 'ASC' as const };
    const sort = (a: SrcRow & { rank: number }, b: SrcRow & { rank: number }) => platformIdx(a.platform) - platformIdx(b.platform) || a.rank - b.rank;
    let rows: Array<SrcRow & { rank: number }> = [];
    if (layer === 4) rows = (await this.l4.find({ where, order })).map((r) => ({ platform: r.platform, rank: r.rank, value: r.keyword, intent: r.intent, demand: r.demand, est: r.estVolume, extra: {} }));
    else if (layer === 5) rows = (await this.l5.find({ where, order })).map((r) => ({ platform: r.platform, rank: r.rank, value: r.prompt, intent: r.intent, demand: r.demand, est: r.estVolume, extra: { volume_query: r.volumeQuery || '', prompt_type: r.promptType } }));
    else if (layer === 6) rows = (await this.l6.find({ where, order })).map((r) => ({ platform: r.platform, rank: r.rank, value: r.keyword, intent: r.intent, demand: r.demand, est: r.estVolume, extra: { keyword_type: r.keywordType } }));
    else if (layer === 7) rows = (await this.l7.find({ where, order })).map((r) => ({ platform: '', rank: r.rank, value: r.question, intent: '', demand: '', est: null, extra: { search_query: r.searchQuery, source: r.source || 'Google People Also Ask', source_url: r.sourceUrl || '' } }));
    else if (layer === 8) rows = (await this.l8.find({ where, order })).map((r) => ({ platform: r.platform, rank: r.rank, value: r.item, intent: r.searchIntent, demand: r.relevance, est: null, extra: { relationship_type: r.relationshipType, search_intent: r.searchIntent, relevance: r.relevance } }));
    else if (layer === 9) rows = (await this.l9.find({ where, order })).map((r) => ({ platform: r.platform, rank: r.rank, value: r.question, intent: r.searchIntent, demand: r.relevance, est: null, extra: { faq_type: r.faqType, search_intent: r.searchIntent, customer_journey: r.customerJourney, relevance: r.relevance } }));
    else if (layer === 10) rows = (await this.l10.find({ where, order })).map((r) => ({ platform: r.platform, rank: r.rank, value: r.question, intent: r.searchIntent, demand: r.relevance, est: null, extra: { topic: r.topic, primary_keyword: r.primaryKeyword, search_intent: r.searchIntent, relevance: r.relevance, quora_url: r.quoraUrl } }));
    return rows.sort(sort);
  }

  // Builds (replaces) one block from its source Layer. Serialised per month+block so overlapping triggers cannot collide.
  build(project: Project, layer: number): Promise<number> {
    const def = L11_BLOCKS.find((b) => b.layer === layer);
    if (!def) return Promise.reject(new BadRequestException('Layer ' + layer + ' has no Layer 11 block.'));
    const key = project.id + ':' + def.block;
    const run = (this.chain.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
      const src = await this.load(project, layer);
      const l4 = layer === 7 ? (await this.l4.find({ where: { projectId: project.id }, order: { rank: 'ASC' } })).map((k) => ({ keyword: k.keyword, intent: k.intent, demand: k.demand })) : [];
      const out = consolidateRows(layer, src, l4);
      await this.rec.delete({ projectId: project.id, block: def.block });
      if (out.length) {
        await this.rec.save(out.map((o) => this.rec.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, block: def.block, rank: o.rank, record: o.record.slice(0, 500), intent: o.intent ? o.intent.slice(0, 255) : null, demand: o.demand ? o.demand.slice(0, 120) : null, weightage: o.weightage, starRating: o.star, occurrences: o.occurrences, platforms: o.platforms, estVolume: o.est, extra: o.extra, overview: o.overview })));
      }
      return out.length;
    });
    this.chain.set(key, run);
    return run;
  }

  async onSourceDone(customerId: string, monthIndex: number, layerNo: number) {
    try {
      const project = await this.projects.findOne({ where: { customerId, monthIndex } });
      if (!project) return;
      const n = await this.build(project, layerNo);
      if (n) await this.layers.markInProgress(customerId, monthIndex, 11);
      this.log.log(`Layer 11 block ${L11_BLOCKS.find((b) => b.layer === layerNo)?.block} built for ${project.monthCode}: ${n} row(s)`);
    } catch (err) {
      this.log.error(`Layer 11 build (source Layer ${layerNo}): ${err instanceof Error ? err.message : err}`);
    }
  }

  // Safety net (runs with the automation tick): builds any block whose source Layer is done but that has no rows yet.
  async sweep(): Promise<number> {
    const done = await this.pl.find({ where: { layerNo: In(L11_SOURCE_LAYERS), status: 'done' } });
    if (!done.length) return 0;
    const counts = await this.rec.createQueryBuilder('r').select('r.projectId', 'projectId').addSelect('r.block', 'block').addSelect('COUNT(*)', 'n').groupBy('r.projectId').addGroupBy('r.block').getRawMany();
    const have = new Set(counts.map((c: any) => c.projectId + ':' + c.block));
    let built = 0;
    for (const d of done) {
      const def = L11_BLOCKS.find((b) => b.layer === d.layerNo);
      if (!def || have.has(d.projectId + ':' + def.block)) continue;
      await this.onSourceDone(d.customerId, d.monthIndex, d.layerNo);
      built++;
    }
    return built;
  }

  // Admin: rebuild every block whose source Layer is done (button on the Layer 11 card).
  async rebuild(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month);
    const rows = await this.pl.find({ where: { projectId: project.id, layerNo: In(L11_SOURCE_LAYERS), status: 'done' } });
    for (const r of rows) await this.onSourceDone(customerId, project.monthIndex, r.layerNo);
    return this.view(customerId, project.monthCode);
  }

  private async state(project: Project) {
    const [rows, srcs] = await Promise.all([
      this.rec.find({ where: { projectId: project.id }, order: { block: 'ASC', rank: 'ASC' } }),
      this.pl.find({ where: { projectId: project.id, layerNo: In(L11_SOURCE_LAYERS) } }),
    ]);
    return L11_BLOCKS.map((b) => {
      const status = srcs.find((s) => s.layerNo === b.layer)?.status || 'pending';
      const records = rows.filter((r) => r.block === b.block);
      return { def: b, sourceStatus: status, records, complete: status === 'done' && records.length > 0 };
    });
  }

  // Admin view.
  async view(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month);
    const st = await this.state(project);
    const blocks = st.map((s) => ({
      block: s.def.block,
      label: s.def.label,
      sourceLayer: s.def.layer,
      sourceStatus: s.sourceStatus,
      complete: s.complete,
      count: s.records.length,
      records: s.records.map((r) => ({ rank: r.rank, record: r.record, intent: r.intent, demand: r.demand, weightage: r.weightage, star: r.starRating, occurrences: r.occurrences, estVolume: r.estVolume, extra: r.extra || {} })),
    }));
    return { month: project.monthCode, completeBlocks: blocks.filter((b) => b.complete).length, totalBlocks: blocks.length, blocks, pending: ['11-AA (seed + competitor + Quora keywords)', '11-AAA (master keywords)'] };
  }

  // Customer panel (WordPress): the finished blocks. A block is shown only while its source Layer is complete.
  async customerTable(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month).catch(() => null);
    if (!project) return { layer: 11, complete: false, month: null, completeBlocks: 0, totalBlocks: L11_BLOCKS.length, blocks: [] };
    const st = await this.state(project);
    const blocks = st.map((s) => ({
      block: s.def.block,
      label: s.def.label,
      sourceLayer: s.def.layer,
      complete: s.complete,
      total: s.records.length,
      html: s.complete ? renderBlockHtml(s.def.block, s.records) : '',
    }));
    const completeBlocks = blocks.filter((b) => b.complete).length;
    return { layer: 11, complete: completeBlocks === blocks.length, month: project.monthCode, completeBlocks, totalBlocks: blocks.length, blocks };
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));

// The customer-facing table of one block (same columns as the plugin's Layer 11 tables; Google volume is not available yet).
export function renderBlockHtml(block: string, rows: Layer11Record[]): string {
  const ex = (r: Layer11Record, k: string) => (r.extra || {})[k];
  let head: string[] = [];
  let cells: (r: Layer11Record) => unknown[] = () => [];
  if (block === 'L4' || block === 'L5' || block === 'L6') {
    head = ['Final Rating', block === 'L4' ? 'Keyword' : block === 'L5' ? 'AI Prompt' : 'Long-Tail Keyword', 'Intent', 'Demand', 'Est Volume', 'Weightage', 'Star Rating', 'AI Overview'];
    cells = (r) => [r.rank, r.record, r.intent, r.demand, r.estVolume === null ? null : r.estVolume.toLocaleString('en-US'), r.weightage, stars(r.starRating), r.overview];
  } else if (block === 'L7') {
    head = ['Final Rating', 'PAA Question', 'Intent', 'Demand', 'Weightage', 'Star Rating', 'AI Overview'];
    cells = (r) => [r.rank, r.record, r.intent, r.demand, r.weightage, stars(r.starRating), r.overview];
  } else if (block === 'L8') {
    head = ['Final Rating', 'Similar Product / Service', 'Relationship Type', 'Search Intent', 'Relevance', 'Weightage', 'Star Rating', 'AI Overview'];
    cells = (r) => [r.rank, r.record, ex(r, 'relationship_type'), ex(r, 'search_intent'), ex(r, 'relevance'), r.weightage, stars(r.starRating), r.overview];
  } else if (block === 'L9') {
    head = ['Final Rating', 'FAQ Question', 'FAQ Type', 'Search Intent', 'Customer Journey', 'Relevance', 'Weightage', 'Star Rating', 'AI Overview'];
    cells = (r) => [r.rank, r.record, ex(r, 'faq_type'), ex(r, 'search_intent'), ex(r, 'customer_journey'), ex(r, 'relevance'), r.weightage, stars(r.starRating), r.overview];
  } else {
    head = ['Final Rating', 'Quora Question', 'Topic', 'Primary Keyword', 'Search Intent', 'Relevance', 'Quora URL', 'Weightage', 'Star Rating'];
    cells = (r) => [r.rank, r.record, ex(r, 'topic'), ex(r, 'primary_keyword'), ex(r, 'search_intent'), ex(r, 'relevance'), ex(r, 'quora_url'), r.weightage, stars(r.starRating)];
  }
  const body = rows.map((r) => '<tr>' + cells(r).map((c, i) => '<td>' + (block === 'L10' && i === 6 && c ? `<a href="${esc(c)}" rel="nofollow noopener">${esc(c)}</a>` : dash(c)) + '</td>').join('') + '</tr>').join('');
  return `<table class="kp21-l11"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
