import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Admin-side to-do list per customer and month cycle (Layer 3 > SEO Audit). The list of tasks itself lives in code
// (cycle-tasks.ts); this table only stores what the admin has done: tick, note, who and when.
@Entity('admin_cycle_tasks')
@Index(['customerId', 'monthCode', 'taskKey'], { unique: true })
export class AdminCycleTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  customerId: string;

  @Column({ type: 'varchar', length: 20, default: '' })
  monthCode: string;

  @Column({ type: 'varchar', length: 60 })
  taskKey: string;

  @Column({ type: 'boolean', default: false })
  done: boolean;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  doneBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  doneAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
