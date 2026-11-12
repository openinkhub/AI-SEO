import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 5 - AI Search Prompt: up to 10 ranked prompts per AI platform per customer month.
@Entity('layer5_prompts')
@Unique('layer5_pr_unique', ['projectId', 'platform', 'rank'])
@Index('layer5_pr_customer', ['customerId', 'monthIndex'])
export class Layer5Prompt {
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

  // The natural-language prompt a buyer would type into the AI platform.
  @Column({ type: 'varchar', length: 600 })
  prompt: string;

  // Informational | Navigational | Commercial | Transactional | Local | Purchase | Evaluational | Compliance
  @Column({ type: 'varchar', length: 20 })
  intent: string;

  // Discovery | Research | Comparison | Evaluation | Recommendation | Problem-Solution | Purchase | Local | Compliance
  @Column({ type: 'varchar', length: 20 })
  promptType: string;

  // High | Medium-High | Medium | Low
  @Column({ type: 'varchar', length: 20 })
  demand: string;

  // The search keyword this prompt maps to (product / service + location from the profile), used to look up volume.
  @Column({ type: 'varchar', length: 255, nullable: true })
  volumeQuery: string | null;

  // Average monthly searches for volumeQuery (the AI platform's own estimate, or typed / imported).
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
@Entity('layer5_platforms')
@Unique('layer5_pf_unique', ['projectId', 'platform'])
export class Layer5Platform {
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
