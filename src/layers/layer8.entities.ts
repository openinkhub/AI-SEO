import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 8 - AI Similar Product / Service: up to 10 ranked similar / alternative / related products or services
// per AI platform per customer month.
@Entity('layer8_items')
@Unique('layer8_it_unique', ['projectId', 'platform', 'rank'])
@Index('layer8_it_customer', ['customerId', 'monthIndex'])
export class Layer8Item {
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

  // The discovered similar / alternative / substitute / complementary product or service.
  @Column({ type: 'varchar', length: 255 })
  item: string;

  // Similar Product | Similar Service | Alternative Product | Alternative Service | Substitute | Complementary | Related Solution
  @Column({ type: 'varchar', length: 30 })
  relationshipType: string;

  // Informational | Commercial | Transactional | Local | Purchase | Evaluational
  @Column({ type: 'varchar', length: 20 })
  searchIntent: string;

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
@Entity('layer8_platforms')
@Unique('layer8_pf_unique', ['projectId', 'platform'])
export class Layer8Platform {
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
