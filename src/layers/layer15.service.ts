import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Customer } from '../customers/customer.entity';
import { WebsitePage } from '../page-images/website-page.entity';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { ConsolidatedRecord } from './consolidation.entities';
import { Layer12State, Layer14Row } from './layer12.entities';
import { ClusterArticle, ClusterPageRow } from './layer15.entities';
import { ArticleDraft, CLUSTER, ClusterInput, PoolItem, checkPlan, planCluster } from './cluster.plan';

// Layers 15, 16, 17 - Topical Blog Intent cluster. The Admin picks 6 target pages; the Engine plans 930 articles with the complete writing
// brief (keyword mapping + template/meta algorithm, local - no API call): Layer 15 = 30 website blogs, Layer 16 = 180 Tier 1, Layer 17 = 180 Tier 2 + 540 Tier 3.
export const L15_LAYERS = [15, 16, 17];
export const L15_EXPECTED: Record<number, number> = { 15: 30, 16: 180, 17: 720 };
export const L15_NAMES: Record<number, string> = { 15: 'Website Blog Cluster Plan', 16: 'Tier 1 Mapping', 17: 'Tier 2 and Tier 3 Mapping' };
const BLOCKS: Array<{ key: 'h3' | 'h4' | 'paa' | 'similar' | 'faq' | 'quora'; block: string }> = [
  { key: 'h3', block: 'L5' }, { key: 'h4', block: 'L6' }, { key: 'paa', block: 'L7' }, { key: 'similar', block: 'L8' }, { key: 'faq', block: 'L9' }, { key: 'quora', block: 'L10' },
];

@Injectable()
export class Layer15Service implements OnModuleInit {
  private readonly log = new Logger('Layer15');
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(ClusterArticle) private readonly ar: Repository<ClusterArticle>,
    @InjectRepository(ClusterPageRow) private readonly pr: Repository<ClusterPageRow>,
    @InjectRepository(WebsitePage) private readonly wp: Repository<WebsitePage>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
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

