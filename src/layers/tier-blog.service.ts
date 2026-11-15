import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { LAYER_REGISTRY } from './layers.registry';
import { LayersService } from './layers.service';
import { ClusterArticle } from './layer15.entities';
import { countWords, sanitizeBlogHtml } from './blog-html';
import { TIER_LAYERS, TierBlog, TierStatus } from './tier-blog.entity';
import { WORD_RANGES, wordState } from './word-ranges';

// layerNo -> where the articles come from. Tier 1 = Layer 16 (+ platform from 18); Tier 2 / Tier 3 = Layer 17 (+ 19 / 20).
export const TIER_SOURCE: Record<number, { articleLayer: number; tier: number; mapping: string; platformLayer: number; name: string }> = {
  23: { articleLayer: 16, tier: 1, mapping: 'Layer 16 Tier 1 Mapping', platformLayer: 18, name: 'Blog Tier 1' },
  24: { articleLayer: 17, tier: 2, mapping: 'Layer 17 Tier 2 Mapping', platformLayer: 19, name: 'Blog Tier 2' },
  25: { articleLayer: 17, tier: 3, mapping: 'Layer 17 Tier 3 Mapping', platformLayer: 20, name: 'Blog Tier 3' },
};
const expectedOf = (layerNo: number) => LAYER_REGISTRY.find((d) => d.layer === layerNo)?.expected || 0;
const str = (v: unknown, max: number): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const day = (v: unknown): string | null => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
export const statusOf = (b: { body: string | null; publishedUrl: string | null }): TierStatus => (b.publishedUrl ? 'published' : b.body && b.body.trim() ? 'written' : 'pending');

export interface TierInput { title?: string; slug?: string; metaTitle?: string; metaDescription?: string; metaTags?: string; body?: string; publishDate?: string; publishedUrl?: string }

@Injectable()
export class TierBlogService implements OnModuleInit {
  private readonly log = new Logger('TierBlog');

