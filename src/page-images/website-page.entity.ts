import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A Customer's real website page (fetched live or added manually), with an
// optional mapping to a LibraryImage. Engine equivalent of the WP plugin's
// Page Image Library "Section 1: Website Page URLs" + "Section 3: Mapping".
@Entity('website_pages')
export class WebsitePage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  pageUrl: string;

  // Lowercased, protocol/www/trailing-slash-stripped form of pageUrl, used
  // only to detect duplicates on re-fetch — never shown to the user.
  @Column()
  normalizedUrl: string;

  @Column({ nullable: true })
  pageName: string | null;

  @Column({ nullable: true })
  libraryImageId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