  // ---- Admin: the 6 target pages ----
  async pages(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month);
    const [all, picked] = await Promise.all([this.wp.find({ where: { customerId }, order: { pageUrl: 'ASC' } }), this.pr.find({ where: { projectId: project.id }, order: { slot: 'ASC' } })]);
    const slotOf = new Map(picked.map((p) => [p.websitePageId, p.slot]));
    return {
      month: project.monthCode, required: CLUSTER.pages,
      picked: picked.map((p) => ({ slot: p.slot, websitePageId: p.websitePageId, pageUrl: p.pageUrl, pageName: p.pageName, h1: p.h1, primaryKeyword: p.primaryKeyword })),
      pages: all.map((p) => ({ id: p.id, pageUrl: p.pageUrl, pageName: p.pageName, h1: p.h1Keyword, slot: slotOf.get(p.id) || null })),
    };
  }

  async pickPages(customerId: string, month: string | undefined, pageIds: string[]) {
    const project = await this.monthOf(customerId, month);
    const ids = Array.isArray(pageIds) ? pageIds.map(String) : [];
    if (ids.length !== CLUSTER.pages || new Set(ids).size !== CLUSTER.pages) throw new BadRequestException(`Pick exactly ${CLUSTER.pages} different pages.`);
    const found = await this.wp.find({ where: { id: In(ids), customerId } });
    if (found.length !== CLUSTER.pages) throw new BadRequestException('One or more pages do not belong to this customer. Fetch the customer pages first.');
    const byId = new Map(found.map((p) => [p.id, p]));
    await this.pr.delete({ projectId: project.id });
    await this.pr.save(ids.map((id, i) => {
      const p = byId.get(id)!;
      return this.pr.create({ customerId, projectId: project.id, monthIndex: project.monthIndex, slot: i + 1, websitePageId: id, pageUrl: p.pageUrl, pageName: p.pageName, h1: p.h1Keyword, primaryKeyword: null });
    }));
    if (await this.fr.count({ where: { projectId: project.id } })) return this.rebuild(customerId, project.monthCode);
    return { ...(await this.summary(customerId, project.monthCode)), note: 'Pages saved. The cluster is built once Layer 14 exists.' };
  }

  // ---- build ----
  private async poolsOf(project: Project) {
    const [l14, cons] = await Promise.all([this.fr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } }), this.cr.find({ where: { projectId: project.id }, order: { rank: 'ASC' } })]);
    const pools: Record<string, PoolItem[]> = {};
    for (const b of BLOCKS) pools[b.key] = cons.filter((c) => c.block === b.block).map((c) => ({ text: c.record, rank: c.rank }));
    return { l14: l14.map((r) => ({ text: r.keyword, rank: r.rank, tag: r.hierarchy })), pools: pools as ClusterInput['pools'] };
  }

  private nextMonthStart(project: Project): string {
    const end = project.monthEndDate || todayInTz();
    return new Date(Date.parse(end.slice(0, 10) + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  }

  // Replaces the month's 930 articles from the picked pages, Layer 14 and the consolidated blocks. Serialised per month.
  build(project: Project): Promise<number> {
    const run = (this.chain.get(project.id) || Promise.resolve()).catch(() => undefined).then(async () => {
      const picks = await this.pr.find({ where: { projectId: project.id }, order: { slot: 'ASC' } });
      if (picks.length !== CLUSTER.pages) return 0;
      const { l14, pools } = await this.poolsOf(project);
      if (!l14.length) return 0;
      const customer = await this.customers.findOne({ where: { id: project.customerId } });
      const plan = planCluster({
        brand: customer?.companyName || '', industry: customer?.industry, nextMonthStart: this.nextMonthStart(project),
        pages: picks.map((p) => ({ id: p.websitePageId, url: p.pageUrl, name: p.pageName, h1: p.h1 })), l14, pools,
      });
      for (const p of picks) { const b = plan.articles.find((a) => a.tier === 0 && a.pageSlot === p.slot && a.articleInPage === 1); p.primaryKeyword = b?.h1 || null; }
      await this.pr.save(picks);
      await this.ar.delete({ projectId: project.id });
      const rows = plan.articles.map((a) => this.toRow(project, a));
      for (let i = 0; i < rows.length; i += 100) await this.ar.save(rows.slice(i, i + 100));
      return rows.length;
    });
    this.chain.set(project.id, run);
    return run;
  }

  private toRow(project: Project, a: ArticleDraft): ClusterArticle {
    return this.ar.create({
      customerId: project.customerId, projectId: project.id, monthIndex: project.monthIndex, layerNo: a.layerNo, tier: a.tier, code: a.code, seq: a.seq, blogNo: a.blogNo, pageSlot: a.pageSlot,
      articleInPage: a.articleInPage, siteNo: a.siteNo, subSite: a.subSite, articleNo: a.articleNo, parentCode: a.parentCode, targetPageUrl: a.targetPageUrl,
      h1: a.h1, h2: a.h2, h3: a.h3, h4: a.h4, paa: a.paa, similar: a.similar, faq: a.faq, quora: a.quora, primaryKeyword: a.primaryKeyword, hierarchy: a.hierarchy,
      secondaryKeywords: a.secondaryKeywords, sources: a.sources, role: a.role, title: a.title, slug: a.slug, metaTitle: a.metaTitle, metaDescription: a.metaDescription, metaTags: a.metaTags,
      intentType: a.intentType, journeyStage: a.journeyStage, objective: a.objective, angle: a.angle, audience: a.audience, tone: a.tone, intro: a.intro, outline: a.outline,
      wordTarget: a.wordTarget, placementRules: a.placementRules, linkPlan: a.linkPlan, anchorText: a.anchorText, cta: a.cta, schemaType: a.schemaType, imageBrief: a.imageBrief,
      avoid: a.avoid, publishDate: a.publishDate, platform: null, publishedUrl: null, status: 'planned', generatedBy: 'template',
    });
  }

  // Build, then mark Layers 15, 16 and 17 done once Layer 12 is complete (a partial month is built for the admin only).
  async finish(project: Project) {
    try {
      const n = await this.build(project);
      if (!n) { this.log.log(`Layers 15-17 for ${project.monthCode}: waiting for the Admin to pick ${CLUSTER.pages} target pages`); return; }
      this.log.log(`Layers 15-17 built for ${project.monthCode}: ${n} article(s)`);
      if (n === CLUSTER.total && (await this.l12Complete(project.id))) for (const l of L15_LAYERS) await this.layers.setByMonth(project.customerId, project.monthIndex, l, 'done');
    } catch (err) {
      this.log.error('Layers 15-17: ' + (err instanceof Error ? err.message : err));
    }
  }

  // Safety net (automation tick): months with Layer 14 rows and 6 picked pages but no articles yet.
  async sweep(): Promise<number> {
    const rows = await this.pr.createQueryBuilder('x').select('x.projectId', 'projectId').groupBy('x.projectId').having('COUNT(*) = :n', { n: CLUSTER.pages }).getRawMany();
    let built = 0;
    for (const d of rows) {
      if (await this.ar.count({ where: { projectId: d.projectId } })) continue;
      if (!(await this.fr.count({ where: { projectId: d.projectId } }))) continue;
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
    if ((await this.pr.count({ where: { projectId: project.id } })) !== CLUSTER.pages) throw new BadRequestException(`Pick ${CLUSTER.pages} target pages first.`);
    if (await this.l12Complete(project.id)) await this.finish(project);
    else await this.build(project);
    return this.summary(customerId, project.monthCode);
  }

  // ---- reads ----
  private async checksOf(rows: ClusterArticle[]) {
    if (rows.length !== CLUSTER.total) return null;
    return checkPlan(rows as unknown as ArticleDraft[]);
  }

  // Admin: one Layer's articles with the complete brief, plus the picked pages and the plan checks.
  async view(customerId: string, month: string | undefined, layerNo: number) {
    const project = await this.monthOf(customerId, month);
    const [rows, all, picks, l12, l14] = await Promise.all([
      this.ar.find({ where: { projectId: project.id, layerNo }, order: { seq: 'ASC' } }),
      this.ar.count({ where: { projectId: project.id } }),
      this.pr.find({ where: { projectId: project.id }, order: { slot: 'ASC' } }),
      this.l12Complete(project.id),
      this.fr.count({ where: { projectId: project.id } }),
    ]);
    const expected = L15_EXPECTED[layerNo];
    const checks = all === CLUSTER.total ? await this.checksOf(await this.ar.find({ where: { projectId: project.id } })) : null;
    return {
      layer: layerNo, month: project.monthCode, total: rows.length, expected, complete: rows.length === expected && l12, layer14Complete: l12, hasLayer14: l14 > 0,
      needsPages: picks.length !== CLUSTER.pages,
      pages: picks.map((p) => ({ slot: p.slot, pageUrl: p.pageUrl, pageName: p.pageName, primaryKeyword: p.primaryKeyword })),
      checks: checks ? { ok: checks.ok, counts: checks.counts, reuse: checks.reuse, problems: checks.problems } : null,
      records: rows.map((r) => this.recordOf(r)),
    };
  }

  private recordOf(r: ClusterArticle) {
    return {
      code: r.code, tier: r.tier, blogNo: r.blogNo, pageSlot: r.pageSlot, articleInPage: r.articleInPage, siteNo: r.siteNo, subSite: r.subSite, articleNo: r.articleNo, parentCode: r.parentCode,
      targetPageUrl: r.targetPageUrl, h1: r.h1, h2: r.h2, h3: r.h3, h4: r.h4, paa: r.paa, similar: r.similar, faq: r.faq, quora: r.quora, primaryKeyword: r.primaryKeyword, hierarchy: r.hierarchy,
      secondaryKeywords: r.secondaryKeywords, role: r.role, title: r.title, slug: r.slug, metaTitle: r.metaTitle, metaDescription: r.metaDescription, metaTags: r.metaTags,
      intentType: r.intentType, journeyStage: r.journeyStage, objective: r.objective, angle: r.angle, audience: r.audience, tone: r.tone, intro: r.intro, outline: r.outline,
      wordTarget: r.wordTarget, placementRules: r.placementRules, linkPlan: r.linkPlan, anchorText: r.anchorText, cta: r.cta, schemaType: r.schemaType, imageBrief: r.imageBrief, avoid: r.avoid,
      publishDate: r.publishDate, platform: r.platform, publishedUrl: r.publishedUrl, status: r.status, generatedBy: r.generatedBy,
    };
  }

  async summary(customerId: string, month?: string) {
    const project = await this.monthOf(customerId, month);
    const out: Record<string, number> = {};
    for (const l of L15_LAYERS) out['layer' + l] = await this.ar.count({ where: { projectId: project.id, layerNo: l } });
    out.pages = await this.pr.count({ where: { projectId: project.id } });
    return { month: project.monthCode, ...out };
  }

  async customerTable(customerId: string, month: string | undefined, layerNo: number) {
    const expected = L15_EXPECTED[layerNo];
    const project = await this.monthOf(customerId, month).catch(() => null);
    if (!project) return { layer: layerNo, complete: false, month: null, total: 0, expected, html: '', platforms: [] };
    const [rows, l12] = await Promise.all([this.ar.find({ where: { projectId: project.id, layerNo }, order: { seq: 'ASC' } }), this.l12Complete(project.id)]);
    const complete = rows.length === expected && l12;
    return { layer: layerNo, complete, month: project.monthCode, total: rows.length, expected, html: complete ? renderClusterHtml(layerNo, rows) : '', platforms: [] };
  }

  async removeByCustomer(customerId: string) {
    await this.ar.delete({ customerId });
    await this.pr.delete({ customerId });
  }
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dash = (s: unknown): string => (s === null || s === undefined || s === '' ? '—' : esc(s));
const outlineText = (o: ClusterArticle['outline']): string => (o || []).map((x) => (x.level === 2 ? 'H2: ' : '  H3: ') + x.text).join('\n');

// Customer grid: the keyword mapping and the complete writing brief of every article in the Layer.
export function renderClusterHtml(layerNo: number, rows: ClusterArticle[]): string {
  const blog = layerNo === 15;
  const head = blog
    ? ['Blog', 'Target Page', 'Role', 'Primary Keyword', 'H1', 'H2', 'H3', 'H4', 'PAA', 'Similar Product / Service', 'FAQ', 'Quora']
    : ['ID', 'Site', 'Article', 'Links To', 'Anchor Text', 'Target Page', 'Role', 'Supporting Keyword'];
  const tail = ['Title', 'Meta Title', 'Meta Description', 'Meta Tags', 'Intent', 'Journey Stage', 'Angle', 'Introduction', 'Outline', 'Word Target', 'Call To Action', 'Publish Date'];
  const cells = (r: ClusterArticle): unknown[] => (blog
    ? ([r.code, r.targetPageUrl, r.role, r.primaryKeyword, r.h1, r.h2, r.h3, r.h4, r.paa, r.similar, r.faq, r.quora] as unknown[])
    : ([r.code, r.tier === 3 ? `Tier 3 · site ${r.siteNo} (B${r.subSite})` : `Tier ${r.tier} · site ${r.siteNo}`, `A${r.articleNo}`, r.parentCode, r.anchorText, r.targetPageUrl, r.role, r.primaryKeyword] as unknown[]))
    .concat([r.title, r.metaTitle, r.metaDescription, r.metaTags, r.intentType, r.journeyStage, r.angle, r.intro, outlineText(r.outline), r.wordTarget, r.cta, r.publishDate]);
  const body = rows.map((r) => '<tr>' + cells(r).map((c, i) => (i === 0 ? `<td><b>${esc(c)}</b></td>` : `<td${typeof c === 'string' && c.includes('\n') ? ' style="white-space:pre-line"' : ''}>${dash(c)}</td>`)).join('') + '</tr>').join('');
  return `<table class="kp21-l11 kp21-l${layerNo}"><thead><tr>${[...head, ...tail].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
