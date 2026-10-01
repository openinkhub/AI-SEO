import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// One AuditTask per catalog skill per AuditRun — the "Task section" of the
// user's spec: "all 140 skills will be task". Every catalog field is
// snapshotted onto the row at creation (same pattern as Layer 21's blog
// snapshot of Industry/Business Domain/Sector) so editing the catalog
// later never rewrites a completed run's history.
export enum AuditTaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('audit_tasks')
export class AuditTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  auditRunId: string;

  // Snapshot of AuditSkillDef — see audit-skills.catalog.ts.
  @Column()
  skillId: string;

  @Column()
  group: string;

  @Column()
  plugin: string;

  @Column()
  skill: string;

  @Column({ type: 'text' })
  finds: string;

  @Column({ type: 'text' })
  actionOutput: string;

  @Column()
  resultNature: string;

  @Column()
  implementationType: string;

  @Column()
  actionType: string;

  @Column({ type: 'text' })
  layerMappingRaw: string;

  @Column({ type: 'simple-json' })
  layerNumbers: number[];

  // Whether this run actually executed a live check (technical-analyzer.ts)
  // or produced a scaffolded "data source not yet integrated" placeholder.
  @Column({ default: false })
  isAutomated: boolean;

  @Column({ type: 'enum', enum: AuditTaskStatus, default: AuditTaskStatus.PENDING })
  status: AuditTaskStatus;

  @Column({ type: 'text', nullable: true })
  finding: string | null;

  @Column({ type: 'text', nullable: true })
  suggestion: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
