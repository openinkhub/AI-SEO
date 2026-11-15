import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { LayersService } from './layers.service';
import { countWords, sanitizeBlogHtml } from './blog-html';
import { BlogStatus, WebsiteBlog } from './website-blog.entity';

export const BLOG_COUNT = 30;
export const REVIEW_DAYS = 7; // a pushed blog the customer does not act on is auto-approved after this many days (same as the WP plugin)
export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_review: 'Pending Customer Review', approved: 'Approved', auto_approved: 'Auto Approved', rejected: 'Rejected', published: 'Published' };
const RESOLVED = ['approved', 'auto_approved', 'published'];
const str = (v: unknown, max: number): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const day = (v: unknown): string | null => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const WP_STATUS: Record<string, BlogStatus> = { 'published': 'published', 'auto approved': 'auto_approved', 'approved': 'approved', 'draft': 'draft', 'pending customer review': 'pending_review', 'pending review': 'pending_review', 'rejected': 'rejected' };

export interface BlogInput { title?: string; slug?: string; metaTags?: string; metaDescription?: string; intro?: string; body?: string; targetKeyword?: string; h1?: string; h2?: string; targetWebpage?: string; productionDate?: string; publishDate?: string }

const esc = (x: unknown): string => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const link = (u: string | null): string => (u ? `<a href="${esc(u)}">${esc(u)}</a>` : '\u2014');
export function publishedTableHtml(rows: Array<{ blogNo: number; date: string | null; title: string | null; targetPage: string | null; publishedUrl: string | null }>): string {
  const body = rows.map((r) => `<tr><td>${esc(r.date || '')}</td><td><b>${r.blogNo}</b></td><td>${esc(r.title || '')}</td><td>${link(r.targetPage)}</td><td>${link(r.publishedUrl)}</td></tr>`).join('');
  return `<table class="kp21-l11 kp21-l22"><thead><tr><th>Date</th><th>Blog</th><th>Title</th><th>Target page</th><th>Published blog URL</th></tr></thead><tbody>${body}</tbody></table>`;
}

@Injectable()
export class WebsiteBlogService {
  private readonly log = new Logger('WebsiteBlog');

  constructor(
    @InjectRepository(WebsiteBlog) private readonly repo: Repository<WebsiteBlog>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly layers: LayersService,
  ) {}

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

