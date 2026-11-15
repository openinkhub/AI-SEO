import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { WpLayerCopyService, WpLayersBody } from './wp-layer-copy.service';
import { Layer15Service } from './layer15.service';

// Admin: copy Layers 15-20 of a month out of the WP plugin (POST) and read the copied grid (GET).
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layers-wp')
export class WpLayerCopyController {
  constructor(private readonly service: WpLayerCopyService) {}

  @Post('import')
  import(@Param('customerId') customerId: string, @Body() body: WpLayersBody) {
    return this.service.importWp(customerId, body);
  }

  @Get()
  get(@Param('customerId') customerId: string, @Query('month') month: string, @Query('layer') layer: string) {
    return this.service.get(customerId, month, parseInt(layer, 10));
  }
}

// Layers 18-20: the Engine's platform mapping once the cluster is built for the month, otherwise the grid copied from the plugin.
abstract class WpCopyBase {
  constructor(private readonly customers: Repository<Customer>, private readonly service: Layer15Service, private readonly layerNo: number) {}
  protected async table(wpUserId: string, month?: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return this.service.customerTable(c.id, month, this.layerNo);
  }
}

// Layers 18-20 for the WP customer panel (same x-api-key contract as the other wp-sync Layer endpoints).
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/18')
export class WpLayer18Controller extends WpCopyBase {
  constructor(@InjectRepository(Customer) customers: Repository<Customer>, service: Layer15Service) { super(customers, service, 18); }
  @Get()
  get(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) { return this.table(wpUserId, month); }
}

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/19')
export class WpLayer19Controller extends WpCopyBase {
  constructor(@InjectRepository(Customer) customers: Repository<Customer>, service: Layer15Service) { super(customers, service, 19); }
  @Get()
  get(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) { return this.table(wpUserId, month); }
}

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/20')
export class WpLayer20Controller extends WpCopyBase {
  constructor(@InjectRepository(Customer) customers: Repository<Customer>, service: Layer15Service) { super(customers, service, 20); }
  @Get()
  get(@Param('wpUserId') wpUserId: string, @Query('month') month?: string) { return this.table(wpUserId, month); }
}
