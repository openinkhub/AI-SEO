import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 11 - Keyword Analysis (seed keywords + Quora primary keywords, validated with Mangools / KWFinder, plus
// competitor keywords from Keywords Everywhere). One row per distinct keyword per customer month.
@Entity('layer11_keywords')
@Unique('layer11_kw_unique', ['projectId', 'keyNorm'])
@Index('layer11_kw_customer', ['customerId', 'monthIndex'])
export class Layer11Keyword {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  @Column({ type: 'int' })
  monthIndex: number;

  // Final rating = position after sorting by weightage (1 = best).
  @Column({ name: 'rank_no', type: 'int', default: 0 })
  rank: number;

  @Column({ type: 'varchar', length: 500 })
  keyword: string;

  // Lower-cased, punctuation-free form used to keep keywords unique.
  @Column({ type: 'varchar', length: 300 })
  keyNorm: string;

  // 'Customer Seed Keyword' | 'Quora Primary Keyword' | 'Mangools / KWFinder Seed Validation' | 'Keywords Everywhere Competitor Keyword'
  @Column({ type: 'varchar', length: 60 })
  source: string;

  @Column({ type: 'boolean', default: false })
  isSeed: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  competitorDomain: string | null;

  // Monthly search volume as reported by Mangools / Keywords Everywhere; null = not validated yet.
  @Column({ type: 'int', nullable: true })
  volume: number | null;

  @Column({ type: 'float', nullable: true })
  cpc: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  competition: string | null;

  // High | Medium-High | Medium | Low | Pending Market Evidence
  @Column({ type: 'varchar', length: 40, default: 'Pending Market Evidence' })
  demand: string;

  @Column({ type: 'float', default: 0 })
  weightage: number;

  @Column({ type: 'int', default: 1 })
  starRating: number;

  // Seed rows only: true once Mangools returned this exact keyword.
  @Column({ type: 'boolean', default: false })
  validated: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// One row per month: how the last run went.
@Entity('layer11_state')
@Unique('layer11_st_unique', ['projectId'])
export class Layer11State {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  projectId: string;

  // idle | running | complete | partial | failed   (partial = some step was skipped, e.g. a missing API key)
  @Column({ type: 'varchar', length: 12, default: 'idle' })
  status: string;

  @Column({ type: 'varchar', length: 400, nullable: true })
  message: string | null;

  // Step-by-step warnings of the last run (missing key, rejected key, no location ...).
  @Column({ type: 'simple-json', nullable: true })
  warnings: string[] | null;

  // Mangools KWFinder location resolved for this customer.
  @Column({ type: 'int', nullable: true })
  locationId: number | null;

  @Column({ type: 'datetime', nullable: true })
  lastRunAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
