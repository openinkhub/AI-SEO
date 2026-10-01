import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditsService } from './audits.service';
import { CreateAuditRunDto } from './dto/create-audit-run.dto';

// Layer 69 — "Complete Website Audit". Nested under the customer, same
// shape as Layer 1-3's page-images routes.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/audits')
export class AuditsController {
  constructor(private readonly service: AuditsService) {}

  @Post()
  create(@Param('customerId') customerId: string, @Body() dto: CreateAuditRunDto) {
    return this.service.createRun(customerId, dto);
  }

  @Get()
  findAll(@Param('customerId') customerId: string) {
    return this.service.findAllForCustomer(customerId);
  }

  @Get(':runId')
  findOne(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.findOne(customerId, runId);
  }

  @Get(':runId/tasks')
  listTasks(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.listTasks(customerId, runId);
  }

  @Get(':runId/pushes')
  listPushes(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.listPushes(customerId, runId);
  }

  // Served as raw HTML — this is the "view on customer panel" surface
  // from the user's spec, to be iframed/proxied once that panel exists.
  @Get(':runId/report')
  @Header('Content-Type', 'text/html')
  getReport(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.getReportHtml(customerId, runId);
  }
}
