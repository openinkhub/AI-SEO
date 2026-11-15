import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { TierBlogService } from './tier-blog.service';

// Layers 23 / 24 / 25 - Blog Tier 1 / 2 / 3. Admin: import inputs, write, publish. Customer panel: the Final Output Table.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/tier-blogs/:layerNo')
export class TierBlogController {
  constructor(private readonly service: TierBlogService) {}

  @Get() list(@Param('customerId') id: string, @Param('layerNo', ParseIntPipe) layer: number, @Query() q: any) {
    return this.service.list(id, q.month, layer, { page: parseInt(q.page, 10) || 1, pageSize: parseInt(q.pageSize, 10) || 50, site: q.site, status: q.status, q: q.q });
  }
  @Post('import') importInputs(@Param('customerId') id: string, @Param('layerNo', ParseIntPipe) layer: number, @Query('month') month?: string) { return this.service.importInputs(id, month, layer); }
  @Get('article/:code') one(@Param('customerId') id: string, @Param('layerNo', ParseIntPipe) layer: number, @Param('code') code: string, @Query('month') month?: string) { return this.service.get(id, month, layer, code); }
  @Put('article/:code') save(@Param('customerId') id: string, @Param('layerNo', ParseIntPipe) layer: number, @Param('code') code: string, @Body() body: any, @Query('month') month?: string) { return this.service.save(id, month, layer, code, body || {}); }
  @Put('article/:code/publishing') publishing(@Param('customerId') id: string, @Param('layerNo', ParseIntPipe) layer: number, @Param('code') code: string, @Body() body: any, @Query('month') month?: string) { return this.service.publishing(id, month, layer, code, body || {}); }
}

abstract class WpTierBase {
  constructor(private readonly service: TierBlogService, private readonly customers: Repository<Customer>, private readonly layerNo: number) {}
  protected async table(wpUserId: string, month?: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return this.service.customerView(c.id, month, this.layerNo);
  }
}

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/23')
export class WpLayer23Controller extends WpTierBase {
  constructor(service: TierBlogService, @InjectRepository(Customer) customers: Repository<Customer>) { super(service, customers, 23); }
  @Get() t(@Param('wpUserId') w: string, @Query('month') m?: string) { return this.table(w, m); }
}
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/24')
export class WpLayer24Controller extends WpTierBase {
  constructor(service: TierBlogService, @InjectRepository(Customer) customers: Repository<Customer>) { super(service, customers, 24); }
  @Get() t(@Param('wpUserId') w: string, @Query('month') m?: string) { return this.table(w, m); }
}
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/25')
export class WpLayer25Controller extends WpTierBase {
  constructor(service: TierBlogService, @InjectRepository(Customer) customers: Repository<Customer>) { super(service, customers, 25); }
  @Get() t(@Param('wpUserId') w: string, @Query('month') m?: string) { return this.table(w, m); }
}
