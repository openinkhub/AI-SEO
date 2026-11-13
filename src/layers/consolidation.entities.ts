import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 11 - Keyword Analysis blocks, numbered by the original Layer (L4 .. L10): each is the consolidated, de-duplicated and weighted view of one
// source Layer (block L4 = Layer 4 ... block L10 = Layer 10). Built automatically right after the source Layer is complete.
// Re-building a block replaces all of its rows (idempotent).
@Entity('layer11_records')
@Unique('layer11_rec_unique', ['projectId', 'block', 'rank'])
@Index('layer11_rec_customer', ['customerId', 'monthIndex'])
export class ConsolidatedRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  @Column({ type: 'int' })
  monthIndex: number;

  // 'L4' .. 'L10' = the original Layer number
  @Column({ type: 'varchar', length: 4 })
  block: string;

  // Final rating = position after sorting by weightage (1 = best).
  @Column({ name: 'rank_no', type: 'int' })
  rank: number;

  @Column({ type: 'varchar', length: 500 })
  record: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  intent: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  demand: string | null;

  // 0-100
  @Column({ type: 'float', default: 0 })
  weightage: number;

  // 1-5
  @Column({ type: 'int', default: 1 })
  starRating: number;

  // How many source records were merged into this one.
  @Column({ type: 'int', default: 1 })
  occurrences: number;

  @Column({ type: 'simple-json', nullable: true })
  platforms: string[] | null;

  // Average of the AI platforms' own estimates (Layers 4-6 only).
  @Column({ type: 'int', nullable: true })
  estVolume: number | null;

  // Block specific fields (relationship type, FAQ type, topic, Quora URL, ...).
  @Column({ type: 'simple-json', nullable: true })
  extra: Record<string, any> | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  overview: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
