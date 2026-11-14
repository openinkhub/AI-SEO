import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { ConsolidatedRecord } from './consolidation.entities';
import { Layer12State, Layer14Row } from './layer12.entities';
import { Layer15Row } from './layer15.entities';
import { normKw } from './layer11.service';

// Layers 15, 16, 17 - Blog Intent Primary / Sub-Primary / Secondary: ALLOCATION ONLY (port of the plugin's layer15_17_allocate_rows and
// intents(), contract v8.9.152). Local, no API call. Built automatically right after Layer 14 is done.
export const L15_LAYERS = [15, 16, 17];
export const L15_SLOTS = 30;
export const L15_NAMES: Record<number, string> = { 15: 'Primary Blog Output', 16: 'Sub-Primary Blog Output', 17: 'Secondary Blog Output' };

// The pools a slot draws from: Layer 14 (H1 = fixed anchor, H2) and the consolidated Layer 5..10 blocks (11-B .. 11-G).
export const L15_POOLS: Array<{ key: string; field: 'h2' | 'h3' | 'h4' | 'paa' | 'similar' | 'faq' | 'quora'; block?: string }> = [
  { key: 'L14-H2', field: 'h2' },
  { key: '11B', field: 'h3', block: 'L5' },
  { key: '11C', field: 'h4', block: 'L6' },
  { key: '11D', field: 'paa', block: 'L7' },
  { key: '11E', field: 'similar', block: 'L8' },
  { key: '11F', field: 'faq', block: 'L9' },
  { key: '11G', field: 'quora', block: 'L10' },
];

export interface PoolItem { text: string; rank: number }

// Unique by normalised text, order kept (plugin: layer15_17_unique_rows).
export function uniqueItems(items: PoolItem[]): PoolItem[] {
  const seen = new Set<string>();
  const out: PoolItem[] = [];
  for (const i of items) {
    const t = String(i.text || '').trim();
    const n = normKw(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ text: t, rank: i.rank });
  }
  return out;
}

// Plugin: layer15_17_allocate_rows. Layer 15 starts at the top of the pool, Layer 16 at item 30, Layer 17 at item 60 (wrapping), so the
// three Layers together cover the whole pool; a pool shorter than 30 leaves the remaining slots blank (never a repeat inside a Layer).
export function allocate(pool: PoolItem[], layer: number, limit = L15_SLOTS): PoolItem[] {
  const rows = uniqueItems(pool);
  const n = rows.length;
  if (!n) return [];
  const take = Math.min(Math.max(0, limit), n);
  const start = ((Math.max(15, Math.min(17, layer)) - 15) * 30) % n;
  const out: PoolItem[] = [];
  for (let i = 0; i < take; i++) out.push(rows[(start + i) % n]);
  return out;
}

export interface SlotSet { slots: Layer15SlotLike[]; consumption: Record<string, { available: number; planned: number; allConsumed: boolean }>; duplicates: Record<string, string[]> }
export interface Layer15SlotLike { layerNo: number; blogNo: number; h1: string; h2: string; h3: string; h4: string; paa: string; similar: string; faq: string; quora: string; primaryKeyword: string; hierarchy: string; layer14Rank: number | null; sources: Record<string, number | null> }

