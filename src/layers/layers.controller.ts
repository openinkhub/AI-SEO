import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LayersService } from './layers.service';

@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class LayersController {
  constructor(private readonly service: LayersService) {}

  // The full definition list (Layer 1..194).
  @Get('layers')
  registry() {
    return this.service.registry();
  }

  // The customer's Layer schedule: ?month=M3 for one month, omitted = all.
  @Get('customers/:customerId/layers')
  list(@Param('customerId') customerId: string, @Query('month') month?: string) {
    return this.service.listForCustomer(customerId, month);
  }

  @Post('customers/:customerId/layers/sync')
  async sync(@Param('customerId') customerId: string) {
    const changed = await this.service.syncForCustomer(customerId);
    return { changed };
  }

  @Patch('customers/:customerId/layers/:id')
  setStatus(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.service.setStatus(customerId, id, body?.status);
  }
}
