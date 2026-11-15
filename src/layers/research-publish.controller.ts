import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { ResearchPublishService } from './research-publish.service';

// Customer-panel menu for Research & Publish > Layers (Layers 4-20 with effective dates). Same x-api-key contract as the
// per-layer wp-sync endpoints; it lists them and says which are published. The html still comes only from each Layer's endpoint.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/research-publish')
export class WpResearchPublishController {
  constructor(private readonly service: ResearchPublishService) {}

  @Get()
  async index(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) {
    const out = await this.service.forWpUser(wpUserId, month);
    if (!out) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return out;
  }
}
