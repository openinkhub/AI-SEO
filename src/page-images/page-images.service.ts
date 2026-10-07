import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebsitePage } from './website-page.entity';
import { LibraryImage } from './library-image.entity';
import { CustomersService } from '../customers/customers.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { normalizeUrl, guessPageName, aliasFromUrl } from './url-utils';
import { liveSiteScan, fetchH1Many } from './site-scanner';
import { StorageService } from './storage.service';

const MAX_DISTINCT_IMAGES = 30;
// Keeps one request under the host's proxy timeout; remaining pages can be
// finished with extractH1ForCustomer().
const H1_BUDGET_MS = 20000;
@Injectable()
export class PageImagesService {
  constructor(
    @InjectRepository(WebsitePage)
    private readonly pages: Repository<WebsitePage>,
    @InjectRepository(LibraryImage)
    private readonly images: Repository<LibraryImage>,
    private readonly customers: CustomersService,
    private readonly storage: StorageService,
  ) {}

  // ---- Pages ----

  async listPages(customerId: string): Promise<WebsitePage[]> {
    await this.customers.findOne(customerId);
    const rows = await this.pages.find({ where: { customerId }, order: { createdAt: 'ASC' } });
    // Backfill alias for pages saved before aliasName existed.
    const missing = rows.filter((p) => !p.aliasName);
    if (missing.length > 0) {
      missing.forEach((p) => {
        p.aliasName = aliasFromUrl(p.pageUrl);
      });
      await this.pages.save(missing);
    }
    return rows;
  }

  // Extracts H1 for pages that don't have one yet (or all, with force).
  // A failed/empty fetch never overwrites an existing value.
  async extractH1ForCustomer(customerId: string, force = false): Promise<WebsitePage[]> {
    await this.customers.findOne(customerId);
    const rows = await this.pages.find({ where: { customerId } });
    await this.applyH1(rows.filter((p) => force || !p.h1Keyword), H1_BUDGET_MS);
    return this.listPages(customerId);
  }

  async extractH1ForPage(customerId: string, pageId: string): Promise<WebsitePage> {
    const page = await this.findPage(customerId, pageId);
    await this.applyH1([page], 10000);
    return page;
  }

  private async applyH1(rows: WebsitePage[], budgetMs: number): Promise<void> {
    if (rows.length === 0) return;
    const found = await fetchH1Many(rows.map((r) => r.pageUrl), budgetMs);
    const changed: WebsitePage[] = [];
    rows.forEach((r) => {
      const h1 = found.get(r.pageUrl);
      if (h1 && h1 !== r.h1Keyword) {
        r.h1Keyword = h1;
        changed.push(r);
      }
    });
    if (changed.length > 0) await this.pages.save(changed);
  }

  async fetchLivePages(customerId: string): Promise<WebsitePage[]> {
    const customer = await this.customers.findOne(customerId);
    if (!customer.website) {
      throw new BadRequestException(
        'Customer has no website set — add one before fetching pages.',
      );
    }
    const discovered = await liveSiteScan(customer.website);
    await this.syncFetchedPages(customerId, discovered);
    // Pull the H1 of every page that doesn't have one yet (within the time
    // budget; the rest can be finished with the "Extract H1" action).
    return this.extractH1ForCustomer(customerId, false);
  }

  private async syncFetchedPages(
    customerId: string,
    urls: string[],
  ): Promise<WebsitePage[]> {
    const existing = await this.pages.find({ where: { customerId } });
    const existingNormalized = new Set(existing.map((p) => p.normalizedUrl));

    const toInsert = urls
      .filter((u) => !existingNormalized.has(normalizeUrl(u)))
      .map((u) =>
        this.pages.create({
          customerId,
          pageUrl: u,
          normalizedUrl: normalizeUrl(u),
          pageName: guessPageName(u),
          aliasName: aliasFromUrl(u),
          h1Keyword: null,
          libraryImageId: null,
        }),
      );

    if (toInsert.length > 0) {
      await this.pages.save(toInsert);
    }
    return this.listPages(customerId);
  }

