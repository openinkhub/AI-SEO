import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// A Customer's uploaded "Branded Image" (Page Image Library Section 2).
// Capped at 30 distinct images per customer (service-enforced, not DB-enforced).
//
// STORAGE CAVEAT: files are written to local disk under UPLOAD_DIR. On
// Hostinger, the running app's working directory is a fresh, versioned
// build folder on every deploy (see migration-plan doc) — anything written
// to local disk here is WIPED on the next git deploy. This is fine for
// local/dev verification but must move to object storage (e.g. the planned
// Cloudflare R2 bucket, assets.openinkhub.io) before this goes live with
// real customer images. Swap by re-implementing storeFile/deleteFile below.
@Entity('library_images')
export class LibraryImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  filename: string;

  @Column()
  url: string;

  // Object key in Cloudflare R2 (null for a legacy local-disk image).
  @Column({ type: 'varchar', nullable: true })
  storageKey: string | null;

  @Column({ nullable: true })
  altText: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
