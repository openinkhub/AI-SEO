import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 6 - AI Search Long Tail Keyword: up to 10 ranked long-tail keywords per AI platform per customer month.
@Entity('layer6_keywords')
@Unique('layer6_kw_unique', ['projectId', 'platform', 'rank'])
@Index('layer6_kw_customer', ['customerId', 'monthIndex'])
export class Layer6Keyword {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  @Column({ type: 'int' })
  monthIndex: number;

  @Column({ type: 'varchar', length: 30 })
  platform: string;

  @Column({ name: 'rank_no', type: 'int' })
  rank: number;

  // A specific natural-language multi-word search query (3 words or more).
  @Column({ type: 'varchar', length: 255 })
  keyword: string;

  // Informational | Navigational | Commercial | Transactional | Local | Purchase | Evaluational | Compliance
  @Column({ type: 'varchar', length: 20 })
  intent: string;

  // Derived from the keyword and intent: Question | Local | Comparison | Problem-Solution | Buyer Intent | Commercial / Evaluation | Product / Service
  @Column({ type: 'varchar', length: 30 })
  keywordType: string;

  // High | Medium-High | Medium | Low
  @Column({ type: 'varchar', length: 20 })
  demand: string;

  // Average monthly searches (the AI platform's own estimate, or typed / imported).
  @Column({ type: 'int', nullable: true })
  estVolume: number | null;

  // 'api' | 'manual' | 'import'
  @Column({ type: 'varchar', length: 10, default: 'api' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// One row per platform per month: how it is filled (api / manual) and how the last run went.
@Entity('layer6_platforms')
@Unique('layer6_pf_unique', ['projectId', 'platform'])
export class Layer6Platform {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  @Column({ type: 'varchar', length: 30 })
  platform: string;

  @Column({ type: 'varchar', length: 10, default: 'api' })
  mode: string;

  // idle | running | complete | partial | failed
  @Column({ type: 'varchar', length: 12, default: 'idle' })
  status: string;

  @Column({ type: 'varchar', length: 400, nullable: true })
  message: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastRunAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
