import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 21 - Website Blog. One row per customer-month blog (1..30). The Admin writes the blog content and PUSHES it to the
// customer panel (pushedAt); the customer only reads it in rich-text view and Approves / Rejects with a comment.
export const BLOG_STATUSES = ['draft', 'pending_review', 'approved', 'auto_approved', 'rejected', 'published'] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];
export interface BlogComment { at: string; by: 'customer' | 'admin'; action: string; comment: string }

@Entity('website_blogs')
@Unique('website_blog_slot', ['projectId', 'blogNo'])
@Index('website_blog_customer', ['customerId', 'monthIndex'])
export class WebsiteBlog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  @Column({ type: 'int' }) blogNo: number;
  @Column({ type: 'varchar', length: 500, nullable: true }) title: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) slug: string | null;
  @Column({ type: 'text', nullable: true }) metaTags: string | null;
  @Column({ type: 'text', nullable: true }) metaDescription: string | null;
  @Column({ type: 'text', nullable: true }) intro: string | null;
  @Column({ type: 'longtext', nullable: true }) body: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) targetKeyword: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) h1: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) h2: string | null;
  @Column({ type: 'varchar', length: 700, nullable: true }) targetWebpage: string | null;
  @Column({ type: 'date', nullable: true }) productionDate: string | null;
  @Column({ type: 'date', nullable: true }) publishDate: string | null;
  @Column({ type: 'int', default: 0 }) wordCount: number;
  @Column({ type: 'varchar', length: 20, default: 'draft' }) status: BlogStatus;
  // null = not on the customer panel (draft, or a copied blog the Admin has not pushed)
  @Column({ type: 'datetime', nullable: true }) pushedAt: Date | null;
  @Column({ type: 'datetime', nullable: true }) reviewDueAt: Date | null;
  @Column({ type: 'datetime', nullable: true }) reviewActionAt: Date | null;
  @Column({ type: 'text', nullable: true }) customerComment: string | null;
  @Column({ type: 'json', nullable: true }) comments: BlogComment[] | null;
  @Column({ type: 'varchar', length: 700, nullable: true }) blogUrl: string | null;
  @Column({ type: 'varchar', length: 20, default: 'engine' }) source: string;
  @Column({ type: 'varchar', length: 40, nullable: true }) wpBlogId: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
