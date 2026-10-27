import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { AuditsService } from './audits.service';

// Layer 69 for the WordPress customer panel. The portal talks to the Engine
// server-side with the shared x-api-key (same contract as /wp-sync/customers),
// addressed by WP user id, so no customer JWT is needed.
const RERUN_COOLDOWN_MS = 5 * 60 * 1000;

@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/audits')
export class WpAuditsController {
  constructor(
    private readonly service: AuditsService,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  private async customerId(wpUserId: string): Promise<string> {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return c.id;
  }

  // Latest run + its real (automated) findings; null run when none yet.
  @Get('latest')
  async latest(@Param('wpUserId') wpUserId: string) {
    const customerId = await this.customerId(wpUserId);
    const runs = await this.service.findAllForCustomer(customerId);
    const run = runs[0];
    if (!run) return { run: null, findings: [] };
    const tasks = await this.service.listTasks(customerId, run.id);
    return {
      run: {
        id: run.id,
        website: run.website,
        status: run.status,
        totalSkills: run.totalSkills,
        automatedSkills: run.automatedSkills,
        pendingLayerPushes: run.pendingLayerPushes,
        failureReason: run.failureReason,
        completedAt: run.completedAt,
        hasReport: !!run.reportHtml,
      },
      findings: tasks
        .filter((t) => t.isAutomated)
        .map((t) => ({
          skill: t.skill,
          plugin: t.plugin,
          finding: t.finding,
          suggestion: t.suggestion,
          layers: t.layerNumbers,
        })),
    };
  }

  // Runs an audit now (skipped if one was just created, to stop repeat clicks).
  @Post()
  async run(@Param('wpUserId') wpUserId: string) {
    const customerId = await this.customerId(wpUserId);
    const runs = await this.service.findAllForCustomer(customerId);
    const last = runs[0];
    if (last && Date.now() - new Date(last.createdAt).getTime() < RERUN_COOLDOWN_MS) {
      return { id: last.id, reused: true };
    }
    const created = await this.service.createRun(customerId, {});
    return { id: created.id, reused: false };
  }

  @Get(':runId/report')
  @Header('Content-Type', 'text/html')
  async report(@Param('wpUserId') wpUserId: string, @Param('runId') runId: string) {
    const customerId = await this.customerId(wpUserId);
    return this.service.getReportHtml(customerId, runId);
  }
}
