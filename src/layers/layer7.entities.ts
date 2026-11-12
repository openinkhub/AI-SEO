import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 7 - Google People Also Ask: up to 30 verified PAA questions per customer month (no AI platforms).
@Entity('layer7_questions')
@Unique('layer7_q_unique', ['projectId', 'rank'])
@Index('layer7_q_customer', ['customerId', 'monthIndex'])
export class Layer7Question {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  @Column({ type: 'int' })
  monthIndex: number;

  @Column({ name: 'rank_no', type: 'int' })
  rank: number;

  // The exact question Google shows under "People also ask".
  @Column({ type: 'varchar', length: 600 })
  question: string;

  // The Google search query that produced the question.
  @Column({ type: 'varchar', length: 300 })
  searchQuery: string;

  // Always "Google People Also Ask".
  @Column({ type: 'varchar', length: 40, default: 'Google People Also Ask' })
  source: string;

  // Google result URL given by the retrieval provider; empty when not available (never invented).
  @Column({ type: 'varchar', length: 1000, nullable: true })
  sourceUrl: string | null;

  @Column({ type: 'datetime' })
  retrievedAt: Date;

  // 'serpapi' | 'scrapedo' | 'manual'
  @Column({ type: 'varchar', length: 12, default: 'serpapi' })
  provider: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// One row per month: how the last run went.
@Entity('layer7_state')
@Unique('layer7_st_unique', ['projectId'])
export class Layer7State {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  // idle | running | complete | failed
  @Column({ type: 'varchar', length: 12, default: 'idle' })
  status: string;

  @Column({ type: 'varchar', length: 400, nullable: true })
  message: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastRunAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
