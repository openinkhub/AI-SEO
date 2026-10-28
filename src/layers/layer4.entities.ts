import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 4 - AI Search Keyword: up to 10 ranked keywords per AI platform per customer month.
@Entity('layer4_keywords')
@Unique('layer4_kw_unique', ['projectId', 'platform', 'rank'])
@Index('layer4_kw_customer', ['customerId', 'monthIndex'])
export class Layer4Keyword {
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

  @Column({ type: 'varchar', length: 255 })
  keyword: string;

  // Informational | Navigational | Commercial | Transactional | Local | Purchase | Evaluational | Compliance
  @Column({ type: 'varchar', length: 20 })
  intent: string;

  // High | Medium-High | Medium | Low
  @Column({ type: 'varchar', length: 20 })
  demand: string;

  // The AI platform's own estimate of average monthly searches (from the prompt).
  @Column({ type: 'int', nullable: true })
  estVolume: number | null;

  // Updated volume from a real keyword tool (Mangools), when it has the keyword.
  @Column({ type: 'int', nullable: true })
  volume: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  volumeSource: string | null;

  // 'api' | 'manual'
  @Column({ type: 'varchar', length: 10, default: 'api' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// One row per platform per month: how it is filled (api / manual) and how the last run went.
@Entity('layer4_platforms')
@Unique('layer4_pf_unique', ['projectId', 'platform'])
export class Layer4Platform {
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
