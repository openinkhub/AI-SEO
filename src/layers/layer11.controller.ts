import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { NotFoundException } from '@nestjs/common';
import { Layer11Service } from './layer11.service';

// Layer 11 - Keyword Analysis (On Page SEO > Keyword Planner), admin side. The blocks are filled automatically
// right after Layers 4-10 are complete; "rebuild" re-runs them on demand.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layer11')
export class Layer11Controller {
  constructor(private readonly service: Layer11Service) {}

  @Get()
  view(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.view(customerId, month);
  }

  @Post('rebuild')
  rebuild(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    return this.service.rebuild(customerId, body?.month);
  }
}

// Same x-api-key contract as the other wp-sync Layer endpoints. Each block comes with its ready-made table once its
// source Layer is complete; blocks that are not ready come back with complete=false and no html.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/11')
export class WpLayer11Controller {
  constructor(
    private readonly service: Layer11Service,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  @Get()
  async table(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return this.service.customerTable(c.id, month);
  }
}
