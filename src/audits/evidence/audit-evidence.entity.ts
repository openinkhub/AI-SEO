import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Tool evidence attached to an SEO Audit run by an admin: screenshots (read by AI vision) and text
// exports (read by fixed rules). The extracted data is merged into the audit reports.
export type EvidenceKind = 'image' | 'text';
// uploaded = stored, not read yet; extracted = read, awaiting admin approval; approved = cleared for
// the customer report; failed = could not be read.
export type EvidenceStatus = 'uploaded' | 'extracted' | 'approved' | 'failed';

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

@Entity('audit_evidence')
@Index(['auditRunId', 'sha256'])
export class AuditEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  auditRunId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: EvidenceKind;

  @Column({ type: 'varchar', length: 40, default: 'unknown' })
  tool: string;

  // aitdk_meta, aitdk_backlinks, digispot_report, ... (see aitdk-rules.ts) or 'unknown'.
  @Column({ type: 'varchar', length: 60, default: 'unknown' })
  evidenceType: string;

  @Column({ type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  url: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  storageKey: string | null;

  @Column({ type: 'longtext', nullable: true })
  textContent: string | null;

  @Column({ type: 'longtext', nullable: true, transformer: jsonText })
  extracted: Record<string, any> | null;

  @Column({ type: 'varchar', length: 20, default: 'uploaded' })
  status: EvidenceStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ default: true })
  includeInReport: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
