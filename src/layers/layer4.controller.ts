import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Layer4Service } from './layer4.service';

// Layer 4 - AI Search Keyword (On Page SEO > Keyword Planner).
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layer4')
export class Layer4Controller {
  constructor(private readonly service: Layer4Service) {}

  @Get()
  view(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.view(customerId, month);
  }

  @Post('run')
  run(@Param('customerId') customerId: string, @Body() body: { month: string; platform: string }) {
    return this.service.startRun(customerId, body?.month, body?.platform);
  }

  // Runs every API platform of the month now, the same way the set-date automation does (background).
  @Post('run-all')
  async runAll(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    const p = await this.service.monthOf(customerId, body?.month);
    void this.service.runDay([{ customerId, monthIndex: p.monthIndex }], true).catch(() => undefined);
    return this.service.view(customerId, body?.month);
  }

  // Updates the keywords' volume from Mangools (capped per press; press again for the rest).
  @Post('volume')
  volume(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    return this.service.startVolumeUpdate(customerId, body?.month);
  }

  @Put('manual')
  manual(@Param('customerId') customerId: string, @Body() body: { month: string; platform: string; text: string }) {
    return this.service.saveManual(customerId, body?.month, body?.platform, body?.text);
  }

  @Put('mode')
  mode(@Param('customerId') customerId: string, @Body() body: { month: string; platform: string; mode: string }) {
    return this.service.setMode(customerId, body?.month, body?.platform, body?.mode);
  }
}
