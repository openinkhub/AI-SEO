import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { LAYER_STATUSES, ProjectLayer } from './project-layer.entity';
import { BUILT_LAYERS, LAYER_REGISTRY, LayerDef, SECTION_LABELS } from './layers.registry';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 400;

// scheduled date = month start + (day - 1); null = on demand.
export function layerDate(monthStart: string | null, day: number | null): string | null {
  if (!monthStart || day == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(monthStart);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]) + (day - 1) * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function appliesToMonth(def: LayerDef, monthIndex: number): boolean {
  return monthIndex >= def.fromMonth && monthIndex <= def.toMonth;
}

@Injectable()
export class LayersService {
  constructor(
    @InjectRepository(ProjectLayer)
    private readonly repo: Repository<ProjectLayer>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  registry() {
    return LAYER_REGISTRY.map((d) => ({
      layer: d.layer,
      key: d.key,
      name: d.name,
      section: d.section,
      sectionLabel: SECTION_LABELS[d.section] || d.section,
      subsection: d.subsection,
      visibility: d.visibility,
      dayLabel: d.dayLabel,
      day: d.day,
      fromMonth: d.fromMonth,
      toMonth: d.toMonth,
      expected: d.expected,
      built: BUILT_LAYERS.includes(d.layer),
    }));
  }

  // Creates the missing Layer rows for the customer's months and corrects the
  // scheduled date of rows whose month dates moved (a changed ACT date).
  // Rows a person already moved on (in_progress / done / blocked) keep their
  // status. Idempotent.
  async syncForCustomer(customerId: string, projects?: Project[]): Promise<number> {
    const months = projects ?? (await this.projectRepo.find({ where: { customerId } }));
    if (!months.length) return 0;
    const rows = await this.repo.find({ where: { customerId } });
    const byKey = new Map(rows.map((r) => [r.projectId + ':' + r.layerNo, r]));
    const toSave: ProjectLayer[] = [];
    for (const p of months) {
      for (const def of LAYER_REGISTRY) {
        const date = layerDate(p.monthStartDate, def.day);
        const applies = appliesToMonth(def, p.monthIndex);
        const found = byKey.get(p.id + ':' + def.layer);
        if (!found) {
          toSave.push(
            this.repo.create({
              customerId,
              projectId: p.id,
              monthIndex: p.monthIndex,
              layerNo: def.layer,
              scheduledDate: date,
              status: applies ? 'pending' : 'not_applicable',
              completedAt: null,
            }),
          );
          continue;
        }
        let changed = false;
        if (found.scheduledDate !== date) {
          found.scheduledDate = date;
          changed = true;
        }
        if (found.monthIndex !== p.monthIndex) {
          found.monthIndex = p.monthIndex;
          changed = true;
        }
        if (found.status === 'pending' && !applies) {
          found.status = 'not_applicable';
          changed = true;
        } else if (found.status === 'not_applicable' && applies) {
          found.status = 'pending';
          changed = true;
        }
        if (changed) toSave.push(found);
      }
    }
    for (let i = 0; i < toSave.length; i += CHUNK) {
      await this.repo.save(toSave.slice(i, i + CHUNK));
    }
    return toSave.length;
  }

  // Cheap guard used by ProjectsService: sync only when the month dates
  // changed or rows are missing (e.g. the registry grew).
  async syncIfNeeded(customerId: string, projects: Project[], datesChanged: boolean): Promise<void> {
    if (!projects.length) return;
    if (!datesChanged) {
      const have = await this.repo.count({ where: { customerId } });
      if (have >= projects.length * LAYER_REGISTRY.length) return;
    }
    await this.syncForCustomer(customerId, projects);
  }

  // Rows joined with the registry. month = 'M3' or '3'; omitted = all months.
  async listForCustomer(customerId: string, month?: string) {
    const projects = await this.projectRepo.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
    if (!projects.length) return [];
    await this.syncIfNeeded(customerId, projects, false);
    let idx: number | null = null;
    if (month) {
      const n = parseInt(String(month).replace(/^m/i, ''), 10);
      if (!isNaN(n)) idx = n;
    }
    const rows = await this.repo.find({
      where: idx == null ? { customerId } : { customerId, monthIndex: idx },
      order: { monthIndex: 'ASC', layerNo: 'ASC' },
    });
    const codes = new Map(projects.map((p) => [p.id, p.monthCode]));
    const defs = new Map(LAYER_REGISTRY.map((d) => [d.layer, d]));
    const out: any[] = [];
    for (const r of rows) {
      const d = defs.get(r.layerNo);
      if (!d) continue;
      out.push({
        id: r.id,
        projectId: r.projectId,
        monthIndex: r.monthIndex,
        monthCode: codes.get(r.projectId) || 'M' + r.monthIndex,
        layer: d.layer,
        name: d.name,
        section: d.section,
        sectionLabel: SECTION_LABELS[d.section] || d.section,
        subsection: d.subsection,
        visibility: d.visibility,
        dayLabel: d.dayLabel,
        scheduledDate: r.scheduledDate,
        applicable: appliesToMonth(d, r.monthIndex),
        status: r.status,
        completedAt: r.completedAt,
        built: BUILT_LAYERS.includes(d.layer),
        expected: d.expected,
      });
    }
    return out;
  }

  // Layer rows scheduled on a date that are still open (used by the automation tick).
  dueRows(layerNo: number, date: string) {
    return this.repo.find({ where: { layerNo, scheduledDate: date, status: In(['pending', 'in_progress']) } });
  }

  // Sets one Layer row of a month from code (e.g. Layer 4 -> done when its table is complete).
  async setByMonth(customerId: string, monthIndex: number, layerNo: number, status: string) {
    const row = await this.repo.findOne({ where: { customerId, monthIndex, layerNo } });
    if (!row || row.status === 'not_applicable' || row.status === status) return;
    row.status = status;
    row.completedAt = status === 'done' ? new Date() : null;
    await this.repo.save(row);
  }

  async setStatus(customerId: string, id: string, status: string) {
    if (!(LAYER_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException('status must be one of: ' + LAYER_STATUSES.join(', '));
    }
    const row = await this.repo.findOne({ where: { id, customerId } });
    if (!row) throw new NotFoundException('Layer row not found for this customer');
    row.status = status;
    row.completedAt = status === 'done' ? new Date() : null;
    return this.repo.save(row);
  }

  removeByCustomer(customerId: string) {
    return this.repo.delete({ customerId });
  }
}