// Pure: the 3 x 30 slots from the pools. `h1` is the Layer 14 rank-1 keyword (fixed anchor).
export function planSlots(h1: PoolItem | null, pools: Record<string, PoolItem[]>): SlotSet {
  const slots: Layer15SlotLike[] = [];
  const consumption: SlotSet['consumption'] = {};
  const duplicates: Record<string, string[]> = {};
  for (const layer of L15_LAYERS) {
    const alloc: Record<string, PoolItem[]> = {};
    for (const p of L15_POOLS) alloc[p.key] = allocate(pools[p.key] || [], layer);
    for (let i = 0; i < L15_SLOTS; i++) {
      const g = (k: string) => alloc[k][i] || null;
      const h2 = g('L14-H2');
      const h3 = g('11B');
      const primary = layer === 15 ? h1?.text || '' : layer === 16 ? h2?.text || h1?.text || '' : h3?.text || h1?.text || '';
      const hierarchy = layer === 15 ? 'H1' : layer === 16 ? (h2 ? 'H2' : 'H1') : h3 ? 'H3' : 'H1';
      const rank = layer === 15 ? h1?.rank ?? null : layer === 16 ? h2?.rank ?? h1?.rank ?? null : h3?.rank ?? h1?.rank ?? null;
      slots.push({
        layerNo: layer, blogNo: i + 1, h1: h1?.text || '', h2: h2?.text || '', h3: h3?.text || '', h4: g('11C')?.text || '', paa: g('11D')?.text || '', similar: g('11E')?.text || '', faq: g('11F')?.text || '', quora: g('11G')?.text || '',
        primaryKeyword: primary, hierarchy, layer14Rank: rank,
        sources: { H1: h1?.rank ?? null, H2: h2?.rank ?? null, '11B': h3?.rank ?? null, '11C': g('11C')?.rank ?? null, '11D': g('11D')?.rank ?? null, '11E': g('11E')?.rank ?? null, '11F': g('11F')?.rank ?? null, '11G': g('11G')?.rank ?? null },
      });
    }
  }
  for (const p of L15_POOLS) {
    const pool = uniqueItems(pools[p.key] || []);
    const used = new Set<string>();
    for (const l of L15_LAYERS) for (const r of allocate(pool, l)) used.add(normKw(r.text));
    consumption[p.key] = { available: pool.length, planned: used.size, allConsumed: used.size === pool.length };
    // Inside one Layer a value may not repeat.
    for (const l of L15_LAYERS) {
      const seen = new Set<string>();
      for (const s of slots.filter((x) => x.layerNo === l)) {
        const v = String((s as any)[p.field] || '').trim();
        if (!v) continue;
        const n = normKw(v);
        if (seen.has(n)) (duplicates[`${p.key}@L${l}`] = duplicates[`${p.key}@L${l}`] || []).push(v);
        else seen.add(n);
      }
    }
  }
  return { slots, consumption, duplicates };
}

@Injectable()
export class Layer15Service implements OnModuleInit {
  private readonly log = new Logger('Layer15');
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(Layer15Row) private readonly br: Repository<Layer15Row>,
    @InjectRepository(Layer14Row) private readonly fr: Repository<Layer14Row>,
    @InjectRepository(ConsolidatedRecord) private readonly cr: Repository<ConsolidatedRecord>,
    @InjectRepository(Layer12State) private readonly sr: Repository<Layer12State>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

  onModuleInit() {
    this.layers.onDone(async (customerId, monthIndex, layerNo) => {
      if (layerNo !== 14) return;
      const project = await this.projects.findOne({ where: { customerId, monthIndex } });
      if (project) await this.finish(project);
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

  private async pools(project: Project): Promise<{ h1: PoolItem | null; pools: Record<string, PoolItem[]> }> {
    const [l14, cons] = await Promise.all([this.fr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.cr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } })]);
    const h1row = l14.find((r) => r.hierarchy === 'H1') || l14[0];
    const pools: Record<string, PoolItem[]> = { 'L14-H2': l14.filter((r) => r !== h1row && r.hierarchy === 'H2').map((r) => ({ text: r.keyword, rank: r.rank })) };
    for (const p of L15_POOLS) if (p.block) pools[p.key] = cons.filter((c) => c.block === p.block).map((c) => ({ text: c.record, rank: c.rank }));
    return { h1: h1row ? { text: h1row.keyword, rank: h1row.rank } : null, pools };
  }

