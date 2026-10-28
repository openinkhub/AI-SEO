import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GlobalApisService } from './global-apis.service';
import { SaveApiSettingDto } from './customer-apis.dto';

// Admin-only. Global (all customers) API keys. Responses never contain secret values.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/global-api-settings')
export class GlobalApisController {
  constructor(private readonly service: GlobalApisService) {}

  @Get()
  view() {
    return this.service.view();
  }

  @Put(':provider')
  save(@Param('provider') provider: string, @Body() dto: SaveApiSettingDto) {
    return this.service.save(provider, dto);
  }

  @Post(':provider/test')
  test(@Param('provider') provider: string) {
    return this.service.test(provider);
  }

  @Delete(':provider')
  remove(@Param('provider') provider: string) {
    return this.service.remove(provider);
  }
}
