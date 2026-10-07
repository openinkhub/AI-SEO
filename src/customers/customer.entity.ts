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

  // ---- Layer 1 "ACT Account Registration" (mirrors the WP account) ----
  // WP user_email: the account / login email ("Registered Email").
  @Column({ nullable: true })
  accountEmail: string | null;

  // WP display/login name ("User Name - Login Identity").
  @Column({ nullable: true })
  userName: string | null;

  // WP user_registered, kept as the raw 'YYYY-MM-DD HH:mm:ss' string WP
  // stores (the Month Cycle rule uses only its date part, no timezone shift).
  @Column({ type: 'varchar', length: 19, nullable: true })
  registeredAt: string | null;

  // Admin-only "ACT authoritative date" override; null = use registeredAt.
  @Column({ type: 'varchar', length: 19, nullable: true })
  actDate: string | null;

  // Page Image Library: how many pages the first live fetch found (WP's
  // "Originally Fetched"). Re-baselined when a fetch runs on an empty library.
  @Column({ type: 'int', nullable: true })
  pagesFetchedCount: number | null;

  // Where notifications go. Null = fall back to accountEmail (WP behaviour:
  // "Registered Email Fallback"). Editable by Admin and by the customer in
  // the onboarding form.
  @Column({ nullable: true })
  notificationEmail: string | null;

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

  // Decided 2026-10-06: "wp plugin will be only customer view portal" /
  // "onboarding form will be sent from engine" — new WP signups no longer
  // get WP's own onboarding form/email; the Engine owns onboarding end to
  // end instead. onboardingToken is the bearer credential for the public,
  // unauthenticated onboarding form (src/onboarding/) — set once when a
  // brand-new wp_sync customer is created, never regenerated automatically
  // (re-sharing the same link lets a customer resume/edit before they
  // finish). Null for a customer that never went through this flow
  // (manually created, or synced before this feature existed).
  @Column({ nullable: true, unique: true })
  onboardingToken: string | null;

  // Set the first time the onboarding email actually sends successfully -
  // guards against re-emailing on every future wp-sync upsert of the same
  // customer (upsertFromWp runs on more than just the first signup call).
  @Column({ type: 'datetime', nullable: true })
  onboardingEmailSentAt: Date | null;

  // Set when the customer submits the onboarding form (src/onboarding/).
  // Informational only for now - does not lock the form, since a customer
  // may legitimately need to come back and correct something.
  @Column({ type: 'datetime', nullable: true })
  onboardingCompletedAt: Date | null;

  // Full onboarding/Company-Profile data (WP: KP21_Onboarding's ~31-field
  // form — brand_name, legal_name, entity_type, founded_year, industry,
  // business_domain, sector, primary_business_category,
  // secondary_business_categories, business_model, service_area,
  // areas_served, tagline, product_short_description, mission_statement,
  // company_profile, phone, public_email, address_line_1, town, state,
  // pincode, domain, target_page, secondary_websites,
  // target_customer_segments, seed_keywords, locations, products_services,
  // competitors, dns_access_confirmed). Kept as one JSON blob rather than 31
  // columns: it maps 1:1 onto WP's own field keys (so wp-sync payloads pass
  // through unchanged) and the Admin dashboard renders/edits it generically
  // off a shared field-definition list instead of a migration per field.
  @Column({ type: 'simple-json', nullable: true })
  profile: Record<string, string | string[] | boolean> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
