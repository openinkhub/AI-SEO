import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Engine equivalent of the WP plugin's Layer 1-3 "Onboarding & Profile
// Ownership" — the Company Profile card on the ACT portal's Profile page.
// One row per agency client ("Customer" here = the WP plugin's per-user
// profile owner).
export enum CustomerStatus {
  ONBOARDING = 'onboarding',
  ACTIVE = 'active',
  PAUSED = 'paused',
}

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // WP user ID this customer was synced from (WP↔Engine integration,
  // decisions 1/2/4). Null for a customer created directly in the
  // Engine (e.g. manually by Admin) rather than via WP signup sync.
  @Column({ nullable: true, unique: true })
  wpUserId: string | null;

  // 'wp_sync' = created/kept in sync from the WP signup/profile flow;
  // 'manual' = created directly in the Engine admin dashboard.
  @Column({ default: 'manual' })
  source: string;

  @Column()
  companyName: string;

  @Column({ nullable: true })
  website: string | null;

  @Column({ nullable: true })
  industry: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ nullable: true })
  contactName: string | null;

  @Column({ nullable: true })
  contactEmail: string | null;

  @Column({ nullable: true })
  contactPhone: string | null;

  @Column({ nullable: true })
  address: string | null;

  // Stored as JSON text for portability across MySQL versions.
  @Column({ type: 'simple-json', nullable: true })
  competitors: string[] | null;

  @Column({ type: 'enum', enum: CustomerStatus, default: CustomerStatus.ONBOARDING })
  status: CustomerStatus;

  @Column({ nullable: true })
  assignedToUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
