import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { Layer12State } from './layer12.entities';
import { WpLayerCopy, WpLayerRow } from './wp-layer-copy.entities';

// Copies a month's Layers 15-20 out of the WordPress plugin as they are: the browser sends each table exactly as shown (header row + cell
// text); nothing is recomputed. Expected sizes: Layers 15-17 = 30 blogs, Layers 18-20 = 240 dated rows.
export type Grid = string[][];
export interface WpLayersBody { month: string; layers: Record<string, Grid> }
export const WP_COPY_LAYERS = [15, 16, 17, 18, 19, 20];
export const WP_COPY_EXPECTED: Record<number, number> = { 15: 30, 16: 30, 17: 30, 18: 240, 19: 240, 20: 240 };
const CONTROL_COLUMNS = new Set(['admin', 'action']);
const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

@Injectable()
export class WpLayerCopyService {
  private readonly log = new Logger('WpLayerCopy');

  constructor(
    @InjectRepository(WpLayerCopy) private readonly cr: Repository<WpLayerCopy>,
    @InjectRepository(WpLayerRow) private readonly rr: Repository<WpLayerRow>,
    @InjectRepository(Layer12State) private readonly sr: Repository<Layer12State>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

  private async monthOf(customerId: string, month?: string): Promise<Project> {
    if (month) {
      const idx = parseInt(String(month).replace(/^m/i, ''), 10);
      if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M0.');
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

  async importWp(customerId: string, body: WpLayersBody) {
    const idx = parseInt(String(body?.month || '').replace(/^m/i, ''), 10);
    if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M0.');
    const project = await this.projects.findOne({ where: { customerId, monthIndex: idx } });
    if (!project) throw new NotFoundException(`Month M${idx} does not exist for this customer.`);
    const out: Record<string, number> = {};
    for (const key of Object.keys(body.layers || {})) {
      const layerNo = parseInt(key, 10);
      if (!WP_COPY_LAYERS.includes(layerNo)) throw new BadRequestException(`Layer ${key} cannot be copied (15-20 only).`);
      const grid = body.layers[key];
      if (!Array.isArray(grid) || grid.length < 2) throw new BadRequestException(`Layer ${layerNo}: table is empty.`);
      const head = grid[0].map(clean);
      const keep = head.map((h, i) => (h && !CONTROL_COLUMNS.has(h.toLowerCase()) ? i : -1)).filter((i) => i >= 0);
      const columns = keep.map((i) => head[i]);
      const rows = grid.slice(1).filter((r) => Array.isArray(r) && r.some((c) => clean(c))).map((r) => keep.map((i) => clean(r[i])));
      if (!rows.length) throw new BadRequestException(`Layer ${layerNo}: no data rows.`);
      await this.cr.delete({ projectId: project.id, layerNo });
      await this.rr.delete({ projectId: project.id, layerNo });
      await this.cr.save(this.cr.create({ customerId, projectId: project.id, monthIndex: project.monthIndex, layerNo, columns, rowCount: rows.length, source: 'WP plugin' }));
      const recs = rows.map((cells, i) => this.rr.create({ projectId: project.id, layerNo, rowNo: i + 1, cells }));
      for (let i = 0; i < recs.length; i += 100) await this.rr.save(recs.slice(i, i + 100));
      out['layer' + layerNo] = rows.length;
      await this.layers.setByMonth(customerId, project.monthIndex, layerNo, 'done');
    }
    this.log.log(`Copied ${project.monthCode} Layers ${Object.keys(out).join(',')}: ${JSON.stringify(out)}`);
    return { month: project.monthCode, ...out };
  }

  async get(customerId: string, month: string | undefined, layerNo: number) {
    const project = await this.monthOf(customerId, month);
    const meta = await this.cr.findOne({ where: { projectId: project.id, layerNo } });
    if (!meta) return null;
    const rows = await this.rr.find({ where: { projectId: project.id, layerNo }, order: { rowNo: 'ASC' } });
    return { layer: layerNo, month: project.monthCode, source: meta.source, columns: meta.columns, rowCount: meta.rowCount, expected: WP_COPY_EXPECTED[layerNo], rows: rows.map((r) => r.cells), copiedAt: meta.updatedAt };
  }

  async has(customerId: string, month: string | undefined, layerNo: number): Promise<boolean> {
    const project = await this.monthOf(customerId, month).catch(() => null);
    return !!project && (await this.cr.count({ where: { projectId: project.id, layerNo } })) > 0;
  }

  // Customer grid; shown once the month's Layer 12 is complete (same rule as Layers 12-14).
  async customerTable(customerId: string, month: string | undefined, layerNo: number) {
    const expected = WP_COPY_EXPECTED[layerNo] || 0;
    const project = await this.monthOf(customerId, month).catch(() => null);
    if (!project) return { layer: layerNo, complete: false, month: null, total: 0, expected, html: '', platforms: [] };
    const [meta, l12] = await Promise.all([this.cr.findOne({ where: { projectId: project.id, layerNo } }), this.sr.findOne({ where: { projectId: project.id } })]);
    if (!meta) return { layer: layerNo, complete: false, month: project.monthCode, total: 0, expected, html: '', platforms: [] };
    const complete = meta.rowCount === expected && l12?.status === 'complete';
    const rows = complete ? await this.rr.find({ where: { projectId: project.id, layerNo }, order: { rowNo: 'ASC' } }) : [];
    return { layer: layerNo, complete, month: project.monthCode, total: meta.rowCount, expected, html: complete ? renderCopyHtml(layerNo, meta.columns, rows.map((r) => r.cells)) : '', platforms: [] };
  }

  async removeByCustomer(customerId: string) {
    const metas = await this.cr.find({ where: { customerId } });
    for (const m of metas) await this.rr.delete({ projectId: m.projectId, layerNo: m.layerNo });
    await this.cr.delete({ customerId });
  }
}

export function renderCopyHtml(layerNo: number, columns: string[], rows: string[][]): string {
  const body = rows.map((r) => '<tr>' + r.map((c, i) => (i === 0 ? `<td><b>${esc(c)}</b></td>` : `<td>${c ? esc(c) : '—'}</td>`)).join('') + '</tr>').join('');
  return `<table class="kp21-l11 kp21-l${layerNo}"><thead><tr>${columns.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
