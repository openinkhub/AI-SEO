import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// Engine equivalent of WP's Month Cycle (`wp_kp21_projects`: one row per
// Customer per Month, M0 = onboarding/profile month, M1, M2, ...).
// Decided 2026-10-06: M0 & M1 exist here as empty shells (profile/onboarding
// data only, no Layer task history) so M2 onward is the first month whose
// actual work happens in this Admin panel. Layers 4+ for M0/M1 stay on WP.
export enum ProjectStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

@Entity('projects')
@Unique('customer_month_unique', ['customerId', 'monthIndex'])
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  customerId: string;

  // 0 = M0, 1 = M1, 2 = M2, ... matches WP's month_index column exactly.
  @Column({ type: 'int' })
  monthIndex: number;

  // Display code, e.g. 'M0', 'M1', 'M2' — matches WP's month_code column.
  @Column()
  monthCode: string;

  @Column({ type: 'date', nullable: true })
  monthStartDate: string | null;

  @Column({ type: 'date', nullable: true })
  monthEndDate: string | null;

  @Column({ type: 'enum', enum: ProjectStatus, default: ProjectStatus.PENDING })
  status: ProjectStatus;

  // 'wp_sync' = created by the M0/M1 shell-import from WP; 'manual' =
  // created directly in the Engine (M2 onward).
  @Column({ default: 'manual' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
