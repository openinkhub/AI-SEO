import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { WebsitePage } from './website-page.entity';
import { LibraryImage } from './library-image.entity';
import { CustomersService } from '../customers/customers.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { normalizeUrl, guessPageName } from './url-utils';
import { liveSiteScan } from './site-scanner';

const MAX_DISTINCT_IMAGES = 30;
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'page-images');

@Injectable()
export class PageImagesService {
  constructor(
    @InjectRepository(WebsitePage)
    private readonly pages: Repository<WebsitePage>,
    @InjectRepository(LibraryImage)
    private readonly images: Repository<LibraryImage>,
    private readonly customers: CustomersService,
  ) {}

  // ---- Pages ----

  async listPages(customerId: string): Promise<WebsitePage[]> {
    await this.customers.findOne(customerId);
    return this.pages.find({ where: { customerId }, order: { createdAt: 'ASC' } });
  }

  async fetchLivePages(customerId: string): Promise<WebsitePage[]> {
    const customer = await this.customers.findOne(customerId);
    if (!customer.website) {
      throw new BadRequestException(
        'Customer has no website set — add one before fetching pages.',
      );
    }
    const discovered = await liveSiteScan(customer.website);
    return this.syncFetchedPages(customerId, discovered);
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
      libraryImageId: dto.libraryImageId || null,
    });
    return this.pages.save(page);
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

    const dir = path.join(UPLOAD_DIR, customerId);
    fs.mkdirSync(dir, { recursive: true });
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const fullPath = path.join(dir, safeName);
    fs.writeFileSync(fullPath, file.buffer);

    const image = this.images.create({
      customerId,
      filename: safeName,
      url: `/uploads/page-images/${customerId}/${safeName}`,
      altText: altText || null,
    });
    return this.images.save(image);
  }

  async deleteImage(customerId: string, imageId: string): Promise<void> {
    const image = await this.images.findOne({ where: { id: imageId, customerId } });
    if (!image) throw new NotFoundException(`Image ${imageId} not found`);

    // Un-map (never delete) any page that referenced this image.
    await this.pages.update({ customerId, libraryImageId: imageId }, { libraryImageId: null });

    const fullPath = path.join(UPLOAD_DIR, customerId, image.filename);
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // File already gone (e.g. wiped by a Hostinger redeploy) — not fatal.
    }
    await this.images.remove(image);
  }

  private async assertImageBelongs(customerId: string, imageId: string): Promise<void> {
    const image = await this.images.findOne({ where: { id: imageId, customerId } });
    if (!image) {
      throw new BadRequestException('That image does not belong to this customer.');
    }
  }
}
