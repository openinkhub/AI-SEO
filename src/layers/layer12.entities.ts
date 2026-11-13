import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Layer 11-AAA master keyword list = the consolidated Layer 4 block (4-A) + the Layer 11 keywords, merged and de-duplicated.
// It is the only input of Layer 12 (port of the plugin's layer11_merge_aaa).
@Entity('layer11_master')
@Unique('layer11_master_unique', ['projectId', 'keyNorm'])
@Index('layer11_master_customer', ['customerId', 'monthIndex'])
export class Layer11Master {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  @Column({ name: 'rank_no', type: 'int', default: 0 }) rank: number;
  @Column({ type: 'varchar', length: 500 }) keyword: string;
  @Column({ type: 'varchar', length: 300 }) keyNorm: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) intent: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) demand: string | null;
  // 'Layer 4-A' | 'Layer 11 seed' | 'Layer 11 competitor' (a keyword found in several sources lists all of them)
  @Column({ type: 'simple-json', nullable: true }) sources: string[] | null;
  @Column({ type: 'boolean', default: false }) isSeed: boolean;
  @Column({ type: 'varchar', length: 255, nullable: true }) competitorDomain: string | null;
  // AI platforms' average estimate (Layer 4-A) and the real volume of Layer 11 (Mangools / Keywords Everywhere).
  @Column({ type: 'int', nullable: true }) estVolume: number | null;
  @Column({ type: 'int', nullable: true }) volume: number | null;
  @Column({ type: 'float', default: 0 }) weightage: number;
  @Column({ type: 'int', default: 1 }) starRating: number;
  @Column({ type: 'varchar', length: 400, nullable: true }) overview: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// Layer 12 - Keyword Market Validation: one row per master keyword (max 80) with Mangools market data, SerpApi competitor
// evidence and Geekflare competitor-page facts. Every metric that is not available stays null (nothing is invented).
@Entity('layer12_rows')
@Unique('layer12_row_unique', ['projectId', 'keyNorm'])
@Index('layer12_row_customer', ['customerId', 'monthIndex'])
export class Layer12Row {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  @Column({ name: 'rank_no', type: 'int', default: 0 }) rank: number;
  @Column({ type: 'varchar', length: 500 }) keyword: string;
  @Column({ type: 'varchar', length: 300 }) keyNorm: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) intent: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) demand: string | null;
  // The 11-AAA weightage this row started from.
  @Column({ type: 'float', default: 0 }) baseWeightage: number;
  @Column({ type: 'int', nullable: true }) estVolume: number | null;
  // Mangools / KWFinder: 12-month average search volume, keyword difficulty, CPC, PPC.
  @Column({ type: 'int', nullable: true }) searchVolume: number | null;
  @Column({ type: 'float', nullable: true }) kd: number | null;
  @Column({ type: 'float', nullable: true }) cpc: number | null;
  @Column({ type: 'float', nullable: true }) ppc: number | null;
  // SerpApi: how many of the customer's competitor sites are in the Google results, and where.
  @Column({ type: 'int', nullable: true }) competitorCount: number | null;
  @Column({ type: 'int', nullable: true }) bestCompetitorPosition: number | null;
  @Column({ type: 'float', nullable: true }) avgCompetitorPosition: number | null;
  @Column({ type: 'float', nullable: true }) competitorStrength: number | null;
  @Column({ type: 'simple-json', nullable: true }) competitorDomains: string[] | null;
  @Column({ type: 'varchar', length: 700, nullable: true }) competitorUrl: string | null;
  // Geekflare factual extraction of the best competitor page.
  @Column({ type: 'simple-json', nullable: true }) page: Record<string, any> | null;
  @Column({ type: 'float', default: 0 }) weightage: number;
  @Column({ type: 'int', default: 1 }) starRating: number;
  // mangools | serpapi | geekflare -> pending | completed | bypassed
  @Column({ type: 'simple-json', nullable: true }) stages: Record<string, string> | null;
  @Column({ type: 'simple-json', nullable: true }) errors: Record<string, string> | null;
  @Column({ type: 'simple-json', nullable: true }) usedWeights: Record<string, number> | null;
  @Column({ type: 'varchar', length: 600, nullable: true }) overview: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('layer12_state')
