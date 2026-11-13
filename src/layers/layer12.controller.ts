import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { Layer11MasterService } from './layer11master.service';
import { Layer12Service } from './layer12.service';
import { Layer13Service } from './layer13.service';
import { Layer14Service } from './layer14.service';

// Layers 11-AAA, 12, 13, 14 (On Page SEO > Keyword Planner), admin side.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId')
export class Layer12Controller {
  constructor(private readonly master: Layer11MasterService, private readonly l12: Layer12Service, private readonly l13: Layer13Service, private readonly l14: Layer14Service) {}

  // 11-AAA master keyword list (Layer 4-A + Layer 11).
  @Get('layer11/master')
  async masterView(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.master.view(await this.l12.monthOf(customerId, month));
  }

  @Post('layer11/master/rebuild')
  async masterRebuild(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    const project = await this.l12.monthOf(customerId, body?.month);
    await this.master.build(project);
    return this.master.view(project);
  }

  @Get('layer12')
  view12(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.l12.view(customerId, month);
  }

  // Validates the month's master keywords now (background); same as the Day 12 automation. force=true starts over from a fresh master list.
  @Post('layer12/run')
  run12(@Param('customerId') customerId: string, @Body() body: { month: string; force?: boolean }) {
    return this.l12.startRun(customerId, body?.month, !!body?.force);
  }

  @Get('layer13')
  view13(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.l13.view(customerId, month);
  }

  @Post('layer13/rebuild')
  rebuild13(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    return this.l13.rebuild(customerId, body?.month);
  }

  @Get('layer14')
  view14(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.l14.view(customerId, month);
  }

  @Post('layer14/rebuild')
  rebuild14(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    return this.l14.rebuild(customerId, body?.month);
  }
}

abstract class WpBase {
  constructor(private readonly customers: Repository<Customer>) {}
  protected async customerId(wpUserId: string): Promise<string> {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return c.id;
  }
}

// Same x-api-key contract as the other wp-sync Layer endpoints: complete=false (no html) until the Layer is finished.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/12')
export class WpLayer12Controller extends WpBase {
  constructor(private readonly service: Layer12Service, @InjectRepository(Customer) customers: Repository<Customer>) { super(customers); }
  @Get()
  async table(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) {
    return this.service.customerTable(await this.customerId(wpUserId), month);
  }
}

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/13')
export class WpLayer13Controller extends WpBase {
  constructor(private readonly service: Layer13Service, @InjectRepository(Customer) customers: Repository<Customer>) { super(customers); }
  @Get()
  async table(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) {
    return this.service.customerTable(await this.customerId(wpUserId), month);
  }
}

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/14')
export class WpLayer14Controller extends WpBase {
  constructor(private readonly service: Layer14Service, @InjectRepository(Customer) customers: Repository<Customer>) { super(customers); }
  @Get()
  async table(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) {
    return this.service.customerTable(await this.customerId(wpUserId), month);
  }
}
