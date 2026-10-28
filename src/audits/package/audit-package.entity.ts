import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// One customer deliverable per SEO Audit run: the AI-drafted Strategy (admin reviews/edits/approves),
// the admin sign-off and, once every gate is met, the compiled single document the customer sees
// (SEO Report + Strategy + Deliverables + Terms & Conditions).
export type StrategyStatus = 'none' | 'draft' | 'approved';

const jsonText = {
  to: (v: unknown) => (v == null ? null : JSON.stringify(v)),
  from: (v: string | null) => {
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  },
};

@Entity('audit_packages')
export class AuditPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  customerId: string;

  @Index({ unique: true })
  @Column()
  auditRunId: string;

  @Column({ type: 'text', nullable: true, transformer: jsonText })
  strategy: Record<string, any> | null;

  @Column({ type: 'varchar', length: 16, default: 'none' })
  strategyStatus: StrategyStatus;

  // 'ai' = drafted by the model, 'rules' = built from the audit findings without a model
  @Column({ type: 'varchar', length: 16, nullable: true })
  strategySource: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  strategyNote: string | null;

  @Column({ type: 'timestamp', nullable: true })
  strategyApprovedAt: Date | null;

  @Column({ default: false })
  signedOff: boolean;

  @Column({ type: 'timestamp', nullable: true })
  signedOffAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  compiledAt: Date | null;

  @Column({ type: 'longtext', nullable: true })
  html: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
