import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 10 - AI Quora Q&A: up to 10 verified Quora questions per AI platform per customer month (fewer is allowed).
@Entity('layer10_quora')
@Unique('layer10_qu_unique', ['projectId', 'platform', 'rank'])
@Index('layer10_qu_customer', ['customerId', 'monthIndex'])
export class Layer10Quora {
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

  // The Quora question / discussion title as found on Quora (not rewritten).
  @Column({ type: 'varchar', length: 600 })
  question: string;

  @Column({ type: 'varchar', length: 200 })
  topic: string;

  @Column({ type: 'varchar', length: 255 })
  primaryKeyword: string;

  // Informational | Commercial | Transactional | Navigational | Comparison | Local
  @Column({ type: 'varchar', length: 20 })
  searchIntent: string;

  // Short explanation of why the question matters for the customer's product / service and audience.
  @Column({ type: 'varchar', length: 500 })
  relevance: string;

  // Direct https quora.com URL (never invented: records without one are rejected).
  @Column({ type: 'varchar', length: 1000 })
  quoraUrl: string;

  // 'api' | 'manual' | 'import'
  @Column({ type: 'varchar', length: 10, default: 'api' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// One row per platform per month: how it is filled (api / manual) and how the last run went.
@Entity('layer10_platforms')
@Unique('layer10_pf_unique', ['projectId', 'platform'])
export class Layer10Platform {
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
