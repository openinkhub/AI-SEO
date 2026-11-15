import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { LinkStep, OutlineItem } from './cluster.plan';

// Layers 22 / 23 / 24 - Blog Tier 1 / Tier 2 / Tier 3. One row per article of the month (180 / 180 / 540):
// imported from the mapping layers (Tier 1 = Layers 16 + 18, Tier 2 = 17 + 19, Tier 3 = 17 + 20), written by the Admin,
// then published (live URL). The Final Output Table is the customer's view once every article is published.
export const TIER_LAYERS = [22, 23, 24] as const;
export type TierStatus = 'pending' | 'written' | 'published';

@Entity('tier_blogs')
@Unique('tier_blog_code', ['projectId', 'code'])
@Index('tier_blog_layer', ['projectId', 'layerNo', 'seq'])
@Index('tier_blog_customer', ['customerId', 'monthIndex'])
export class TierBlog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  @Column({ type: 'int' }) layerNo: number;
  @Column({ type: 'varchar', length: 40 }) code: string;
  @Column({ type: 'int' }) seq: number;
  @Column({ type: 'int', nullable: true }) siteNo: number | null;
  @Column({ type: 'int', nullable: true }) subSite: number | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) parentCode: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) platform: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) siteUrl: string | null;
  @Column({ type: 'varchar', length: 700, nullable: true }) targetPageUrl: string | null;
  // ---- imported brief (refreshed on every import) ----
  @Column({ type: 'varchar', length: 500, nullable: true }) primaryKeyword: string | null;
  @Column({ type: 'simple-json', nullable: true }) secondaryKeywords: string[] | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) objective: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) angle: string | null;
  @Column({ type: 'varchar', length: 400, nullable: true }) audience: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) tone: string | null;
  @Column({ type: 'text', nullable: true }) intro: string | null;
  @Column({ type: 'simple-json', nullable: true }) outline: OutlineItem[] | null;
  @Column({ type: 'simple-json', nullable: true }) linkPlan: LinkStep[] | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) anchorText: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) cta: string | null;
  // ---- written by the Admin ----
  @Column({ type: 'varchar', length: 500, nullable: true }) title: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) slug: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) metaTitle: string | null;
  @Column({ type: 'text', nullable: true }) metaDescription: string | null;
  @Column({ type: 'text', nullable: true }) metaTags: string | null;
  @Column({ type: 'longtext', nullable: true }) body: string | null;
  @Column({ type: 'int', default: 0 }) wordCount: number;
  // ---- publishing ----
  @Column({ type: 'date', nullable: true }) publishDate: string | null;
  @Column({ type: 'varchar', length: 700, nullable: true }) publishedUrl: string | null;
  @Column({ type: 'varchar', length: 12, default: 'pending' }) status: TierStatus;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
