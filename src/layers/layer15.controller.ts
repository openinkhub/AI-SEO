import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { Layer15Service } from './layer15.service';

// Layers 15, 16, 17 (Off Page SEO > Blogs: Topical Blog Intent cluster - website blogs, Tier 1, Tier 2 + Tier 3), admin side.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId')
export class Layer15Controller {
  constructor(private readonly service: Layer15Service) {}

  @Get('layer15')
  view15(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.view(customerId, month, 15);
  }

  @Get('layer16')
  view16(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.view(customerId, month, 16);
  }

  @Get('layer17')
  view17(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.view(customerId, month, 17);
  }

  // The customer's website pages (with the 6 picked ones marked) for the Admin's target-page picker.
  @Get('layer15/pages')
  pages(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.pages(customerId, month);
  }

  // Admin picks exactly 6 target pages; the cluster is (re)built from them once Layer 14 exists.
  @Post('layer15/pages')
  pick(@Param('customerId') customerId: string, @Body() body: { month: string; pageIds: string[] }) {
    return this.service.pickPages(customerId, body?.month, body?.pageIds);
  }

  // Rebuilds the month's 930 articles from the picked pages, the current Layer 14 and the consolidated blocks.
  @Post('layer15-17/rebuild')
  rebuild(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    return this.service.rebuild(customerId, body?.month);
  }
}

abstract class WpBase {
  constructor(private readonly customers: Repository<Customer>, private readonly service: Layer15Service, private readonly layerNo: number) {}
  protected async table(wpUserId: string, month?: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return this.service.customerTable(c.id, month, this.layerNo);
  }
}

// Same x-api-key contract as the other wp-sync Layer endpoints: complete=false (no html) until the Layer is finished.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/15')
export class WpLayer15Controller extends WpBase {
  constructor(@InjectRepository(Customer) customers: Repository<Customer>, service: Layer15Service) { super(customers, service, 15); }
  @Get()
  get(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) { return this.table(wpUserId, month); }
}

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/16')
export class WpLayer16Controller extends WpBase {
  constructor(@InjectRepository(Customer) customers: Repository<Customer>, service: Layer15Service) { super(customers, service, 16); }
  @Get()
  get(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) { return this.table(wpUserId, month); }
}

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/17')
export class WpLayer17Controller extends WpBase {
  constructor(@InjectRepository(Customer) customers: Repository<Customer>, service: Layer15Service) { super(customers, service, 17); }
  @Get()
  get(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) { return this.table(wpUserId, month); }
}
