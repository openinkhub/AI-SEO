import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ImportRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  EMPTY = 'empty',
  FAILED = 'failed',
}

// One row per historical-import attempt (decision 5: "build the import
// mechanism now, run it empty today"). Reusable scaffold - once a
// history-bearing layer migrates and WP's export route exists, the same
// run path starts producing real recordsImported counts instead of
// 'empty'.
@Entity('import_runs')
export class ImportRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  wpUserId: string | null; // null = "all customers" run

  @Column({ type: 'enum', enum: ImportRunStatus, default: ImportRunStatus.PENDING })
  status: ImportRunStatus;

  @Column({ default: 0 })
  recordsImported: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  startedAt: Date;

  @UpdateDateColumn()
  finishedAt: Date;
}
