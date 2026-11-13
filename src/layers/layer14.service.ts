import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { Layer12State, Layer13Row, Layer14Row } from './layer12.entities';
import { logScore, round2, weightedAvailable } from './layer12.helpers';
import { starOf } from './layer11.service';
import { fmt, stars } from './layer11master.service';

// Layer 14 - Keyword Weighted Selection (port of the plugin's layer14, v8.9.39 hierarchy): the final keyword ranking from Layer 13.
// Rank 1 = H1, rank 2 onward = H2, at most 80. Local, no API call; built automatically right after Layer 13.
export const L14_MAX = 80;
export function finalWeightOf(r: { opportunity: number; layer12Weightage: number; estVolume: number | null; searchVolume: number | null; kd: number | null }) {
  const w = weightedAvailable({
    opportunity_score: [r.opportunity, 45],
    layer12_validation: [r.layer12Weightage, 20],
    est_volume: [logScore(r.estVolume, 28), 15],
    market_volume: [logScore(r.searchVolume, 28), 7],
    kd_inverse: [r.kd !== null ? Math.max(0, 100 - r.kd) : null, 5],
  });
  return { score: round2(w.score !== null ? w.score : r.opportunity), used: Object.keys(w.used) };
}

@Injectable()
export class Layer14Service implements OnModuleInit {
  private readonly log = new Logger('Layer14');
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(Layer14Row) private readonly fr: Repository<Layer14Row>,
    @InjectRepository(Layer13Row) private readonly xr: Repository<Layer13Row>,
    @InjectRepository(Layer12State) private readonly sr: Repository<Layer12State>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

  onModuleInit() {
    this.layers.onDone(async (customerId, monthIndex, layerNo) => {
      if (layerNo !== 13) return;
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

  build(project: Project): Promise<number> {
    const run = (this.chain.get(project.id) || Promise.resolve()).catch(() => undefined).then(async () => {
      const src = await this.xr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
      const out = src.map((r) => ({ r, f: finalWeightOf(r) }));
      out.sort((a, b) => b.f.score - a.f.score || a.r.keyword.localeCompare(b.r.keyword));
      const top = out.slice(0, L14_MAX);
      await this.fr.delete({ projectId: project.id });
      if (top.length) {
        await this.fr.save(top.map((x, i) => this.fr.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, rank: i + 1, keyword: x.r.keyword, keyNorm: x.r.keyNorm, hierarchy: i === 0 ? 'H1' : 'H2', intent: x.r.intent, demand: x.r.demand, searchVolume: x.r.searchVolume, kd: x.r.kd, opportunity: x.r.opportunity, weightage: x.f.score, starRating: starOf(x.f.score), layer13Rank: x.r.rank, usedKpis: x.f.used, overview: 'Final weightage = Layer 13 Opportunity Score plus the available Layer 12 evidence; missing KPI weights are redistributed.' })));
      }
      return top.length;
    });
    this.chain.set(project.id, run);
    return run;
  }

  async finish(project: Project) {
    try {
      const n = await this.build(project);
      this.log.log(`Layer 14 built for ${project.monthCode}: ${n} row(s)`);
      if (n > 0) await this.layers.setByMonth(project.customerId, project.monthIndex, 14, 'done');
    } catch (err) {
      this.log.error('Layer 14: ' + (err instanceof Error ? err.message : err));
    }
  }

  // Safety net (automation tick): months that have Layer 13 rows but no Layer 14 rows.
  async sweep(): Promise<number> {
    const rows = await this.xr.createQueryBuilder('x').select('x.projectId', 'projectId').groupBy('x.projectId').getRawMany();
    let built = 0;
    for (const d of rows) {
      if (await this.fr.count({ where: { projectId: d.projectId } })) continue;
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
    if (!(await this.xr.count({ where: { projectId: project.id } }))) throw new BadRequestException('Layer 13 must be built before Layer 14.');
    await this.finish(project);
    return this.view(customerId, project.monthCode);
  }

  async view(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, l12] = await Promise.all([this.fr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.l12Complete(project.id)]);
    return { month: project.monthCode, total: rows.length, complete: rows.length > 0 && l12, layer12Complete: l12, records: rows.map((r) => ({ rank: r.rank, keyword: r.keyword, hierarchy: r.hierarchy, intent: r.intent, demand: r.demand, searchVolume: r.searchVolume, kd: r.kd, opportunity: r.opportunity, weightage: r.weightage, star: r.starRating, layer13Rank: r.layer13Rank })) };
  }

  async customerTable(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month).catch(() => null);
    if (!project) return { layer: 14, complete: false, month: null, total: 0, expected: 0, html: '', platforms: [] };
    const [rows, l12] = await Promise.all([this.fr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.l12Complete(project.id)]);
    const complete = rows.length > 0 && l12;
    return { layer: 14, complete, month: project.monthCode, total: rows.length, expected: 0, html: complete ? renderL14Html(rows) : '', platforms: [] };
  }

  async removeByCustomer(customerId: string) {
    await this.fr.delete({ customerId });
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));

export function renderL14Html(rows: Layer14Row[]): string {
  const head = ['Final Rating', 'Keyword', 'Hierarchy', 'Primary Intent', 'Demand', 'Search Volume', 'KD', 'Opportunity Score', 'Weightage', 'Star Rating'];
  const body = rows.map((r) => '<tr>' + [r.rank, r.keyword, r.hierarchy, r.intent, r.demand, fmt(r.searchVolume), r.kd, r.opportunity, r.weightage, stars(r.starRating)].map((c) => `<td>${dash(c)}</td>`).join('') + '</tr>').join('');
  return `<table class="kp21-l11 kp21-l14"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