@Unique('layer12_st_unique', ['projectId'])
export class Layer12State {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  // idle | running | complete | partial | failed
  @Column({ type: 'varchar', length: 12, default: 'idle' }) status: string;
  @Column({ type: 'varchar', length: 400, nullable: true }) message: string | null;
  @Column({ type: 'simple-json', nullable: true }) warnings: string[] | null;
  @Column({ type: 'int', nullable: true }) locationId: number | null;
  @Column({ type: 'datetime', nullable: true }) lastRunAt: Date | null;
  @UpdateDateColumn() updatedAt: Date;
}

// Layer 13 - Intent & Opportunity Analysis: Layer 12 evidence carried forward unchanged plus an Opportunity Score. No API call.
@Entity('layer13_rows')
@Unique('layer13_row_unique', ['projectId', 'keyNorm'])
@Index('layer13_row_customer', ['customerId', 'monthIndex'])
export class Layer13Row {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  @Column({ name: 'rank_no', type: 'int', default: 0 }) rank: number;
  @Column({ type: 'varchar', length: 500 }) keyword: string;
  @Column({ type: 'varchar', length: 300 }) keyNorm: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) intent: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) demand: string | null;
  @Column({ type: 'int', nullable: true }) estVolume: number | null;
  @Column({ type: 'int', nullable: true }) searchVolume: number | null;
  @Column({ type: 'float', nullable: true }) kd: number | null;
  @Column({ type: 'float', nullable: true }) cpc: number | null;
  @Column({ type: 'int', nullable: true }) competitorCount: number | null;
  @Column({ type: 'float', nullable: true }) competitorStrength: number | null;
  // Layer 12 weightage / star, carried forward.
  @Column({ type: 'float', default: 0 }) layer12Weightage: number;
  @Column({ type: 'int', default: 1 }) layer12Star: number;
  @Column({ type: 'float', default: 0 }) opportunity: number;
  @Column({ type: 'simple-json', nullable: true }) usedKpis: string[] | null;
  @Column({ type: 'varchar', length: 600, nullable: true }) analysis: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// Layer 14 - Keyword Weighted Selection: the final hierarchy. Rank 1 = H1, rank 2 onward = H2 (max 80).
@Entity('layer14_rows')
@Unique('layer14_row_unique', ['projectId', 'keyNorm'])
@Index('layer14_row_customer', ['customerId', 'monthIndex'])
export class Layer14Row {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() projectId: string;
  @Column({ type: 'int' }) monthIndex: number;
  @Column({ name: 'rank_no', type: 'int', default: 0 }) rank: number;
  @Column({ type: 'varchar', length: 500 }) keyword: string;
  @Column({ type: 'varchar', length: 300 }) keyNorm: string;
  // H1 | H2
  @Column({ type: 'varchar', length: 4, default: 'H2' }) hierarchy: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) intent: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) demand: string | null;
  @Column({ type: 'int', nullable: true }) searchVolume: number | null;
  @Column({ type: 'float', nullable: true }) kd: number | null;
  @Column({ type: 'float', default: 0 }) opportunity: number;
  @Column({ type: 'float', default: 0 }) weightage: number;
  @Column({ type: 'int', default: 1 }) starRating: number;
  // Original Layer 13 rank, kept for the downstream blog Layers.
  @Column({ type: 'int', default: 0 }) layer13Rank: number;
  @Column({ type: 'simple-json', nullable: true }) usedKpis: string[] | null;
  @Column({ type: 'varchar', length: 600, nullable: true }) overview: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
