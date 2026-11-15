import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { Project } from '../projects/project.entity';
import { todayInTz } from '../projects/month-cycle';
import { Layer12State } from './layer12.entities';
import { LAYER_REGISTRY, SECTION_LABELS } from './layers.registry';
import { LayersService, appliesToMonth } from './layers.service';
import { ProjectLayer } from './project-layer.entity';
import { WebsiteBlog } from './website-blog.entity';

// Research & Publish > Layers: Layers 4-20 as one customer-panel section, each with its effective date.
// This is only an INDEX. The publishing rule itself stays in each Layer's own endpoint
// (GET /api/v1/wp-sync/customers/:wpUserId/layers/N?month=M#), which returns html only when that Layer is complete;
// a new platform re-points the same N endpoints and reads this index for the menu.
export const RP_SECTION = 'research-publish';
export const RP_SUBSECTION = 'layers';
export const RP_LAYERS = LAYER_REGISTRY.filter((d) => d.section === RP_SECTION).map((d) => d.layer);
// Layers 11-20 are published only after the month's Layer 12 (Keyword Market Validation) is complete; 4-10 when their own table is complete.
export const RP_GATED_FROM = 11;

export const RP_PUSH_LAYER = 21;
export function rpPublished(layer: number, status: string, layer12Complete: boolean): boolean {
  return status === 'done' && (layer < RP_GATED_FROM || layer12Complete);
}

@Injectable()
export class ResearchPublishService {
  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectLayer) private readonly rows: Repository<ProjectLayer>,
    @InjectRepository(Layer12State) private readonly l12: Repository<Layer12State>,
    @InjectRepository(WebsiteBlog) private readonly blogs: Repository<WebsiteBlog>,
    private readonly layers: LayersService,
  ) {}

  async forWpUser(wpUserId: string, month?: string) {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) return null;
    return this.forCustomer(c.id, month);
  }

  async forCustomer(customerId: string, month?: string) {
    const all = await this.projects.find({ where: { customerId }, order: { monthIndex: 'ASC' } });
    const today = todayInTz();
    let project: Project | undefined;
    if (month) {
      const idx = parseInt(String(month).replace(/^m/i, ''), 10);
      project = all.find((p) => p.monthIndex === idx);
    } else {
      project = all.find((p) => p.monthStartDate && p.monthEndDate && p.monthStartDate <= today && today <= p.monthEndDate) || all[0];
    }
    const head = { section: RP_SECTION, sectionLabel: SECTION_LABELS[RP_SECTION], subsection: RP_SUBSECTION, subsectionLabel: 'Layers' };
    if (!project) return { ...head, month: null, layers: [] };
    await this.layers.syncForCustomer(customerId, all);
    const pushedBlogs = await this.blogs.createQueryBuilder('b').where('b.projectId = :p', { p: project.id }).andWhere('b.pushedAt IS NOT NULL').getCount();
    const [rows, st] = await Promise.all([
      this.rows.find({ where: { customerId, monthIndex: project.monthIndex } }),
      this.l12.findOne({ where: { projectId: project.id } }),
    ]);
    const byNo = new Map(rows.map((r) => [r.layerNo, r]));
    const l12Complete = st?.status === 'complete';
    const layers = LAYER_REGISTRY.filter((d) => d.section === RP_SECTION).map((d) => {
      const r = byNo.get(d.layer);
      const applicable = appliesToMonth(d, project!.monthIndex);
      const status = r?.status || 'pending';
      return {
        layer: d.layer,
        name: d.name,
        effectiveDate: r?.scheduledDate || null,
        day: d.day,
        dayLabel: d.dayLabel,
        applicable,
        status,
        expected: d.expected,
        // Layer 21 is published blog by blog: the Admin pushes each one; the customer panel shows exactly the pushed ones.
        published: applicable && (d.layer === RP_PUSH_LAYER ? pushedBlogs > 0 : rpPublished(d.layer, status, l12Complete)),
        pushed: d.layer === RP_PUSH_LAYER ? pushedBlogs : undefined,
        gatedByLayer12: d.layer >= RP_GATED_FROM && d.layer !== RP_PUSH_LAYER,
        endpoint: `/api/v1/wp-sync/customers/{wpUserId}/layers/${d.layer}?month=${project!.monthCode}`,
      };
    });
    return { ...head, month: project.monthCode, layer12Complete: l12Complete, layers };
  }
}
