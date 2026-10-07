import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InvoiceStatus = 'paid' | 'unpaid';

// One monthly bill the admin uploads for a customer (Profile > Billing).
// Decided 2026-10-07: Month cycle, date, invoice no, amount, paid/unpaid,
// plus the bill file itself (PDF/image) stored in Cloudflare R2.
@Entity('invoices')
@Index(['customerId', 'invoiceNo'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  customerId: string;

  // Which month of the customer's 30-day cycle this bill is for (M0..M12).
  @Column({ type: 'int' })
  monthIndex: number;

  @Column({ type: 'varchar', length: 8 })
  monthCode: string;

  // Copied from the month at creation time so the bill keeps showing the
  // cycle it was raised for.
  @Column({ type: 'varchar', length: 10, nullable: true })
  cycleStart: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  cycleEnd: string | null;

  @Column({ type: 'varchar', length: 10 })
  invoiceDate: string;

  @Column({ type: 'varchar', length: 64 })
  invoiceNo: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string | number | null) => (v == null ? null : Number(v)),
    },
  })
  amount: number;

  @Column({ type: 'varchar', length: 8, default: 'INR' })
  currency: string;

  @Column({ type: 'varchar', length: 8, default: 'unpaid' })
  status: InvoiceStatus;

  @Column({ type: 'varchar', length: 10, nullable: true })
  paidDate: string | null;

  // The uploaded bill (optional).
  @Column({ type: 'varchar', length: 512, nullable: true })
  fileUrl: string | null;

  // Original file name, for display.
  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  // Object key in R2 (null for a local-disk dev upload).
  @Column({ type: 'varchar', length: 512, nullable: true })
  storageKey: string | null;

  // Name the file was stored under (needed to delete a local-disk copy).
  @Column({ type: 'varchar', length: 255, nullable: true })
  storedName: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
