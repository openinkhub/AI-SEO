import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { LayersService } from './layers.service';
import { ConsolidatedRecord } from './consolidation.entities';
import { Layer11Keyword } from './layer11.entities';
import { Layer11Master } from './layer12.entities';
import { inferIntent, logScore, round2, weightedAvailable } from './layer12.helpers';
import { normKw, SRC_KE, starOf } from './layer11.service';

// Layer 11-AAA = the master keyword list: the consolidated Layer 4 block (4-A) + the Layer 11 keywords (seed and competitor),
// merged by normalised keyword, scored and capped at 80. Port of the plugin's layer11_merge_aaa. It is the input of Layer 12.
export const MASTER_MAX = 80;
const S4 = 'Layer 4-A';
const SSEED = 'Layer 11 seed';
const SCOMP = 'Layer 11 competitor';

export interface MasterIn { keyword: string; sources: string[]; weights: number[]; intent: string | null; demand: string | null; est: number | null; volume: number | null; seed: boolean; competitorDomain: string | null }

// Pure merge: used by the service and by the tests.
export function mergeMaster(l4: Array<{ record: string; intent: string | null; demand: string | null; weightage: number; estVolume: number | null }>, l11: Array<{ keyword: string; demand: string; weightage: number; volume: number | null; isSeed: boolean; source: string; competitorDomain: string | null }>) {
  const map = new Map<string, MasterIn>();
  const get = (kw: string): MasterIn | null => {
    const n = normKw(kw);
    if (!n) return null;
    let m = map.get(n);
    if (!m) { m = { keyword: kw.trim(), sources: [], weights: [], intent: null, demand: null, est: null, volume: null, seed: false, competitorDomain: null }; map.set(n, m); }
    return m;
  };
  for (const r of l4) {
    const m = get(r.record);
    if (!m) continue;
    if (!m.sources.includes(S4)) m.sources.push(S4);
    m.weights.push(r.weightage);
    m.intent = m.intent || r.intent || null;
    m.demand = m.demand || r.demand || null;
    if (r.estVolume !== null && m.est === null) m.est = r.estVolume;
  }
  for (const r of l11) {
    const m = get(r.keyword);
    if (!m) continue;
    const s = r.isSeed ? SSEED : SCOMP;
    if (!m.sources.includes(s)) m.sources.push(s);
    m.weights.push(r.weightage);
    if (r.demand && r.demand !== 'Pending Market Evidence') m.demand = r.demand;
    if (r.volume !== null && m.volume === null) m.volume = r.volume;
    if (r.isSeed) m.seed = true;
    if (r.source === SRC_KE && r.competitorDomain) m.competitorDomain = m.competitorDomain || r.competitorDomain;
  }
  const out = [...map.values()].map((m) => {
    const src = m.weights.length ? m.weights.reduce((a, b) => a + b, 0) / m.weights.length : 50;
    const ev = m.est ?? m.volume;
    const w = weightedAvailable({ merged_source_evidence: [src, 70], est_volume: [logScore(ev, 28), 30] });
    const weightage = round2(w.score !== null ? w.score : src);
    return { ...m, weightage, intent: m.intent || inferIntent(m.keyword), intentInferred: !m.intent };
  });
  out.sort((a, b) => b.weightage - a.weightage || a.keyword.localeCompare(b.keyword));
  return out.slice(0, MASTER_MAX).map((m, i) => ({ ...m, rank: i + 1 }));
}

@Injectable()
export class Layer11MasterService implements OnModuleInit {
  private readonly log = new Logger('Layer11Master');
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(Layer11Master) private readonly mr: Repository<Layer11Master>,
    @InjectRepository(Layer11Keyword) private readonly kr: Repository<Layer11Keyword>,
    @InjectRepository(ConsolidatedRecord) private readonly cr: Repository<ConsolidatedRecord>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

  onModuleInit() {
    // Free and local: the master list follows Layer 11 as soon as it is done.
    this.layers.onDone(async (customerId, monthIndex, layerNo) => {
      if (layerNo !== 11) return;
      const project = await this.projects.findOne({ where: { customerId, monthIndex } });
      if (project) await this.build(project).catch((e) => this.log.error('Master build: ' + (e instanceof Error ? e.message : e)));
    });
  }

  // Rebuilds the master list (replaces its rows). Serialised per month.
  build(project: Project): Promise<number> {
    const run = (this.chain.get(project.id) || Promise.resolve()).catch(() => undefined).then(async () => {
      const [l4, l11] = await Promise.all([this.cr.find({ where: { projectId: project.id, block: 'L4' }, order: { rank: 'ASC' } }), this.kr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } })]);
      const out = mergeMaster(
        l4.map((r) => ({ record: r.record, intent: r.intent, demand: r.demand, weightage: r.weightage, estVolume: r.estVolume })),
        l11.map((r) => ({ keyword: r.keyword, demand: r.demand, weightage: r.weightage, volume: r.volume, isSeed: r.isSeed, source: r.source, competitorDomain: r.competitorDomain })),
      );
      await this.mr.delete({ projectId: project.id });
      if (out.length) {
        await this.mr.save(out.map((o) => this.mr.create({ customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, rank: o.rank, keyword: o.keyword.slice(0, 500), keyNorm: normKw(o.keyword), intent: o.intent ? o.intent.slice(0, 255) : null, demand: o.demand ? o.demand.slice(0, 120) : null, sources: o.sources, isSeed: o.seed, competitorDomain: o.competitorDomain, estVolume: o.est, volume: o.volume, weightage: o.weightage, starRating: starOf(o.weightage), overview: `Layer 4-A and Layer 11 evidence merged and de-duplicated (${o.sources.join(' + ')}).` + (o.intentInferred ? ' Intent inferred from the keyword wording.' : '') })));
      }
      return out.length;
    });
    this.chain.set(project.id, run);
    return run;
  }

  // Customer panel: the master table of one month (empty string until it exists).
  async htmlByMonth(customerId: string, monthCode: string | null): Promise<string> {
    if (!monthCode) return '';
    const project = await this.projects.findOne({ where: { customerId, monthCode } });
    if (!project) return '';
    const rows = await this.rows(project.id);
    return rows.length ? renderMasterHtml(rows) : '';
  }

  rows(projectId: string) {
    return this.mr.find({ where: { projectId }, order: { rank: 'ASC' } });
  }

  async view(project: Project) {
    const rows = await this.rows(project.id);
    return { month: project.monthCode, total: rows.length, records: rows.map((r) => ({ rank: r.rank, keyword: r.keyword, intent: r.intent, demand: r.demand, sources: r.sources || [], seed: r.isSeed, competitorDomain: r.competitorDomain, estVolume: r.estVolume, volume: r.volume, weightage: r.weightage, star: r.starRating })) };
  }

  async removeByCustomer(customerId: string) {
    await this.mr.delete({ customerId });
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));
export const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
export const fmt = (n: number | null | undefined): string | null => (n === null || n === undefined ? null : n.toLocaleString('en-US'));

export function renderMasterHtml(rows: Layer11Master[]): string {
  const head = ['Final Rating', 'Keyword', 'Intent', 'Demand', 'Sources', 'Est Volume', 'Volume', 'Weightage', 'Star Rating'];
  const body = rows.map((r) => '<tr>' + [r.rank, r.keyword, r.intent, r.demand, (r.sources || []).join(' + '), fmt(r.estVolume), fmt(r.volume), r.weightage, stars(r.starRating)].map((c) => `<td>${dash(c)}</td>`).join('') + '</tr>').join('');
  return `<table class="kp21-l11 kp21-l11-master"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
