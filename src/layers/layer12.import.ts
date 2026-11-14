import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { LayersService } from './layers.service';
import { Layer11Master, Layer12Row, Layer12State, Layer13Row, Layer14Row } from './layer12.entities';
import { normKw, starOf } from './layer11.service';

// Copies a month's Layers 11-AAA, 12, 13 and 14 out of the WordPress plugin (Admin > On Page SEO > Keyword Planner) into this engine.
// The browser sends the plugin tables exactly as shown (header row + cell text); nothing is recomputed - the plugin's own scores,
// ranks and hierarchy are kept. Metrics the plugin shows as "—" stay null.
export const WP_SOURCE = 'WP plugin';
type Grid = string[][];
export interface WpImportBody { month: string; master: Grid; evidence?: Grid; l12: Grid; l13: Grid; l14: Grid }

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const isNone = (s: string): boolean => s === '' || /^[—–-]+$/.test(s) || /^(unknown|n\/a|null)$/i.test(s);
const numOf = (v: unknown): number | null => {
  const s = clean(v).replace(/[,%\s]/g, '');
  if (isNone(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
};
const intOf = (v: unknown): number | null => {
  const n = numOf(v);
  return n === null ? null : Math.round(n);
};
const textOf = (v: unknown): string | null => {
  const s = clean(v);
  return isNone(s) ? null : s;
};

// Rows of a table keyed by header text (case-insensitive); every required header must exist.
function rowsOf(grid: Grid | undefined, name: string, required: string[]): Array<Record<string, string>> {
  if (!Array.isArray(grid) || grid.length < 2) throw new BadRequestException(`${name}: table is empty.`);
  const head = grid[0].map((h) => clean(h).toLowerCase());
  for (const r of required) if (!head.includes(r.toLowerCase())) throw new BadRequestException(`${name}: column "${r}" is missing.`);
  return grid.slice(1).filter((r) => Array.isArray(r) && r.some((c) => clean(c))).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => { o[h] = clean(r[i]); });
    return o;
  });
}

const stageOf = (v: string | undefined): string => (/^complete/i.test(clean(v)) ? 'completed' : /^pending|^waiting/i.test(clean(v)) ? 'pending' : 'bypassed');

@Injectable()
export class Layer12ImportService {
  private readonly log = new Logger('Layer12Import');

