import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { BillingService } from './billing.service';

// Read-only bills for the WordPress customer panel (Layer 2 > Billing).
// Same contract as /wp-sync/customers/:id/audits: shared x-api-key, addressed by WP user id.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/invoices')
export class WpInvoicesController {
  constructor(
    private readonly service: BillingService,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  @Get()
  async list(@Param('wpUserId') wpUserId: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    const rows = await this.service.list(c.id);
    return {
      invoices: rows.map((i) => ({
        monthCode: i.monthCode,
        cycleStart: i.cycleStart,
        cycleEnd: i.cycleEnd,
        invoiceDate: i.invoiceDate,
        invoiceNo: i.invoiceNo,
        amount: i.amount,
        currency: i.currency,
        status: i.status,
        paidDate: i.paidDate,
        fileUrl: i.fileUrl,
        fileName: i.fileName,
      })),
    };
  }
}
