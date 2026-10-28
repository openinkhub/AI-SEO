import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// One row per Layer per customer Month (M0..M12) - the Engine copy of the WP
// Layer schedule (layers.registry.ts is the definition list). The scheduled
// date is the month start + (Layer's ACT Month Day - 1); null for on-demand
// Layers (193/194). Rows are created together with the months.
export const LAYER_STATUSES = ['pending', 'in_progress', 'done', 'blocked', 'not_applicable'] as const;
export type LayerStatus = (typeof LAYER_STATUSES)[number];

@Entity('project_layers')
@Unique('project_layer_unique', ['projectId', 'layerNo'])
@Index('project_layers_customer_month', ['customerId', 'monthIndex'])
export class ProjectLayer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  @Column({ type: 'int' })
  monthIndex: number;

  @Column({ type: 'int' })
  layerNo: number;

  @Column({ type: 'date', nullable: true })
  scheduledDate: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
