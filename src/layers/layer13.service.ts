import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { Layer12Row, Layer12State, Layer13Row } from './layer12.entities';
import { logScore, round2, weightedAvailable } from './layer12.helpers';
import { fmt, stars } from './layer11master.service';

// Layer 13 - Intent & Opportunity Analysis (port of the plugin's layer13_dataset). Local, no API call: the Layer 12 evidence is carried forward
// unchanged and an Opportunity Score is added. Built automatically right after Layer 12 is complete.
export function opportunityOf(r: { layer12Weightage: number; estVolume: number | null; searchVolume: number | null; kd: number | null; competitorStrength: number | null }) {
  const w = weightedAvailable({
    layer12_validation: [r.layer12Weightage, 35],
    est_volume: [logScore(r.estVolume, 28), 12],
    market_volume: [logScore(r.searchVolume, 28), 12],
    kd_inverse: [r.kd !== null ? Math.max(0, 100 - r.kd) : null, 10],
    competitor_gap: [r.competitorStrength !== null ? Math.max(0, 100 - r.competitorStrength) : null, 8],
  });
  return { score: round2(w.score !== null ? w.score : r.layer12Weightage), used: Object.keys(w.used) };
}

@Injectable()
export class Layer13Service implements OnModuleInit {
  private readonly log = new Logger('Layer13');
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(Layer13Row) private readonly xr: Repository<Layer13Row>,
    @InjectRepository(Layer12Row) private readonly rr: Repository<Layer12Row>,
    @InjectRepository(Layer12State) private readonly sr: Repository<Layer12State>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

  onModuleInit() {
    this.layers.onDone(async (customerId, monthIndex, layerNo) => {
      if (layerNo !== 12) return;
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

  // Replaces the month's Layer 13 rows from its Layer 12 rows. Serialised per month.
  build(project: Project): Promise<number> {
    const run = (this.chain.get(project.id) || Promise.resolve()).catch(() => undefined).then(async () => {
      const src = await this.rr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } });
      const out = src.map((r) => {
        const o = opportunityOf({ layer12Weightage: r.weightage, estVolume: r.estVolume, searchVolume: r.searchVolume, kd: r.kd, competitorStrength: r.competitorStrength });
        return { r, o };
      });
      out.sort((a, b) => b.o.score - a.o.score || a.r.keyword.localeCompare(b.r.keyword));
      await this.xr.delete({ projectId: project.id });
      if (out.length) {
        await this.xr.save(out.map((x, i) => this.xr.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, rank: i + 1, keyword: x.r.keyword, keyNorm: x.r.keyNorm, intent: x.r.intent, demand: x.r.demand, estVolume: x.r.estVolume, searchVolume: x.r.searchVolume, kd: x.r.kd, cpc: x.r.cpc, competitorCount: x.r.competitorCount, competitorStrength: x.r.competitorStrength, layer12Weightage: x.r.weightage, layer12Star: x.r.starRating, opportunity: x.o.score, usedKpis: x.o.used, analysis: 'Layer 13 adds the Opportunity Score only; Layer 12 evidence is carried forward unchanged and no new API call is made.' })));
      }
      return out.length;
    });
    this.chain.set(project.id, run);
    return run;
  }

  // Build, then mark the Layer 13 row done (which starts Layer 14).
  async finish(project: Project) {
    try {
      const n = await this.build(project);
      this.log.log(`Layer 13 built for ${project.monthCode}: ${n} row(s)`);
      if (n > 0) await this.layers.setByMonth(project.customerId, project.monthIndex, 13, 'done');
    } catch (err) {
      this.log.error('Layer 13: ' + (err instanceof Error ? err.message : err));
    }
  }

  // Safety net (automation tick): any month whose Layer 12 is complete but that has no Layer 13 rows yet.
  async sweep(): Promise<number> {
    const done = await this.sr.find({ where: { status: 'complete' } });
    let built = 0;
    for (const d of done) {
      if (await this.xr.count({ where: { projectId: d.projectId } })) continue;
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
    if (!(await this.l12Complete(project.id))) throw new BadRequestException('Layer 12 must be complete before Layer 13 can be built.');
    await this.finish(project);
    return this.view(customerId, project.monthCode);
  }

  async view(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month);
    const [rows, l12] = await Promise.all([this.xr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.l12Complete(project.id)]);
    return { month: project.monthCode, total: rows.length, complete: rows.length > 0 && l12, layer12Complete: l12, records: rows.map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, demand: r.demand, searchVolume: r.searchVolume, kd: r.kd, cpc: r.cpc, competitorCount: r.competitorCount, competitorStrength: r.competitorStrength, layer12Weightage: r.layer12Weightage, opportunity: r.opportunity, star: r.layer12Star, usedKpis: r.usedKpis || [] })) };
  }

  async customerTable(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month).catch(() => null);
    if (!project) return { layer: 13, complete: false, month: null, total: 0, expected: 0, html: '', platforms: [] };
    const [rows, l12] = await Promise.all([this.xr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.l12Complete(project.id)]);
    const complete = rows.length > 0 && l12;
    return { layer: 13, complete, month: project.monthCode, total: rows.length, expected: 0, html: complete ? renderL13Html(rows) : '', platforms: [] };
  }

  async removeByCustomer(customerId: string) {
    await this.xr.delete({ customerId });
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));

export function renderL13Html(rows: Layer13Row[]): string {
  const head = ['Final Rating', 'Keyword', 'Primary Intent', 'Demand', 'Search Volume', 'KD', 'Competitors Found', 'Competitor Opportunity', 'Opportunity Score', 'Layer 12 Weightage', 'Star Rating'];
  const body = rows.map((r) => '<tr>' + [r.rank, r.keyword, r.intent, r.demand, fmt(r.searchVolume), r.kd, r.competitorCount, r.competitorStrength === null ? null : round2(Math.max(0, 100 - r.competitorStrength)), r.opportunity, r.layer12Weightage, stars(r.layer12Star)].map((c) => `<td>${dash(c)}</td>`).join('') + '</tr>').join('');
  return `<table class="kp21-l11 kp21-l13"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
