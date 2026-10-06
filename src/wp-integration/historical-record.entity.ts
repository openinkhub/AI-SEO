import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Raw, opaque storage for imported WP history (decision 2, "full
// task/history records") until the real WP schema is known and a
// proper column-level mapping can be built. One row per WP-side record;
// `payload` keeps the record exactly as WP sent it so nothing is lost
// to a premature guess at its shape.
@Entity('historical_records')
export class HistoricalRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  wpUserId: string;

  @Column({ nullable: true })
  customerId: string | null;

  @Column()
  recordType: string;

  @Column({ type: 'simple-json' })
  payload: unknown;

  @Column({ nullable: true })
  sourceVersion: string | null;

  @CreateDateColumn()
  importedAt: Date;
}
