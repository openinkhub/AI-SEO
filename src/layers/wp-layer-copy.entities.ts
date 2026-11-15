import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layers 15-20 copied AS THEY ARE from the WP plugin (Admin > Off Page SEO > Blogs) for a customer's month: the plugin's 30-blog grids
// (15-17) and 240-row dated platform grids (18-20). Read-only copies, kept apart from the Engine's own cluster tables.
@Entity('wp_layer_copies')
@Unique('wp_layer_copy_unique', ['projectId', 'layerNo'])
@Index('wp_layer_copy_customer', ['customerId', 'monthIndex'])
export class WpLayerCopy {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  @Column({ type: 'int' }) layerNo: number;
  // Column headers exactly as the plugin shows them (its Admin / Action control columns are not data and are left out).
  @Column({ type: 'simple-json' }) columns: string[];
  @Column({ type: 'int' }) rowCount: number;
  @Column({ type: 'varchar', length: 40, default: 'WP plugin' }) source: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('wp_layer_rows')
@Unique('wp_layer_row_unique', ['projectId', 'layerNo', 'rowNo'])
export class WpLayerRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) layerNo: number;
  @Column({ type: 'int' }) rowNo: number;
  // Cell texts in column order.
  @Column({ type: 'simple-json' }) cells: string[];
}
