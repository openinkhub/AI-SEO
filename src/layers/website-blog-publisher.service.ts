import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { todayInTz } from '../projects/month-cycle';
import { CustomerApisService } from '../customer-apis/customer-apis.service';
import { WebsiteBlog } from './website-blog.entity';
import { WebsiteBlogService } from './website-blog.service';

// Layer 21 > Publish (Admin only, manual): an approved blog is POSTed to the customer's own Blog Publish API
// (X-API-Key + JSON; the same contract as the WP plugin) and the live URL from the response is saved in the Publishing tracker.
// No automatic publishing. The customer panel never sees this.
export const L23_SERVICE = 'layer23_website_blog';
const READY = ['approved', 'auto_approved'];
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

export function checkEndpoint(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'The Blog Publish API endpoint is not a valid URL.'; }
  if (u.protocol !== 'https:') return 'The Blog Publish API endpoint must start with https://';
  if (PRIVATE_HOST.test(u.hostname)) return 'The Blog Publish API endpoint must be a public address.';
  return null;
}

export function dotPath(obj: any, path: string): unknown {
  let cur = obj;
  for (const k of path.split('.').map((x) => x.trim()).filter(Boolean)) {
    if (cur && typeof cur === 'object' && k in cur) cur = cur[k]; else return null;
  }
  return cur;
}

export function extractUrl(json: any, fieldPath: string): string {
  const ok = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : '';
  if (fieldPath && json && typeof json === 'object') { const f = ok(dotPath(json, fieldPath)); if (f) return f; }
  for (const root of [json, json && typeof json === 'object' ? json.data : null]) {
    if (!root || typeof root !== 'object') continue;
    for (const k of ['url', 'link', 'post_url', 'permalink']) { const f = ok(root[k]); if (f) return f; }
  }
  return '';
}

export function buildPayload(b: WebsiteBlog, author: string, today: string) {
  const tags = String(b.metaTags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const title = String(b.title || '').trim() || `Website Blog ${b.blogNo}`;
  const p: Record<string, unknown> = {
    title, content: b.body || '', excerpt: b.metaDescription || '', meta_title: title, meta_description: b.metaDescription || '',
    focus_keyword: b.targetKeyword || '', published_at: b.publishDate || today, status: 'published',
  };
  if (b.slug) p.url_slug = b.slug;
  if (tags.length) { p.tag = tags[0]; p.meta_tags = tags.join(', '); }
  if (author) p.author = author;
  if (b.targetWebpage) { p.interlink_target = b.targetWebpage; p.internal_links = [{ label: title, url: b.targetWebpage }]; }
  return p;
}

@Injectable()
export class WebsiteBlogPublisher {
  private readonly log = new Logger('WebsiteBlogPublish');

  constructor(
    @InjectRepository(WebsiteBlog) private readonly repo: Repository<WebsiteBlog>,
    private readonly apis: CustomerApisService,
    private readonly blogs: WebsiteBlogService,
  ) {}

  // Is the customer's Blog Publish API set up? (for the Admin tracker hint)
  async configured(customerId: string): Promise<{ configured: boolean; endpoint: string | null }> {
    const cfg = (await this.apis.getKeys(customerId))[L23_SERVICE];
    return { configured: !!cfg, endpoint: cfg?.endpointUrl || null };
  }

  async publish(customerId: string, month: string | undefined, blogNo: number) {
    const p = await this.blogs.monthOf(customerId, month);
    const b = await this.repo.findOne({ where: { projectId: p.id, blogNo } });
    if (!b) throw new NotFoundException(`Blog ${blogNo} does not exist.`);
    if (b.blogUrl || b.status === 'published') throw new BadRequestException('This blog already has a live URL.');
    if (!READY.includes(b.status)) throw new BadRequestException('The blog must be Approved (or Auto Approved) before it can be published.');
    if (!(b.body && b.body.trim())) throw new BadRequestException('The blog has no content to publish.');
    const cfg = (await this.apis.getKeys(customerId))[L23_SERVICE];
    if (!cfg?.endpointUrl || !cfg?.apiKey) return this.fail(b, 'Blog Publish API endpoint and key are not configured for this customer (Customer API settings > Website Blog Post).');
    const bad = checkEndpoint(cfg.endpointUrl);
    if (bad) return this.fail(b, bad);
    const payload = buildPayload(b, cfg.author || '', todayInTz());
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    let res: Response, text = '';
    try {
      res = await fetch(cfg.endpointUrl, { method: 'POST', headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal, redirect: 'manual' });
      text = await res.text();
    } catch (e: any) {
      return this.fail(b, 'Blog Publish API request failed: ' + (e?.name === 'AbortError' ? 'timed out after 45 s' : e?.message || e));
    } finally { clearTimeout(timer); }
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (res.status < 200 || res.status >= 300) return this.fail(b, 'Blog Publish API failed: ' + ((json && json.message) || 'HTTP ' + res.status));
    const url = extractUrl(json, cfg.responseUrlField || '');
    const now = new Date();
    b.status = 'published'; b.blogUrl = url || null; b.publishedAt = now; b.lastPublishAt = now; b.publishTrigger = 'manual'; b.publishError = null; b.publishAttempts = (b.publishAttempts || 0) + 1;
    await this.repo.save(b);
    await this.blogs.afterPublish(customerId, p);
    this.log.log(`Published blog ${b.blogNo} for customer ${customerId}`);
    return { blogNo: b.blogNo, status: 'published', blogUrl: b.blogUrl, note: url ? '' : 'The API returned no live URL - paste it in the Publishing tracker.' };
  }

  private async fail(b: WebsiteBlog, msg: string): Promise<never> {
    b.publishError = msg.slice(0, 1000); b.lastPublishAt = new Date(); b.publishTrigger = 'manual'; b.publishAttempts = (b.publishAttempts || 0) + 1;
    await this.repo.save(b);
    throw new BadRequestException(msg);
  }
}
