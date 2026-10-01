import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// The user's explicit instruction: "The findings, suggestion will be
// pushed to each Layer mapped. Until the Admin panel is fully migrated,
// preserve the function of pushing layer wise finding." One row per
// (AuditTask x layer number) — a task mapped to Layers 26/27/29/69
// produces four LayerPush rows, one per layer, so each layer's own
// findings feed is independently queryable once that layer's UI exists.
//
// Today every push resolves to PENDING_INTEGRATION: the WP plugin isn't
// being touched this session (per the user's standing "not working on the
// plugin side now" instruction) and the WP<->Engine API-key/Application-
// Password wiring described in the migration plan isn't built yet. The
// function itself — compute the push, record it, expose it via API — is
// fully live; only the last-mile delivery into a per-layer UI is pending.
export enum LayerPushStatus {
  PENDING_INTEGRATION = 'pending_integration',
  PUSHED = 'pushed',
  FAILED = 'failed',
  NOT_APPLICABLE = 'not_applicable',
}

@Entity('layer_pushes')
export class LayerPush {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  auditTaskId: string;

  @Column()
  auditRunId: string;

  @Column()
  customerId: string;

  @Column()
  layerNumber: number;

  @Column({ type: 'text' })
  finding: string;

  @Column({ type: 'text', nullable: true })
  suggestion: string | null;

  @Column({ type: 'enum', enum: LayerPushStatus, default: LayerPushStatus.PENDING_INTEGRATION })
  status: LayerPushStatus;

  @Column({ type: 'text', nullable: true })
  responseNote: string | null;

  @Column({ type: 'timestamp', nullable: true })
  pushedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
