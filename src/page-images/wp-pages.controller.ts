import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { PageImagesService } from './page-images.service';

// Read-only page mapping for the WordPress customer panel (Layer 2). Same
// contract as /wp-sync/customers/:id/audits: shared x-api-key, addressed by WP user id.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/pages')
export class WpPagesController {
  constructor(
    private readonly service: PageImagesService,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  @Get()
  async list(@Param('wpUserId') wpUserId: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    const [pages, images] = await Promise.all([
      this.service.listPages(c.id),
      this.service.listImages(c.id),
    ]);
    const byId = new Map(images.map((i) => [i.id, i]));
    return {
      pages: pages.map((p) => {
        const img = p.libraryImageId ? byId.get(p.libraryImageId) : undefined;
        return {
          pageName: p.pageName,
          aliasName: p.aliasName,
          pageUrl: p.pageUrl,
          h1Keyword: p.h1Keyword,
          imageName: img ? img.filename : null,
          imageUrl: img ? img.url : null,
        };
      }),
    };
  }
}
