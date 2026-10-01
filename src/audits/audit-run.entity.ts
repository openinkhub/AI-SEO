import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Layer 69 — "Complete Website Audit". One row per audit the customer (or
// an agency user on their behalf) runs. Snapshots totalSkills at creation
// so a later catalog edit never changes the story of a finished run.
export enum AuditRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('audit_runs')
export class AuditRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  // Snapshot of the website audited, in case the Customer record's website
  // field changes after the fact.
  @Column({ nullable: true })
  website: string | null;

  @Column({ type: 'enum', enum: AuditRunStatus, default: AuditRunStatus.PENDING })
  status: AuditRunStatus;

  @Column({ default: 0 })
  totalSkills: number;

  @Column({ default: 0 })
  completedSkills: number;

  @Column({ default: 0 })
  automatedSkills: number;

  @Column({ default: 0 })
  pendingLayerPushes: number;

  @Column({ type: 'text', nullable: true })
  reportHtml: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reportGeneratedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