  async addPage(customerId: string, dto: CreatePageDto): Promise<WebsitePage> {
    await this.customers.findOne(customerId);
    if (dto.libraryImageId) {
      await this.assertImageBelongs(customerId, dto.libraryImageId);
    }
    const normalized = normalizeUrl(dto.pageUrl);
    const existing = await this.pages.findOne({
      where: { customerId, normalizedUrl: normalized },
    });
    if (existing) {
      throw new BadRequestException('This page URL is already in the library.');
    }
    const page = this.pages.create({
      customerId,
      pageUrl: dto.pageUrl,
      normalizedUrl: normalized,
      pageName: dto.pageName || guessPageName(dto.pageUrl),
      aliasName: dto.aliasName?.trim() || aliasFromUrl(dto.pageUrl),
      h1Keyword: dto.h1Keyword?.trim() || null,
      libraryImageId: dto.libraryImageId || null,
    });
    const saved = await this.pages.save(page);
    if (!saved.h1Keyword) await this.applyH1([saved], 10000);
    return saved;
  }

  async updatePage(
    customerId: string,
    pageId: string,
    dto: UpdatePageDto,
  ): Promise<WebsitePage> {
    const page = await this.findPage(customerId, pageId);
    if (dto.libraryImageId !== undefined) {
      if (dto.libraryImageId) {
        await this.assertImageBelongs(customerId, dto.libraryImageId);
        page.libraryImageId = dto.libraryImageId;
      } else {
        page.libraryImageId = null;
      }
    }
    if (dto.pageUrl) {
      page.pageUrl = dto.pageUrl;
      page.normalizedUrl = normalizeUrl(dto.pageUrl);
    }
    if (dto.pageName !== undefined) {
      page.pageName = dto.pageName;
    }
    if (dto.aliasName !== undefined) {
      page.aliasName = dto.aliasName.trim() || aliasFromUrl(page.pageUrl);
    }
    if (dto.h1Keyword !== undefined) {
      page.h1Keyword = dto.h1Keyword.trim() || null;
    }
    return this.pages.save(page);
  }

  async deletePage(customerId: string, pageId: string): Promise<void> {
    const page = await this.findPage(customerId, pageId);
    await this.pages.remove(page);
  }

  private async findPage(customerId: string, pageId: string): Promise<WebsitePage> {
    const page = await this.pages.findOne({ where: { id: pageId, customerId } });
    if (!page) throw new NotFoundException(`Page ${pageId} not found`);
    return page;
  }

  // ---- Images ----

  storageBackend(): { backend: string } {
    return { backend: this.storage.backend() };
  }

  async listImages(customerId: string): Promise<LibraryImage[]> {
    await this.customers.findOne(customerId);
    return this.images.find({ where: { customerId }, order: { createdAt: 'DESC' } });
  }

  async uploadImage(
    customerId: string,
    file: Express.Multer.File,
    altText?: string,
  ): Promise<LibraryImage> {
    await this.customers.findOne(customerId);
    const count = await this.images.count({ where: { customerId } });
    if (count >= MAX_DISTINCT_IMAGES) {
      throw new BadRequestException(
        `This customer already has ${MAX_DISTINCT_IMAGES} branded images — the maximum. Delete one before uploading another.`,
      );
    }

    const stored = await this.storage.put(
      customerId,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    const image = this.images.create({
      customerId,
      filename: stored.filename,
      url: stored.url,
      storageKey: stored.storageKey,
      altText: altText || null,
    });
    return this.images.save(image);
  }

  async deleteImage(customerId: string, imageId: string): Promise<void> {
    const image = await this.images.findOne({ where: { id: imageId, customerId } });
    if (!image) throw new NotFoundException(`Image ${imageId} not found`);

    // Un-map (never delete) any page that referenced this image.
    await this.pages.update({ customerId, libraryImageId: imageId }, { libraryImageId: null });

    await this.storage.remove(customerId, image.filename, image.storageKey);
    await this.images.remove(image);
  }

  private async assertImageBelongs(customerId: string, imageId: string): Promise<void> {
    const image = await this.images.findOne({ where: { id: imageId, customerId } });
    if (!image) {
      throw new BadRequestException('That image does not belong to this customer.');
    }
  }
}
