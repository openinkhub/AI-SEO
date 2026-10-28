import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// One row per global provider (Moz, ...). Field values live in one encrypted blob (same crypto as customer APIs).
@Entity('global_api_settings')
@Index(['provider'], { unique: true })
export class GlobalApiSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  provider: string;

  @Column({ type: 'text' })
  valuesEnc: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'text', nullable: true })
  hints: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  lastStatus: 'ok' | 'failed' | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastMessage: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastCheckedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
