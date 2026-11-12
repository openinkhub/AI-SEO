import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Layer9Service } from './layer9.service';

// Layer 9 - AI FAQ Discovery (On Page SEO > Keyword Planner).
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layer9')
export class Layer9Controller {
  constructor(private readonly service: Layer9Service) {}

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


  @Put('manual')
  manual(@Param('customerId') customerId: string, @Body() body: { month: string; platform: string; text: string }) {
    return this.service.saveManual(customerId, body?.month, body?.platform, body?.text);
  }

  @Post('import')
  importTable(@Param('customerId') customerId: string, @Body() body: { month: string; text: string }) {
    return this.service.importTable(customerId, body?.month, body?.text);
  }

  @Put('mode')
  mode(@Param('customerId') customerId: string, @Body() body: { month: string; platform: string; mode: string }) {
    return this.service.setMode(customerId, body?.month, body?.platform, body?.mode);
  }
}
