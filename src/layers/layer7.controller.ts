import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Layer7Service } from './layer7.service';

// Layer 7 - Google People Also Ask (On Page SEO > Keyword Planner).
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layer7')
export class Layer7Controller {
  constructor(private readonly service: Layer7Service) {}

  @Get()
  view(@Param('customerId') customerId: string, @Query('month') month: string) {
    return this.service.view(customerId, month);
  }

  // Searches Google for the month's queries now (background); same as the Day 7 automation.
  @Post('run')
  run(@Param('customerId') customerId: string, @Body() body: { month: string }) {
    return this.service.startRun(customerId, body?.month);
  }

  @Put('manual')
  manual(@Param('customerId') customerId: string, @Body() body: { month: string; text: string }) {
    return this.service.saveManual(customerId, body?.month, body?.text);
  }
}
