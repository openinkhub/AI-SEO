import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CustomerApisService } from './customer-apis.service';
import { SaveApiSettingDto } from './customer-apis.dto';

// Admin-only. Responses never contain secret values.
@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class CustomerApisController {
  constructor(private readonly service: CustomerApisService) {}

  @Get('api-settings/overview')
  overview() {
    return this.service.overview();
  }

  @Get('customers/:customerId/api-settings')
  view(@Param('customerId') customerId: string) {
    return this.service.view(customerId);
  }

  @Put('customers/:customerId/api-settings/:provider')
  save(@Param('customerId') customerId: string, @Param('provider') provider: string, @Body() dto: SaveApiSettingDto) {
    return this.service.save(customerId, provider, dto);
  }

  @Post('customers/:customerId/api-settings/:provider/test')
  test(@Param('customerId') customerId: string, @Param('provider') provider: string) {
    return this.service.test(customerId, provider);
  }

  @Delete('customers/:customerId/api-settings/:provider')
  remove(@Param('customerId') customerId: string, @Param('provider') provider: string) {
    return this.service.remove(customerId, provider);
  }
}
