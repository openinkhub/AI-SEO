import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// One row per (customer, provider). All field values live in one encrypted blob.
@Entity('customer_api_settings')
@Index(['customerId', 'provider'], { unique: true })
export class CustomerApiSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column({ type: 'varchar', length: 40 })
  provider: string;

  @Column({ type: 'text' })
  valuesEnc: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  // Non-secret echo of the last 4 characters of each secret, for display only: {fieldName: '1a2b'}.
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
