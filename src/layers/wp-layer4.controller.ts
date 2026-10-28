import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { Layer4Service } from './layer4.service';

// Layer 4 for the WordPress customer panel (same x-api-key contract as /wp-sync/.../audits). The panel gets the
// table only when it is complete (all 9 AI platforms hold their 10 keywords); until then it gets complete=false.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/4')
export class WpLayer4Controller {
  constructor(
    private readonly service: Layer4Service,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  @Get()
  async table(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return this.service.customerTable(c.id, month);
  }
}