  constructor(
    @InjectRepository(TierBlog) private readonly repo: Repository<TierBlog>,
    @InjectRepository(ClusterArticle) private readonly articles: Repository<ClusterArticle>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

  // The tier blogs were first numbered 22-24 (now 23-25). The article code says the tier, so rows are put on the right Layer once, idempotently.
  async onModuleInit() {
    try {
      for (const [tier, layerNo] of [[1, 23], [2, 24], [3, 25]] as const) {
        const r: any = await this.repo.createQueryBuilder().update(TierBlog).set({ layerNo }).where('code LIKE :c', { c: `T${tier}-%` }).andWhere('layerNo <> :l', { l: layerNo }).execute();
        if (r?.affected) this.log.log(`Moved ${r.affected} Tier ${tier} blog(s) to Layer ${layerNo}`);
      }
    } catch (e: any) { this.log.warn(`Tier blog renumber skipped: ${e?.message || e}`); }
  }

  private check(layerNo: number) {
    if (!(TIER_LAYERS as readonly number[]).includes(layerNo)) throw new BadRequestException('Tier blogs are Layers 23, 24 and 25.');
  }

  async monthOf(customerId: string, month?: string): Promise<Project> {
    if (month) {
      const idx = parseInt(String(month).replace(/^m/i, ''), 10);
      if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M1.');
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

  private row(b: TierBlog, full: boolean) {
    const r = WORD_RANGES[b.layerNo];
    return {
      code: b.code, seq: b.seq, siteNo: b.siteNo, subSite: b.subSite, parentCode: b.parentCode, platform: b.platform, siteUrl: b.siteUrl, targetPageUrl: b.targetPageUrl,
      title: b.title, slug: b.slug, wordCount: b.wordCount, wordState: wordState(b.layerNo, b.wordCount), wordRange: r ? { min: r.min, max: r.max, label: r.label } : null,
      publishDate: b.publishDate, publishedUrl: b.publishedUrl, status: b.status,
      ...(full ? {
        primaryKeyword: b.primaryKeyword, secondaryKeywords: b.secondaryKeywords || [], objective: b.objective, angle: b.angle, audience: b.audience, tone: b.tone, intro: b.intro,
        outline: b.outline || [], linkPlan: b.linkPlan || [], anchorText: b.anchorText, cta: b.cta, metaTitle: b.metaTitle, metaDescription: b.metaDescription, metaTags: b.metaTags, body: b.body || '',
      } : {}),
    };
  }

  // ---- Admin: list (paged, filtered) ----
  async list(customerId: string, month: string | undefined, layerNo: number, q: { page?: number; pageSize?: number; site?: string; status?: string; q?: string }) {
    this.check(layerNo);
    const p = await this.monthOf(customerId, month);
    const all = await this.repo.find({ where: { projectId: p.id, layerNo }, order: { seq: 'ASC' } });
    const expected = expectedOf(layerNo);
    const sites = new Map<number, string>();
    all.forEach((b) => { if (b.siteNo != null && !sites.has(b.siteNo)) sites.set(b.siteNo, b.platform || ''); });
    let rows = all;
    if (q.site) rows = rows.filter((b) => String(b.siteNo) === String(q.site));
    if (q.status) rows = rows.filter((b) => b.status === q.status);
    if (q.q) { const n = q.q.toLowerCase(); rows = rows.filter((b) => b.code.toLowerCase().includes(n) || (b.title || '').toLowerCase().includes(n) || (b.platform || '').toLowerCase().includes(n)); }
    const size = Math.min(Math.max(q.pageSize || 50, 10), 200);
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(Math.max(q.page || 1, 1), pages);
    const r = WORD_RANGES[layerNo];
    return {
      layer: layerNo, name: TIER_SOURCE[layerNo].name, month: p.monthCode, expected, imported: all.length,
      written: all.filter((b) => b.status !== 'pending').length, published: all.filter((b) => b.status === 'published').length,
      source: TIER_SOURCE[layerNo].mapping + ' + Layer ' + TIER_SOURCE[layerNo].platformLayer + ' Platform Mapping', wordRange: { min: r.min, max: r.max, label: r.label },
      sites: [...sites.entries()].sort((a, b) => a[0] - b[0]).map(([no, name]) => ({ siteNo: no, platform: name })),
      total: rows.length, page, pages, pageSize: size, rows: rows.slice((page - 1) * size, page * size).map((b) => this.row(b, false)),
    };
  }

  async get(customerId: string, month: string | undefined, layerNo: number, code: string) {
    this.check(layerNo);
    const p = await this.monthOf(customerId, month);
    const b = await this.repo.findOne({ where: { projectId: p.id, layerNo, code } });
    if (!b) throw new NotFoundException(`Article ${code} is not imported yet.`);
    return this.row(b, true);
  }

  // ---- Step 1: import the blog inputs from the mapping layers ----
  async importInputs(customerId: string, month: string | undefined, layerNo: number) {
    this.check(layerNo);
    const p = await this.monthOf(customerId, month);
    const src = TIER_SOURCE[layerNo];
    const found = (await this.articles.find({ where: { projectId: p.id, layerNo: src.articleLayer } })).filter((a) => a.tier === src.tier).sort((a, b) => a.seq - b.seq);
    if (!found.length) throw new BadRequestException(`No ${src.mapping} for ${p.monthCode} to import. The mapping is built in Research & Publish > Layers (pick the 6 target pages and build ${src.mapping}); a month copied from the plugin has no article detail.`);
    const existing = new Map((await this.repo.find({ where: { projectId: p.id, layerNo } })).map((b) => [b.code, b]));
    let created = 0, refreshed = 0;
    for (const a of found) {
      let b = existing.get(a.code);
      if (!b) { b = this.repo.create({ customerId, projectId: p.id, monthIndex: p.monthIndex, layerNo, code: a.code, status: 'pending', wordCount: 0 }); created++; } else refreshed++;
      b.seq = a.seq; b.siteNo = a.siteNo; b.subSite = a.subSite; b.parentCode = a.parentCode; b.platform = a.platform; b.siteUrl = a.siteUrl; b.targetPageUrl = a.targetPageUrl;
      b.primaryKeyword = a.primaryKeyword; b.secondaryKeywords = a.secondaryKeywords; b.objective = a.objective; b.angle = a.angle; b.audience = a.audience; b.tone = a.tone;
      b.intro = a.intro; b.outline = a.outline; b.linkPlan = a.linkPlan; b.anchorText = a.anchorText; b.cta = a.cta;
      if (!b.title) b.title = a.title; if (!b.slug) b.slug = a.slug; if (!b.metaTitle) b.metaTitle = a.metaTitle; if (!b.metaDescription) b.metaDescription = a.metaDescription; if (!b.metaTags) b.metaTags = a.metaTags;
      if (!b.publishDate) b.publishDate = day(a.publishDate);
      if (!b.publishedUrl && a.publishedUrl) { b.publishedUrl = a.publishedUrl; b.status = statusOf(b); }
      await this.repo.save(b);
    }
    await this.syncLayer(customerId, p, layerNo);
    this.log.log(`Imported ${found.length} (${created} new) for Layer ${layerNo} ${p.monthCode}`);
    return { month: p.monthCode, layer: layerNo, imported: found.length, created, refreshed };
  }

  // ---- Step 2: write the blog ----
  async save(customerId: string, month: string | undefined, layerNo: number, code: string, input: TierInput) {
    this.check(layerNo);
    const p = await this.monthOf(customerId, month);
    const b = await this.repo.findOne({ where: { projectId: p.id, layerNo, code } });
    if (!b) throw new NotFoundException(`Article ${code} is not imported yet.`);
    if (input.title !== undefined) b.title = str(input.title, 500);
    if (input.slug !== undefined) b.slug = str(String(input.slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''), 300);
    if (input.metaTitle !== undefined) b.metaTitle = str(input.metaTitle, 300);
    if (input.metaDescription !== undefined) b.metaDescription = str(input.metaDescription, 1000);
    if (input.metaTags !== undefined) b.metaTags = str(input.metaTags, 2000);
    if (input.body !== undefined) { b.body = sanitizeBlogHtml(input.body) || null; b.wordCount = countWords(b.body || ''); }
    b.status = statusOf(b);
    await this.repo.save(b);
    await this.syncLayer(customerId, p, layerNo);
    return this.row(b, true);
  }

  // ---- Step 3: publishing (date + live URL) ----
  async publishing(customerId: string, month: string | undefined, layerNo: number, code: string, input: { publishDate?: string; publishedUrl?: string }) {
    this.check(layerNo);
    const p = await this.monthOf(customerId, month);
    const b = await this.repo.findOne({ where: { projectId: p.id, layerNo, code } });
    if (!b) throw new NotFoundException(`Article ${code} is not imported yet.`);
    if (input.publishDate !== undefined) {
      if (String(input.publishDate).trim() && !day(input.publishDate)) throw new BadRequestException('Date must be YYYY-MM-DD.');
      b.publishDate = day(input.publishDate);
    }
    if (input.publishedUrl !== undefined) {
      const u = str(input.publishedUrl, 700);
      if (u && !/^https?:\/\/\S+$/i.test(u)) throw new BadRequestException('Published URL must start with http:// or https://');
      if (u && !(b.body && b.body.trim())) throw new BadRequestException(`Write the blog before adding its published URL (${code}).`);
      b.publishedUrl = u;
    }
    b.status = statusOf(b);
    await this.repo.save(b);
    // the link plans of later articles resolve "URL after publish" from the cluster row
    const a = await this.articles.findOne({ where: { projectId: p.id, code } });
    if (a) { a.publishedUrl = b.publishedUrl; a.status = b.publishedUrl ? 'published' : a.status === 'published' ? 'planned' : a.status; await this.articles.save(a); }
    await this.syncLayer(customerId, p, layerNo);
    return this.row(b, false);
  }

  // ---- Final Output Table: the customer sees it only when every article of the Layer is published ----
  async customerView(customerId: string, month: string | undefined, layerNo: number) {
    this.check(layerNo);
    const expected = expectedOf(layerNo);
    const p = await this.monthOf(customerId, month).catch(() => null);
    if (!p) return { layer: layerNo, complete: false, month: null, total: 0, expected, html: '', platforms: [], rows: [] };
    const all = await this.repo.find({ where: { projectId: p.id, layerNo }, order: { seq: 'ASC' } });
    const pub = all.filter((b) => b.status === 'published');
    const complete = expected > 0 && pub.length === expected;
    const rows = complete ? pub.map((b) => ({ date: b.publishDate, code: b.code, platform: b.platform, siteUrl: b.siteUrl, title: b.title, words: b.wordCount, targetPage: b.targetPageUrl, publishedUrl: b.publishedUrl })) : [];
    return { layer: layerNo, complete, month: p.monthCode, total: pub.length, expected, html: complete ? finalTableHtml(layerNo, rows) : '', platforms: [], rows };
  }

  private async syncLayer(customerId: string, p: Project, layerNo: number) {
    const all = await this.repo.find({ where: { projectId: p.id, layerNo } });
    const expected = expectedOf(layerNo);
    const pub = all.filter((b) => b.status === 'published').length;
    if (expected && pub >= expected) await this.layers.setByMonth(customerId, p.monthIndex, layerNo, 'done');
    else if (all.length) await this.layers.setByMonth(customerId, p.monthIndex, layerNo, 'in_progress');
  }

  async removeByCustomer(customerId: string) { await this.repo.delete({ customerId }); }
}

export function finalTableHtml(layerNo: number, rows: Array<{ date: string | null; code: string; platform: string | null; siteUrl: string | null; title: string | null; words: number; targetPage: string | null; publishedUrl: string | null }>): string {
  const cols = ['Date', 'Code', 'Platform', 'Blog title', 'Words', 'Links to', 'Published blog URL'];
  const body = rows.map((r) => `<tr><td>${esc(r.date || '')}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.platform || '')}</td><td>${esc(r.title || '')}</td><td>${r.words || ''}</td><td>${r.targetPage ? `<a href="${esc(r.targetPage)}">${esc(r.targetPage)}</a>` : '—'}</td><td>${r.publishedUrl ? `<a href="${esc(r.publishedUrl)}">${esc(r.publishedUrl)}</a>` : '—'}</td></tr>`).join('');
  return `<table class="kp21-l11 kp21-l${layerNo}"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
