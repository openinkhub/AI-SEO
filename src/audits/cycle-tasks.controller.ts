import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Put, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditsService } from './audits.service';
import { AdminCycleTask } from './cycle-task.entity';
import { CYCLE_TASKS } from './cycle-tasks';

type Req_ = { user?: { role?: string; email?: string } };
const adminOnly = (req: Req_): void => {
  if (req.user?.role !== 'admin') throw new ForbiddenException('The cycle to-do list is for admins only.');
};

// Layer 3 > SEO Audit: the admin's to-do list for one customer and month cycle. Admin side only.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/cycle-tasks')
export class CycleTasksController {
  constructor(
    private readonly audits: AuditsService,
    @InjectRepository(AdminCycleTask) private readonly repo: Repository<AdminCycleTask>,
  ) {}

  private async cycle(customerId: string): Promise<{ monthCode: string; monthStart: string | null; monthEnd: string | null }> {
    const r = await this.audits.ruleStatus(customerId);
    return { monthCode: r.monthCode ?? '', monthStart: r.monthStart, monthEnd: r.monthEnd };
  }

  @Get()
  async list(@Param('customerId') customerId: string, @Req() req: Req_) {
    adminOnly(req);
    const c = await this.cycle(customerId);
    const rows = await this.repo.find({ where: { customerId, monthCode: c.monthCode } });
    const by = new Map(rows.map((r) => [r.taskKey, r]));
    const tasks = CYCLE_TASKS.map((t) => {
      const r = by.get(t.key);
      return { ...t, done: !!r?.done, note: r?.note ?? '', doneBy: r?.doneBy ?? null, doneAt: r?.doneAt ?? null };
    });
    return { ...c, total: tasks.length, doneCount: tasks.filter((t) => t.done).length, tasks };
  }

  // body: { done?: boolean, note?: string }
  @Put(':taskKey')
  async update(@Param('customerId') customerId: string, @Param('taskKey') taskKey: string, @Body() body: { done?: boolean; note?: string }, @Req() req: Req_) {
    adminOnly(req);
    if (!CYCLE_TASKS.some((t) => t.key === taskKey)) throw new NotFoundException('Unknown task.');
    const c = await this.cycle(customerId);
    let row = await this.repo.findOne({ where: { customerId, monthCode: c.monthCode, taskKey } });
    if (!row) row = this.repo.create({ customerId, monthCode: c.monthCode, taskKey, done: false, note: null, doneBy: null, doneAt: null });
    if (typeof body?.note === 'string') row.note = body.note.slice(0, 4000);
    if (typeof body?.done === 'boolean') {
      row.done = body.done;
      row.doneBy = body.done ? (req.user?.email ?? null) : null;
      row.doneAt = body.done ? new Date() : null;
    }
    await this.repo.save(row);
    return { ok: true, taskKey, done: row.done, note: row.note ?? '', doneBy: row.doneBy, doneAt: row.doneAt };
  }
}