  private checkNo(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > BLOG_COUNT) throw new BadRequestException(`Blog number must be 1-${BLOG_COUNT}.`);
  }

  private shape(b: WebsiteBlog, withBody: boolean) {
    return {
      blogNo: b.blogNo, title: b.title, slug: b.slug, metaTags: b.metaTags, metaDescription: b.metaDescription, intro: b.intro,
      targetKeyword: b.targetKeyword, h1: b.h1, h2: b.h2, targetWebpage: b.targetWebpage,
      productionDate: b.productionDate, publishDate: b.publishDate, wordCount: b.wordCount,
      status: b.status, statusLabel: STATUS_LABEL[b.status] || b.status, pushed: !!b.pushedAt, pushedAt: b.pushedAt,
      reviewDueAt: b.reviewDueAt, reviewActionAt: b.reviewActionAt, customerComment: b.customerComment, comments: b.comments || [],
      blogUrl: b.blogUrl, source: b.source, hasBody: !!(b.body && b.body.trim()),
      publishError: b.publishError, publishAttempts: b.publishAttempts, publishedAt: b.publishedAt,
      ...(withBody ? { body: b.body || '' } : {}),
    };
  }

  // ---- Admin ----
  async view(customerId: string, month?: string) {
    const p = await this.monthOf(customerId, month);
    const rows = await this.repo.find({ where: { projectId: p.id }, order: { blogNo: 'ASC' } });
    const by = new Map(rows.map((r) => [r.blogNo, r]));
    const blogs = Array.from({ length: BLOG_COUNT }, (_, i) => {
      const r = by.get(i + 1);
      return r ? this.shape(r, false) : { blogNo: i + 1, title: null, status: 'empty', statusLabel: 'Not created', pushed: false, hasBody: false, wordCount: 0, comments: [] };
    });
    return { month: p.monthCode, expected: BLOG_COUNT, created: rows.filter((r) => r.body && r.body.trim()).length, pushed: rows.filter((r) => r.pushedAt).length, resolved: rows.filter((r) => RESOLVED.includes(r.status)).length, blogs };
  }

  async get(customerId: string, month: string | undefined, blogNo: number) {
    this.checkNo(blogNo);
    const p = await this.monthOf(customerId, month);
    const r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    return r ? this.shape(r, true) : { blogNo, status: 'empty', statusLabel: 'Not created', body: '', comments: [], pushed: false };
  }

  // Create or edit a blog's content. A blog the customer already approved/published is locked (Reopen first).
  async save(customerId: string, month: string | undefined, blogNo: number, input: BlogInput) {
    this.checkNo(blogNo);
    const p = await this.monthOf(customerId, month);
    let r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (r && RESOLVED.includes(r.status)) throw new BadRequestException(`Blog ${blogNo} is ${STATUS_LABEL[r.status]} - Reopen it before editing.`);
    if (!r) r = this.repo.create({ customerId, projectId: p.id, monthIndex: p.monthIndex, blogNo, status: 'draft', source: 'engine', wordCount: 0 });
    if (input.title !== undefined) r.title = str(input.title, 500);
    if (input.slug !== undefined) r.slug = str(String(input.slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''), 300);
    if (input.metaTags !== undefined) r.metaTags = str(input.metaTags, 2000);
    if (input.metaDescription !== undefined) r.metaDescription = str(input.metaDescription, 1000);
    if (input.intro !== undefined) r.intro = str(input.intro, 4000);
    if (input.targetKeyword !== undefined) r.targetKeyword = str(input.targetKeyword, 500);
    if (input.h1 !== undefined) r.h1 = str(input.h1, 500);
    if (input.h2 !== undefined) r.h2 = str(input.h2, 500);
    if (input.targetWebpage !== undefined) r.targetWebpage = str(input.targetWebpage, 700);
    if (input.productionDate !== undefined) r.productionDate = day(input.productionDate);
    if (input.publishDate !== undefined) r.publishDate = day(input.publishDate);
    if (input.body !== undefined) { r.body = sanitizeBlogHtml(input.body) || null; r.wordCount = countWords(r.body || ''); }
    // Editing a blog that is on the customer panel (waiting / rejected) keeps it there as a fresh review.
    if (r.pushedAt && (r.status === 'rejected' || r.status === 'pending_review')) { /* stays pushed; Admin re-pushes to resubmit */ }
    const saved = await this.repo.save(r);
    await this.syncLayer(customerId, p);
    return this.shape(saved, true);
  }

  // Publishing tracker row (date / target page / published blog URL): editable in any status, with or without blog content.
  // A live URL on an approved blog marks it Published.
  async tracking(customerId: string, month: string | undefined, blogNo: number, input: { publishDate?: string; targetWebpage?: string; blogUrl?: string }) {
    this.checkNo(blogNo);
    const p = await this.monthOf(customerId, month);
    let r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (!r) r = this.repo.create({ customerId, projectId: p.id, monthIndex: p.monthIndex, blogNo, status: 'draft', source: 'engine', wordCount: 0 });
    if (input.publishDate !== undefined) {
      if (String(input.publishDate).trim() && !day(input.publishDate)) throw new BadRequestException('Date must be YYYY-MM-DD.');
      r.publishDate = day(input.publishDate);
    }
    if (input.targetWebpage !== undefined) r.targetWebpage = str(input.targetWebpage, 700);
    if (input.blogUrl !== undefined) {
      const u = str(input.blogUrl, 700);
      if (u && !/^https?:\/\/\S+$/i.test(u)) throw new BadRequestException('Published blog URL must start with http:// or https://');
      r.blogUrl = u;
      if (u && (r.status === 'approved' || r.status === 'auto_approved')) r.status = 'published';
    }
    const saved = await this.repo.save(r);
    await this.syncLayer(customerId, p);
    return this.shape(saved, false);
  }

  // Push: put the blog content on the customer panel for review.
  async push(customerId: string, month: string | undefined, blogNo: number) {
    this.checkNo(blogNo);
    const p = await this.monthOf(customerId, month);
    const r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (!r || !(r.body && r.body.trim()) || !r.title) throw new BadRequestException(`Blog ${blogNo} needs a title and content before it can be pushed.`);
    if (RESOLVED.includes(r.status)) throw new BadRequestException(`Blog ${blogNo} is already ${STATUS_LABEL[r.status]}.`);
    const now = new Date();
    r.status = 'pending_review';
    r.pushedAt = now;
    r.reviewDueAt = new Date(now.getTime() + REVIEW_DAYS * 86400000);
    r.reviewActionAt = null;
    await this.repo.save(r);
    await this.syncLayer(customerId, p);
    return this.shape(r, false);
  }

  async pushAll(customerId: string, month?: string) {
    const p = await this.monthOf(customerId, month);
    const rows = await this.repo.find({ where: { projectId: p.id }, order: { blogNo: 'ASC' } });
    let n = 0;
    const now = new Date();
    for (const r of rows) {
      if (!(r.body && r.body.trim()) || !r.title || r.pushedAt || r.status !== 'draft') continue;
      r.status = 'pending_review'; r.pushedAt = now; r.reviewDueAt = new Date(now.getTime() + REVIEW_DAYS * 86400000); r.reviewActionAt = null;
      await this.repo.save(r); n++;
    }
    await this.syncLayer(customerId, p);
    return { month: p.monthCode, pushed: n };
  }

  // Take a waiting / rejected blog back off the customer panel.
  async unpush(customerId: string, month: string | undefined, blogNo: number) {
    this.checkNo(blogNo);
    const p = await this.monthOf(customerId, month);
    const r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (!r) throw new NotFoundException(`Blog ${blogNo} does not exist.`);
    if (RESOLVED.includes(r.status)) throw new BadRequestException(`Blog ${blogNo} is ${STATUS_LABEL[r.status]} - Reopen it instead.`);
    r.pushedAt = null; r.reviewDueAt = null; r.status = 'draft';
    await this.repo.save(r);
    await this.syncLayer(customerId, p);
    return this.shape(r, false);
  }

  // Reopen an approved / published blog for editing: back to draft, off the customer panel, comment history kept.
  async reopen(customerId: string, month: string | undefined, blogNo: number) {
    this.checkNo(blogNo);
    const p = await this.monthOf(customerId, month);
    const r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (!r) throw new NotFoundException(`Blog ${blogNo} does not exist.`);
    r.status = 'draft'; r.pushedAt = null; r.reviewDueAt = null; r.reviewActionAt = null;
    r.comments = [...(r.comments || []), { at: new Date().toISOString(), by: 'admin', action: 'reopened', comment: '' }];
    await this.repo.save(r);
    await this.syncLayer(customerId, p);
    return this.shape(r, false);
  }

  // Approved blog -> published (the live URL is optional).
  async markPublished(customerId: string, month: string | undefined, blogNo: number, blogUrl?: string) {
    this.checkNo(blogNo);
    const p = await this.monthOf(customerId, month);
    const r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (!r) throw new NotFoundException(`Blog ${blogNo} does not exist.`);
    if (!['approved', 'auto_approved', 'published'].includes(r.status)) throw new BadRequestException(`Blog ${blogNo} must be approved before it is published.`);
    r.status = 'published';
    if (blogUrl !== undefined) r.blogUrl = str(blogUrl, 700);
    await this.repo.save(r);
    await this.syncLayer(customerId, p);
    return this.shape(r, false);
  }

  // ---- Customer panel (x-api-key, WP user) ----
  async customerView(customerId: string, month?: string) {
    const p = await this.monthOf(customerId, month).catch(() => null);
    if (!p) return { layer: 21, complete: false, month: null, total: 0, expected: BLOG_COUNT, html: '', platforms: [], blogs: [] };
    const rows = (await this.repo.find({ where: { projectId: p.id }, order: { blogNo: 'ASC' } })).filter((r) => r.pushedAt && r.body && r.body.trim());
    const blogs = rows.map((r) => ({
      blogNo: r.blogNo, title: r.title, slug: r.slug, metaTags: r.metaTags, metaDescription: r.metaDescription, targetKeyword: r.targetKeyword,
      publishDate: r.publishDate, wordCount: r.wordCount, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status,
      canReview: r.status === 'pending_review', reviewDueAt: r.reviewDueAt, comment: r.customerComment, comments: (r.comments || []).filter((c) => c.by === 'customer' || c.action === 'rejected-resubmitted'),
      blogUrl: r.status === 'published' ? r.blogUrl : null,
      html: r.body || '',
    }));
    return { layer: 21, complete: rows.length === BLOG_COUNT, month: p.monthCode, total: rows.length, expected: BLOG_COUNT, html: '', platforms: [], blogs };
  }

  async review(customerId: string, month: string | undefined, blogNo: number, action: string, comment?: string) {
    this.checkNo(blogNo);
    if (action !== 'approve' && action !== 'reject') throw new BadRequestException('action must be approve or reject.');
    const p = await this.monthOf(customerId, month);
    const r = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (!r || !r.pushedAt) throw new NotFoundException(`Blog ${blogNo} is not available for review.`);
    if (r.status !== 'pending_review') throw new BadRequestException(`Blog ${blogNo} is ${STATUS_LABEL[r.status]} and can no longer be reviewed.`);
    const text = String(comment ?? '').replace(/\s+\n/g, '\n').trim().slice(0, 2000);
    if (action === 'reject' && !text) throw new BadRequestException('Please write why the blog is rejected.');
    r.status = action === 'approve' ? 'approved' : 'rejected';
    r.customerComment = text || null;
    r.reviewActionAt = new Date();
    r.reviewDueAt = null;
    r.comments = [...(r.comments || []), { at: r.reviewActionAt.toISOString(), by: 'customer', action: action === 'approve' ? 'approved' : 'rejected', comment: text }];
    await this.repo.save(r);
    await this.syncLayer(customerId, p);
    return { blogNo, status: r.status, statusLabel: STATUS_LABEL[r.status], comment: r.customerComment };
  }

  // A pushed blog nobody reviewed within REVIEW_DAYS becomes Auto Approved (run from the automation tick).
  async autoApproveDue(now = new Date()): Promise<number> {
    const due = await this.repo.createQueryBuilder('b').where("b.status = 'pending_review'").andWhere('b.reviewDueAt IS NOT NULL').andWhere('b.reviewDueAt <= :now', { now }).getMany();
    const touched = new Map<string, WebsiteBlog>();
    for (const r of due) {
      r.status = 'auto_approved'; r.reviewActionAt = now;
      r.comments = [...(r.comments || []), { at: now.toISOString(), by: 'admin', action: 'auto-approved', comment: `No customer action in ${REVIEW_DAYS} days` }];
      await this.repo.save(r);
      touched.set(r.projectId, r);
    }
    for (const r of touched.values()) { const p = await this.projects.findOne({ where: { id: r.projectId } }); if (p) await this.syncLayer(r.customerId, p); }
    if (due.length) this.log.log(`Auto-approved ${due.length} Layer 21 blog(s).`);
    return due.length;
  }

  // ---- Copy from the WP plugin (as made): unapproved blogs are pushed for review, approved / published ones are not ----
  async importWp(customerId: string, body: { month: string; blogs: any[] }) {
    const idx = parseInt(String(body?.month || '').replace(/^m/i, ''), 10);
    if (isNaN(idx)) throw new BadRequestException('month is required, e.g. M0.');
    const p = await this.projects.findOne({ where: { customerId, monthIndex: idx } });
    if (!p) throw new NotFoundException(`Month M${idx} does not exist for this customer.`);
    if (!Array.isArray(body.blogs) || !body.blogs.length) throw new BadRequestException('No blogs to copy.');
    let n = 0;
    for (const x of body.blogs) {
      const no = parseInt(x?.blogNo, 10);
      this.checkNo(no);
      const html = sanitizeBlogHtml(x.body);
      if (!html) continue; // blogs WP never wrote are not created
      let r = await this.repo.findOne({ where: { projectId: p.id, blogNo: no } });
      if (r && r.source === 'engine' && r.status !== 'draft') continue; // never overwrite Engine work in progress
      if (!r) r = this.repo.create({ customerId, projectId: p.id, monthIndex: p.monthIndex, blogNo: no });
      r.title = str(x.title, 500); r.slug = str(x.slug, 300); r.metaTags = str(x.tags, 2000); r.metaDescription = str(x.description, 1000); r.intro = str(x.intro, 4000);
      r.targetKeyword = str(x.targetKeyword, 500); r.h1 = str(x.h1, 500); r.h2 = str(x.h2, 500); r.targetWebpage = str(x.targetWebpage, 700);
      r.productionDate = day(x.productionDate); r.publishDate = day(x.publishDate);
      r.body = html; r.wordCount = countWords(html);
      r.status = WP_STATUS[String(x.status || '').toLowerCase().trim()] || 'draft';
      // Unapproved blogs (draft / waiting / rejected) go straight onto the customer panel for review; approved and published ones stay Admin-side history.
      if (['draft', 'pending_review', 'rejected'].includes(r.status)) {
        const now = new Date();
        r.status = 'pending_review'; r.pushedAt = now; r.reviewDueAt = new Date(now.getTime() + REVIEW_DAYS * 86400000);
      } else { r.pushedAt = null; r.reviewDueAt = null; }
      r.source = 'wp-copy'; r.wpBlogId = str(x.wpBlogId, 40); r.blogUrl = str(x.blogUrl, 700);
      r.customerComment = str(x.comment, 2000);
      await this.repo.save(r); n++;
    }
    await this.syncLayer(customerId, p);
    this.log.log(`Copied ${n} Layer 21 blogs into ${p.monthCode} for customer ${customerId}`);
    return { month: p.monthCode, copied: n };
  }

  // Layer 21 row: in progress once any blog exists, done when all 30 are approved / published.
  private async syncLayer(customerId: string, p: Project) {
    const rows = await this.repo.find({ where: { projectId: p.id } });
    const resolved = rows.filter((r) => RESOLVED.includes(r.status)).length;
    const any = rows.some((r) => r.body && r.body.trim());
    if (resolved >= BLOG_COUNT) await this.layers.setByMonth(customerId, p.monthIndex, 21, 'done');
    else if (any) await this.layers.setByMonth(customerId, p.monthIndex, 21, 'in_progress');
    // Layer 22 (publish) of the NEXT month tracks the posting of these blogs.
    const published = rows.filter((r) => r.status === 'published').length;
    if (published >= BLOG_COUNT) await this.layers.setByMonth(customerId, p.monthIndex + 1, 22, 'done');
    else if (published > 0) await this.layers.setByMonth(customerId, p.monthIndex + 1, 22, 'in_progress');
  }

  // ---- Layer 22 Website Blog Publish: in month M the Admin publishes the blogs produced in M-1 (Layer 21) ----
  async sourceOf(customerId: string, month?: string): Promise<{ publish: Project; source: Project | null }> {
    const publish = await this.monthOf(customerId, month);
    const source = publish.monthIndex > 0 ? await this.projects.findOne({ where: { customerId, monthIndex: publish.monthIndex - 1 } }) : null;
    return { publish, source };
  }

  async sourceMonthCode(customerId: string, month?: string): Promise<string> {
    const { publish, source } = await this.sourceOf(customerId, month);
    if (!source) throw new BadRequestException(`Layer 22 publishes the previous month's blogs, so it starts in M1 (${publish.monthCode} has nothing to publish).`);
    return source.monthCode;
  }

  async publishView(customerId: string, month?: string) {
    const { publish, source } = await this.sourceOf(customerId, month);
    const base = { layer: 22, month: publish.monthCode, sourceMonth: source ? source.monthCode : null, expected: BLOG_COUNT };
    if (!source) return { ...base, applicable: false, ready: 0, published: 0, blogs: [] };
    const rows = await this.repo.find({ where: { projectId: source.id }, order: { blogNo: 'ASC' } });
    const by = new Map(rows.map((r) => [r.blogNo, r]));
    const blogs = Array.from({ length: BLOG_COUNT }, (_, i) => {
      const r = by.get(i + 1);
      return {
        blogNo: i + 1, title: r?.title || null, status: r?.status || 'empty', statusLabel: r ? STATUS_LABEL[r.status] || r.status : 'Not created',
        ready: !!r && RESOLVED.includes(r.status), publishDate: r?.publishDate || null, targetWebpage: r?.targetWebpage || null, blogUrl: r?.blogUrl || null,
        publishError: r?.publishError || null,
      };
    });
    return { ...base, applicable: true, ready: blogs.filter((b) => b.ready).length, published: blogs.filter((b) => b.status === 'published').length, blogs };
  }

  // Customer panel: the blogs published so far (date - target page - published blog URL); complete when all 30 are live.
  async customerPublishView(customerId: string, month?: string) {
    const { publish, source } = await this.sourceOf(customerId, month).catch(() => ({ publish: null as Project | null, source: null as Project | null }));
    if (!publish) return { layer: 22, complete: false, month: null, total: 0, expected: BLOG_COUNT, html: '', platforms: [], rows: [] };
    const rows = source ? (await this.repo.find({ where: { projectId: source.id }, order: { blogNo: 'ASC' } })).filter((r) => r.status === 'published' && r.blogUrl) : [];
    const out = rows.map((r) => ({ blogNo: r.blogNo, date: r.publishDate, title: r.title, targetPage: r.targetWebpage, publishedUrl: r.blogUrl }));
    return { layer: 22, complete: out.length === BLOG_COUNT, month: publish.monthCode, sourceMonth: source ? source.monthCode : null, total: out.length, expected: BLOG_COUNT, html: out.length ? publishedTableHtml(out) : '', platforms: [], rows: out };
  }

  async afterPublish(customerId: string, p: Project) { await this.syncLayer(customerId, p); }

  async removeByCustomer(customerId: string) { await this.repo.delete({ customerId }); }
}
