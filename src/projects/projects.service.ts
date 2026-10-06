import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
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

  // Decided 2026-10-06: "M0 & M1 should be present, with no data" — creates
  // the two Month shells for a WP-migrated customer if they don't already
  // exist. Idempotent (checked by the customerId+monthIndex unique index),
  // so it's safe to call again. No profile/task data is attached here —
  // that's a separate step (PATCH .../profile) — this just ensures the
  // Month rows exist so M2 has somewhere to follow from.
  async ensureMonths(customerId: string): Promise<Project[]> {
    const existing = await this.findAllForCustomer(customerId);
    const have = new Set(existing.map((p) => p.monthIndex));
    const shells: Array<[number, string]> = [
      [0, 'M0'],
      [1, 'M1'],
    ];
    for (const [monthIndex, monthCode] of shells) {
      if (have.has(monthIndex)) continue;
      const project = this.repo.create({
        customerId,
        monthIndex,
        monthCode,
        status: ProjectStatus.COMPLETED,
        source: 'wp_sync',
      });
      await this.repo.save(project);
    }
    return this.findAllForCustomer(customerId);
  }
}
