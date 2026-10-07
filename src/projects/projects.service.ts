import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Customer } from '../customers/customer.entity';
import { MONTH_COUNT, cycleDates, statusForCycle, todayInTz } from './month-cycle';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  findAllForCustomer(customerId: string): Promise<Project[]> {
    return this.repo.find({
      where: { customerId },
      order: { monthIndex: 'ASC' },
    });
  }

  async findOne(customerId: string, id: string): Promise<Project> {
    const project = await this.repo.findOne({ where: { id, customerId } });
    if (!project) {
      throw new NotFoundException(`Month ${id} not found for this customer`);
    }
    return project;
  }

  create(customerId: string, dto: CreateProjectDto): Promise<Project> {
    const project = this.repo.create({ ...dto, customerId });
    return this.repo.save(project);
  }

  async update(
    customerId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.findOne(customerId, id);
    Object.assign(project, dto);
    return this.repo.save(project);
  }

  async remove(customerId: string, id: string): Promise<void> {
    const project = await this.findOne(customerId, id);
    await this.repo.remove(project);
  }

  // Added 2026-10-06 for CustomersService.remove() - customerId here is a
  // plain column, not a TypeORM relation with an enforced FK/cascade, so
  // deleting a Customer alone leaves its Month rows orphaned (referencing a
  // customerId that no longer exists) unless the caller cleans them up
  // first. Used when deleting a customer outright (a throwaway test
  // signup, say) so no orphaned Months are left behind.
  async removeByCustomer(customerId: string): Promise<void> {
    const projects = await this.findAllForCustomer(customerId);
    if (projects.length) await this.repo.remove(projects);
  }

  // Month Cycle rule (decided 2026-10-07: "Month cycle to be started as per
  // registration date rule"): creates M0..M12 for the customer if missing and
  // (re)applies WP's date rule to every one of them - see month-cycle.ts.
  // Idempotent and cheap: only rows that are new or whose dates/status
  // changed are written, so it is safe to call on every profile save.
  // M0/M1 stay empty shells (their Layer data lives on WP); the status of
  // each month follows today's date (completed / active / pending).
  async ensureMonths(customerId: string): Promise<Project[]> {
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    const fallback = customer?.createdAt
      ? customer.createdAt.toISOString().slice(0, 19).replace('T', ' ')
      : null;
    const base = customer?.actDate || customer?.registeredAt || fallback;
    const existing = await this.findAllForCustomer(customerId);
    const byIndex = new Map(existing.map((p) => [p.monthIndex, p]));
    const today = todayInTz();
    const toSave: Project[] = [];
    for (let i = 0; i < MONTH_COUNT; i++) {
      const dates = base ? cycleDates(base, i) : null;
      const found = byIndex.get(i);
      const p =
        found ??
        this.repo.create({
          customerId,
          monthIndex: i,
          monthCode: `M${i}`,
          source: i <= 1 ? 'wp_sync' : 'act_rule',
          status: i <= 1 ? ProjectStatus.COMPLETED : ProjectStatus.PENDING,
        });
      let changed = !found;
      if (dates) {
        const status = statusForCycle(dates.start, dates.end, today);
        if (
          p.monthStartDate !== dates.start ||
          p.monthEndDate !== dates.end ||
          p.status !== status
        ) {
          p.monthStartDate = dates.start;
          p.monthEndDate = dates.end;
          p.status = status;
          changed = true;
        }
      }
      if (changed) toSave.push(p);
    }
    if (toSave.length) await this.repo.save(toSave);
    return this.findAllForCustomer(customerId);
  }
}
