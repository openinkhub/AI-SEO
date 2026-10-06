import { IsArray, IsOptional, IsString } from 'class-validator';

// One batch of historical Month-Cycle / Task-Grid records for a single
// WP customer, per decision 2 ("Profile data + full task/history
// records"). Deliberately loose (`records: unknown[]`) - the exact WP
// table/column shape (wp_kp21_projects, per-layer task tables) isn't
// known from this side without the live plugin source, so this endpoint
// stores whatever WP sends as opaque JSON rows now, and the real
// column-level mapping gets built once that source is available. Never
// silently drops data by forcing it into a guessed shape.
export class WpSyncHistoryDto {
  @IsString()
  wpUserId: string;

  @IsString()
  recordType: string; // e.g. 'month_cycle', 'task_grid', 'blog_submission'

  @IsArray()
  records: unknown[];

  @IsOptional()
  @IsString()
  sourceVersion?: string; // e.g. the KP21 plugin version that sent it
}
