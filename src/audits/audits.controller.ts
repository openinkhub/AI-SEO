import { Body, Controller, Delete, ForbiddenException, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditsService } from './audits.service';
import { CreateAuditRunDto } from './dto/create-audit-run.dto';

// Layer 69 — "Complete Website Audit". Nested under the customer, same
// shape as Layer 1-3's page-images routes.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/audits')
export class AuditsController {
  constructor(private readonly service: AuditsService) {}

  // Running an audit is admin-only; an admin is not held back by the once-per-cycle / Day-3 date rule.
  @Post()
  create(@Param('customerId') customerId: string, @Body() dto: CreateAuditRunDto, @Req() req: { user?: { role?: string } }) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('Only an admin can run the SEO Audit.');
    return this.service.createRun(customerId, dto, { bypassRule: true });
  }

  @Get()
  findAll(@Param('customerId') customerId: string) {
    return this.service.findAllForCustomer(customerId);
  }

  // Once-per-cycle rule: is the audit unlocked (Day 3+) and has this cycle's audit been run?
  @Get('rule')
  async rule(@Param('customerId') customerId: string, @Req() req: { user?: { role?: string } }) {
    const r = await this.service.ruleStatus(customerId);
    if (req.user?.role === 'admin') return { ...r, canRun: true, canInstant: true, adminOnly: false, adminBypass: true, reason: `${r.reason} Admin: the date rule is bypassed.` };
    return { ...r, canRun: false, canInstant: false, adminOnly: true, reason: 'Only an admin can run the SEO Audit.' };
  }

  // Push the Layer 3 page data (alias, H1, meta tags, image) into this customer's SEO reports.
  @Post('refresh-pages')
  refreshPages(@Param('customerId') customerId: string) {
    return this.service.refreshReportPages(customerId);
  }

  // Re-run the research enrichment for an existing run (keyword / competitor / local sources + task write-ups).
  @Post(':runId/enrich')
  // ?mode=blocked collects only the sources that still have unfinished (blocked / waiting) tasks.
  enrich(@Param('customerId') customerId: string, @Param('runId') runId: string, @Req() req: { user?: { role?: string } }, @Query('mode') mode?: string) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('Only an admin can re-run the research.');
    return this.service.startEnrich(customerId, runId, mode === 'blocked');
  }

  // Remove one audit run with everything stored under it (admin clean-up, e.g. a duplicate run).
  @Delete(':runId')
  remove(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.deleteRun(customerId, runId);
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
