import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 9 - AI FAQ Discovery: up to 10 ranked customer FAQ questions per AI platform per customer month (questions only, no answers).
@Entity('layer9_faqs')
@Unique('layer9_fq_unique', ['projectId', 'platform', 'rank'])
@Index('layer9_fq_customer', ['customerId', 'monthIndex'])
export class Layer9Faq {
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

  // One complete natural-language FAQ question (no answer).
  @Column({ type: 'varchar', length: 600 })
  question: string;

  // Product / Service | Information | Process | Cost / Pricing | Availability | Location | Comparison | Eligibility | Purchase | Usage | Support | Problem / Concern | Post-Purchase
  @Column({ type: 'varchar', length: 30 })
  faqType: string;

  // Informational | Commercial | Transactional | Local | Evaluational | Navigational
  @Column({ type: 'varchar', length: 20 })
  searchIntent: string;

  // Awareness | Consideration | Decision | Purchase | Post-Purchase
  @Column({ type: 'varchar', length: 20 })
  customerJourney: string;

  // High | Medium-High | Medium
  @Column({ type: 'varchar', length: 20 })
  relevance: string;

  // 'api' | 'manual' | 'import'
  @Column({ type: 'varchar', length: 10, default: 'api' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// One row per platform per month: how it is filled (api / manual) and how the last run went.
@Entity('layer9_platforms')
@Unique('layer9_pf_unique', ['projectId', 'platform'])
export class Layer9Platform {
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
