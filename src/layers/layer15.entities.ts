import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layers 15, 16, 17 - Blog Intent Primary / Sub-Primary / Secondary (Off Page SEO > Blogs). ALLOCATION ONLY (port of the plugin's
// layer15_17 allocation, contract v8.9.152): each Layer holds 30 blog slots; every slot takes one value from each final pool
// (Layer 14 H1 fixed anchor + H2, and the consolidated Layer 5..10 blocks = 11-B..11-G). The generated fields (intro, intent, meta)
// stay blank here: Layers 18-20 write them.
@Entity('layer15_rows')
@Unique('layer15_row_unique', ['projectId', 'layerNo', 'blogNo'])
@Index('layer15_row_customer', ['customerId', 'monthIndex'])
export class Layer15Row {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  // 15 | 16 | 17
  @Column({ type: 'int' }) layerNo: number;
  // 1..30
  @Column({ type: 'int' }) blogNo: number;
  // Fixed Layer 14 rank-1 keyword (common to the 30 slots of every Layer).
  @Column({ type: 'varchar', length: 500, nullable: true }) h1: string | null;
  // Layer 14 H2 allocation.
  @Column({ type: 'varchar', length: 500, nullable: true }) h2: string | null;
  // 11-B AI prompt / 11-C long-tail keyword / 11-D PAA / 11-E similar product-service / 11-F FAQ / 11-G Quora question.
  @Column({ type: 'varchar', length: 500, nullable: true }) h3: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) h4: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) paa: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) similar: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) faq: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) quora: string | null;
  // The slot's main keyword: Layer 15 = H1, Layer 16 = H2 (else H1), Layer 17 = 11-B prompt (else H1).
  @Column({ type: 'varchar', length: 500, nullable: true }) primaryKeyword: string | null;
  @Column({ type: 'varchar', length: 4, default: 'H1' }) hierarchy: string;
  @Column({ type: 'int', nullable: true }) layer14Rank: number | null;
  // Written downstream (Layers 18-20); blank in this Layer.
  @Column({ type: 'text', nullable: true }) blogIntro: string | null;
  @Column({ type: 'text', nullable: true }) blogIntent: string | null;
  @Column({ type: 'text', nullable: true }) metaTitle: string | null;
  @Column({ type: 'text', nullable: true }) metaTags: string | null;
  @Column({ type: 'text', nullable: true }) metaDescription: string | null;
  // Source rank of every allocated value.
  @Column({ type: 'simple-json', nullable: true }) sources: Record<string, number | null> | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
