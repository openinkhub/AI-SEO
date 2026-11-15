import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { LinkStep, OutlineItem } from './cluster.plan';

// Layers 15-17 - Topical Blog Intent cluster (Off Page SEO > Blogs). Per customer-month: 6 Admin-picked target pages (cluster_pages)
// and 930 planned articles (cluster_articles): 30 website blogs (Layer 15) + 180 Tier 1 (Layer 16) + 180 Tier 2 + 540 Tier 3 (Layer 17).
@Entity('cluster_pages')
@Unique('cluster_page_slot', ['projectId', 'slot'])
@Index('cluster_page_customer', ['customerId', 'monthIndex'])
export class ClusterPageRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  // 1..6 = the order the Admin picked the pages
  @Column({ type: 'int' }) slot: number;
  @Column() websitePageId: string;
  @Column({ type: 'varchar', length: 700 }) pageUrl: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) pageName: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) h1: string | null;
  // The Layer 14 keyword mapped to this page (set when the cluster is built).
  @Column({ type: 'varchar', length: 500, nullable: true }) primaryKeyword: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('cluster_articles')
@Unique('cluster_article_code', ['projectId', 'code'])
@Index('cluster_article_layer', ['projectId', 'layerNo', 'seq'])
@Index('cluster_article_customer', ['customerId', 'monthIndex'])
export class ClusterArticle {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  // 15 website blog | 16 Tier 1 | 17 Tier 2 + Tier 3
  @Column({ type: 'int' }) layerNo: number;
  // 0 website blog, 1, 2, 3
  @Column({ type: 'int' }) tier: number;
  @Column({ type: 'varchar', length: 40 }) code: string;
  @Column({ type: 'int' }) seq: number;
  @Column({ type: 'int' }) blogNo: number;
  @Column({ type: 'int' }) pageSlot: number;
  @Column({ type: 'int', nullable: true }) articleInPage: number | null;
  @Column({ type: 'int', nullable: true }) siteNo: number | null;
  @Column({ type: 'int', nullable: true }) subSite: number | null;
  @Column({ type: 'int', nullable: true }) articleNo: number | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) parentCode: string | null;
  @Column({ type: 'varchar', length: 700 }) targetPageUrl: string;
  // keyword mapping
  @Column({ type: 'varchar', length: 500, nullable: true }) h1: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) h2: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) h3: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) h4: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) paa: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) similar: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) faq: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) quora: string | null;
  // Layer 4 AI search keyword (Layer 17 only)
  @Column({ type: 'varchar', length: 500, nullable: true }) aiKeyword: string | null;
  @Column({ type: 'varchar', length: 500 }) primaryKeyword: string;
  @Column({ type: 'varchar', length: 8 }) hierarchy: string;
  @Column({ type: 'simple-json', nullable: true }) secondaryKeywords: string[] | null;
  @Column({ type: 'simple-json', nullable: true }) sources: Record<string, number | boolean | null> | null;
  // writing brief (template + meta algorithm; generatedBy tells how it was made)
  @Column({ type: 'varchar', length: 30 }) role: string;
  @Column({ type: 'varchar', length: 300 }) title: string;
  @Column({ type: 'varchar', length: 100 }) slug: string;
  @Column({ type: 'varchar', length: 100 }) metaTitle: string;
  @Column({ type: 'varchar', length: 300 }) metaDescription: string;
  @Column({ type: 'text' }) metaTags: string;
  @Column({ type: 'varchar', length: 20 }) intentType: string;
  @Column({ type: 'varchar', length: 20 }) journeyStage: string;
  @Column({ type: 'varchar', length: 300 }) objective: string;
  @Column({ type: 'varchar', length: 300 }) angle: string;
  @Column({ type: 'varchar', length: 400 }) audience: string;
  @Column({ type: 'varchar', length: 200 }) tone: string;
  @Column({ type: 'text' }) intro: string;
  @Column({ type: 'simple-json' }) outline: OutlineItem[];
  @Column({ type: 'int' }) wordTarget: number;
  @Column({ type: 'text' }) placementRules: string;
  @Column({ type: 'simple-json' }) linkPlan: LinkStep[];
  @Column({ type: 'varchar', length: 300, nullable: true }) anchorText: string | null;
  @Column({ type: 'varchar', length: 300 }) cta: string;
  @Column({ type: 'varchar', length: 30 }) schemaType: string;
  @Column({ type: 'text' }) imageBrief: string;
  @Column({ type: 'text' }) avoid: string;
  @Column({ type: 'varchar', length: 10 }) publishDate: string;
  // Layers 18-20 (platform / site, assigned when the cluster is built) and Layer 21 (published URL, filled later).
  @Column({ type: 'varchar', length: 200, nullable: true }) platform: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) siteUrl: string | null;
  @Column({ type: 'varchar', length: 700, nullable: true }) publishedUrl: string | null;
  @Column({ type: 'varchar', length: 20, default: 'planned' }) status: string;
  @Column({ type: 'varchar', length: 20, default: 'template' }) generatedBy: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