  // Replaces the month's 3 x 30 slots from the current Layer 14 and consolidated blocks. Serialised per month.
  build(project: Project): Promise<number> {
    const run = (this.chain.get(project.id) || Promise.resolve()).catch(() => undefined).then(async () => {
      const { h1, pools } = await this.pools(project);
      if (!h1) return 0;
      const plan = planSlots(h1, pools);
      await this.br.delete({ projectId: project.id });
      const rows = plan.slots.map((s) => this.br.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, layerNo: s.layerNo, blogNo: s.blogNo, h1: s.h1 || null, h2: s.h2 || null, h3: s.h3 || null, h4: s.h4 || null, paa: s.paa || null, similar: s.similar || null, faq: s.faq || null, quora: s.quora || null, primaryKeyword: s.primaryKeyword || null, hierarchy: s.hierarchy, layer14Rank: s.layer14Rank, blogIntro: null, blogIntent: null, metaTitle: null, metaTags: null, metaDescription: null, sources: s.sources }));
      for (let i = 0; i < rows.length; i += 100) await this.br.save(rows.slice(i, i + 100));
      return rows.length;
    });
    this.chain.set(project.id, run);
    return run;
  }

  // Build, then mark Layers 15, 16 and 17 done (each has its 30 slots).
  async finish(project: Project) {
    try {
      const n = await this.build(project);
      this.log.log(`Layers 15-17 built for ${project.monthCode}: ${n} slot(s)`);
      // Only a complete Layer 12 (the Layer 14 row is done) turns the schedule rows done; a partial month is built for the admin only.
      if (n > 0 && (await this.l12Complete(project.id))) for (const l of L15_LAYERS) await this.layers.setByMonth(project.customerId, project.monthIndex, l, 'done');
    } catch (err) {
      this.log.error('Layers 15-17: ' + (err instanceof Error ? err.message : err));
    }
  }

  // Safety net (automation tick): months that have Layer 14 rows but no Layer 15-17 slots yet.
  async sweep(): Promise<number> {
    const rows = await this.fr.createQueryBuilder('x').select('x.projectId', 'projectId').groupBy('x.projectId').getRawMany();
    let built = 0;
    for (const d of rows) {
      if (await this.br.count({ where: { projectId: d.projectId } })) continue;
      const project = await this.projects.findOne({ where: { id: d.projectId } });
      if (!project) continue;
      await this.finish(project);
      built++;
    }
    return built;
  }

  private async l12Complete(projectId: string): Promise<boolean> {
    return (await this.sr.findOne({ where: { projectId } }))?.status === 'complete';
  }

  async rebuild(customerId: string, month: string) {
    const project = await this.monthOf(customerId, month);
    if (!(await this.fr.count({ where: { projectId: project.id } }))) throw new BadRequestException('Layer 14 must be built before Layers 15-17.');
    if (await this.l12Complete(project.id)) await this.finish(project);
    else await this.build(project);
    return this.summary(customerId, project.monthCode);
  }

  // Admin: one Layer's 30 slots plus the allocation checks.
  async view(customerId: string, month: string | undefined, layerNo: number) {
    const project = await this.monthOf(customerId, month);
    const [rows, l12] = await Promise.all([this.br.find({ where: { projectId: project.id, layerNo }, order: { blogNo: 'ASC' } }), this.l12Complete(project.id)]);
    const { h1, pools } = await this.pools(project);
    const plan = h1 ? planSlots(h1, pools) : null;
    return {
      layer: layerNo, month: project.monthCode, total: rows.length, expected: L15_SLOTS, complete: rows.length === L15_SLOTS && l12, layer14Complete: l12,
      checks: plan ? { consumption: plan.consumption, duplicates: plan.duplicates, fixedH1: h1?.text || null } : null,
      records: rows.map((r) => ({ blogNo: r.blogNo, h1: r.h1, h2: r.h2, h3: r.h3, h4: r.h4, paa: r.paa, similar: r.similar, faq: r.faq, quora: r.quora, primaryKeyword: r.primaryKeyword, hierarchy: r.hierarchy, layer14Rank: r.layer14Rank, blogIntro: r.blogIntro, metaTitle: r.metaTitle, metaTags: r.metaTags, metaDescription: r.metaDescription })),
    };
  }

  async summary(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month);
    const out: Record<string, number> = {};
    for (const l of L15_LAYERS) out['layer' + l] = await this.br.count({ where: { projectId: project.id, layerNo: l } });
    return { month: project.monthCode, ...out };
  }

  async customerTable(customerId: string, month: string | undefined, layerNo: number) {
    const project = await this.monthOf(customerId, month).catch(() => null);
    if (!project) return { layer: layerNo, complete: false, month: null, total: 0, expected: L15_SLOTS, html: '', platforms: [] };
    const [rows, l12] = await Promise.all([this.br.find({ where: { projectId: project.id, layerNo }, order: { blogNo: 'ASC' } }), this.l12Complete(project.id)]);
    const complete = rows.length === L15_SLOTS && l12;
    return { layer: layerNo, complete, month: project.monthCode, total: rows.length, expected: L15_SLOTS, html: complete ? renderL15Html(layerNo, rows) : '', platforms: [] };
  }

  async removeByCustomer(customerId: string) {
    await this.br.delete({ customerId });
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));

// Customer grid (plugin: admin_blog_intents, customer view). Meta and intro columns fill in when Layers 18-20 write them.
export function renderL15Html(layerNo: number, rows: Layer15Row[]): string {
  const head = ['Blog Number', 'H1', 'H2', 'H3', 'H4', 'PAA', 'Similar Product / Service', 'FAQ', 'Quora', 'Meta Title', 'Meta Tag', 'Meta Description', 'Blog Introduction'];
  const body = rows.map((r) => '<tr>' + [`Blog ${r.blogNo}`, r.h1, r.h2, r.h3, r.h4, r.paa, r.similar, r.faq, r.quora, r.metaTitle, r.metaTags, r.metaDescription, r.blogIntro].map((c, i) => (i === 0 ? `<td><b>${esc(c)}</b></td>` : `<td>${dash(c)}</td>`)).join('') + '</tr>').join('');
  return `<table class="kp21-l11 kp21-l${layerNo}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
