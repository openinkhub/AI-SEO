import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { Layer11Service } from './layer11.service';
import { Layer11MasterService } from './layer11master.service';

// Layer 11 - Keyword Analysis (On Page SEO > Keyword Planner), admin side.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layer11')
export class Layer11Controller {
  constructor(private readonly service: Layer11Service) {}

  @Get()
  view(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.view(customerId, month);
  }

  // Collects and validates the month's keywords now (background); same as the Day 11 automation.
  @Post('run')
  run(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    return this.service.startRun(customerId, body?.month);
  }
}

// Same x-api-key contract as the other wp-sync Layer endpoints: complete=false (no html) until every step has finished.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/11')
export class WpLayer11Controller {
  constructor(
    private readonly service: Layer11Service,
    private readonly master: Layer11MasterService,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  @Get()
  async table(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    const t = await this.service.customerTable(c.id, month);
    // 11-AAA: the master keyword list (Layer 4-A + Layer 11) is shown under the Layer 11 table once Layer 11 is complete.
    if (t.complete) {
      const m = await this.master.htmlByMonth(c.id, t.month);
      if (m) t.html += '<h4 class="kp21-l11-master-title">11-AAA Master Keywords (Layer 4-A + Layer 11)</h4>' + m;
    }
    return t;
  }
}