  constructor(
    @InjectRepository(Layer11Master) private readonly mr: Repository<Layer11Master>,
    @InjectRepository(Layer12Row) private readonly rr: Repository<Layer12Row>,
    @InjectRepository(Layer12State) private readonly sr: Repository<Layer12State>,
    @InjectRepository(Layer13Row) private readonly xr: Repository<Layer13Row>,
    @InjectRepository(Layer14Row) private readonly fr: Repository<Layer14Row>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

  async importWp(customerId: string, body: WpImportBody) {
    const idx = parseInt(String(body?.month || '').replace(/^m/i, ''), 10);
    if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M0.');
    const project = await this.projects.findOne({ where: { customerId, monthIndex: idx } });
    if (!project) throw new NotFoundException(`Month M${idx} does not exist for this customer.`);

    const master = rowsOf(body.master, '11-AAA master', ['Keyword', 'Weightage']);
    const l12 = rowsOf(body.l12, 'Layer 12', ['Rank', 'Keyword', 'Opportunity / Weight']);
    const l13 = rowsOf(body.l13, 'Layer 13', ['Rank', 'Keyword', 'Opportunity Score']);
    const l14 = rowsOf(body.l14, 'Layer 14', ['Final Rank', 'Hierarchy', 'Keyword', 'Final Weightage']);
    const ev = body.evidence ? rowsOf(body.evidence, 'Layer 12 evidence', ['Keyword']) : [];

    const base = { customerId, projectId: project.id, monthIndex: project.monthIndex };
    const note = 'Copied from the WP plugin (' + new Date().toISOString().slice(0, 10) + '); not recomputed here.';

    // 11-AAA master
    const seen = new Set<string>();
    const masterRows: Layer11Master[] = [];
    for (const m of master) {
      const key = normKw(m['keyword']);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const w = numOf(m['weightage']) ?? 0;
      masterRows.push(this.mr.create({ ...base, rank: intOf(m['final rating']) ?? masterRows.length + 1, keyword: m['keyword'].slice(0, 500), keyNorm: key, intent: textOf(m['intent — priority'] ?? m['intent']), demand: textOf(m['demand — avg. mix'] ?? m['demand']), sources: [WP_SOURCE], isSeed: false, competitorDomain: null, estVolume: intOf(m['est volume']), volume: intOf(m['google volume']), weightage: w, starRating: intOf(m['star rating']) ?? starOf(w), overview: textOf(m['ai overview'])?.slice(0, 400) ?? null }));
    }
    const mk = new Map(masterRows.map((r) => [r.keyNorm, r]));

    // Layer 12
    const stages = new Map<string, Record<string, string>>();
    for (const e of ev) stages.set(normKw(e['keyword']), { mangools: stageOf(e['mangools']), serpapi: stageOf(e['serpapi competitor']), geekflare: stageOf(e['geekflare page']) });
    const l12Rows: Layer12Row[] = [];
    const l12Seen = new Set<string>();
    for (const r of l12) {
      const key = normKw(r['keyword']);
      if (!key || l12Seen.has(key)) continue;
      l12Seen.add(key);
      const m = mk.get(key);
      const w = numOf(r['opportunity / weight']) ?? 0;
      l12Rows.push(this.rr.create({ ...base, rank: intOf(r['rank']) ?? l12Rows.length + 1, keyword: r['keyword'].slice(0, 500), keyNorm: key, intent: m?.intent ?? null, demand: m?.demand ?? null, baseWeightage: m?.weightage ?? w, estVolume: intOf(r['est volume']), searchVolume: intOf(r['market volume']), googleVolume: intOf(r['google volume']), kd: numOf(r['kd']), cpc: null, ppc: null, competitorCount: null, bestCompetitorPosition: null, avgCompetitorPosition: null, competitorStrength: null, competitorDomains: [], competitorUrl: null, page: null, weightage: w, starRating: starOf(w), stages: stages.get(key) || { mangools: 'bypassed', serpapi: 'completed', geekflare: 'bypassed' }, errors: {}, usedWeights: {}, overview: note }));
    }
    const l12k = new Map(l12Rows.map((r) => [r.keyNorm, r]));

    // Layer 13
    const l13Rows: Layer13Row[] = [];
    const l13Seen = new Set<string>();
    for (const r of l13) {
      const key = normKw(r['keyword']);
      if (!key || l13Seen.has(key)) continue;
      l13Seen.add(key);
      const s = l12k.get(key);
      const m = mk.get(key);
      l13Rows.push(this.xr.create({ ...base, rank: intOf(r['rank']) ?? l13Rows.length + 1, keyword: r['keyword'].slice(0, 500), keyNorm: key, intent: m?.intent ?? null, demand: textOf(r['demand']) ?? m?.demand ?? null, estVolume: intOf(r['est volume']), searchVolume: intOf(r['market volume']), googleVolume: intOf(r['google volume']), kd: numOf(r['kd']), cpc: null, competitorCount: null, competitorStrength: null, layer12Weightage: s?.weightage ?? 0, layer12Star: s?.starRating ?? 1, opportunity: numOf(r['opportunity score']) ?? 0, usedKpis: [], analysis: note }));
    }
    const l13k = new Map(l13Rows.map((r) => [r.keyNorm, r]));

    // Layer 14
    const l14Rows: Layer14Row[] = [];
    const l14Seen = new Set<string>();
    for (const r of l14) {
      const key = normKw(r['keyword']);
      if (!key || l14Seen.has(key)) continue;
      l14Seen.add(key);
      const s = l12k.get(key);
      const w = numOf(r['final weightage']) ?? 0;
      l14Rows.push(this.fr.create({ ...base, rank: intOf(r['final rank']) ?? l14Rows.length + 1, keyword: r['keyword'].slice(0, 500), keyNorm: key, hierarchy: /^h1$/i.test(r['hierarchy']) ? 'H1' : 'H2', intent: textOf(r['intent']) ?? mk.get(key)?.intent ?? null, demand: textOf(r['demand']), searchVolume: s?.searchVolume ?? null, googleVolume: s?.googleVolume ?? null, kd: s?.kd ?? null, opportunity: numOf(r['opportunity score']) ?? 0, weightage: w, starRating: intOf(r['star rating']) ?? starOf(w), layer13Rank: l13k.get(key)?.rank ?? 0, usedKpis: [], overview: note }));
    }

    if (!masterRows.length || !l12Rows.length || !l13Rows.length || !l14Rows.length) throw new BadRequestException('Nothing to import: every table needs at least one keyword row.');

    // Replace the month's rows (the state first, so the done-chain below never rebuilds what was just copied).
    const st = (await this.sr.findOne({ where: { projectId: project.id } })) || this.sr.create({ customerId, projectId: project.id });
    st.status = 'complete';
    st.imported = true;
    st.message = `${l12Rows.length} keyword(s) copied from the WP plugin.`;
    st.warnings = ['Copied from the WP plugin: Mangools, Google Search Console and GA4 were bypassed there, so KD and market volume are not available; Google Volume is the SerpApi figure the plugin recorded.'];
    st.lastRunAt = new Date();
    await this.sr.save(st);
    await Promise.all([this.mr.delete({ projectId: project.id }), this.rr.delete({ projectId: project.id }), this.xr.delete({ projectId: project.id }), this.fr.delete({ projectId: project.id })]);
    const chunks = <T>(a: T[]): T[][] => Array.from({ length: Math.ceil(a.length / 100) }, (_, i) => a.slice(i * 100, i * 100 + 100));
    for (const c of chunks(masterRows)) await this.mr.save(c);
    for (const c of chunks(l12Rows)) await this.rr.save(c);
    for (const c of chunks(l13Rows)) await this.xr.save(c);
    for (const c of chunks(l14Rows)) await this.fr.save(c);

    await this.layers.setByMonth(customerId, project.monthIndex, 12, 'done');
    await this.layers.setByMonth(customerId, project.monthIndex, 13, 'done');
    await this.layers.setByMonth(customerId, project.monthIndex, 14, 'done');
    this.log.log(`Imported ${project.monthCode}: master ${masterRows.length}, L12 ${l12Rows.length}, L13 ${l13Rows.length}, L14 ${l14Rows.length}`);
    return { month: project.monthCode, master: masterRows.length, layer12: l12Rows.length, layer13: l13Rows.length, layer14: l14Rows.length };
  }
}
