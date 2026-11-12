import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Layer5Service } from './layer5.service';

// Layer 5 - AI Search Prompt (On Page SEO > Keyword Planner).
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layer5')
export class Layer5Controller {
  constructor(private readonly service: Layer5Service) {}

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

  // Gets the estimated monthly searches for the prompts that have none yet (background).
  @Post('volumes')
  volumes(@Param('customerId') customerId: string, @Body() body: { month: string; platform: string }) {
    return this.service.startVolumes(customerId, body?.month, body?.platform);
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
