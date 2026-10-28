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

  // Month cycle this audit belongs to (the audit runs once per cycle). Null on runs made before the rule.
  @Column({ type: 'varchar', length: 64, nullable: true })
  projectId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  monthCode: string | null;

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

  // Customer-facing (short) report; reportHtml above is the full admin report.
  @Column({ type: 'text', nullable: true })
  customerReportHtml: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reportGeneratedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  // Research enrichment (keyword / competitor / local sources + per-task write-ups) runs after the run is saved.
  @Column({ type: 'varchar', length: 16, nullable: true })
  enrichStatus: string | null;

  @Column({ type: 'text', nullable: true })
  enrichNote: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
