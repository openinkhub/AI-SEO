import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

// extractedJson is ONE string field on purpose: Hostinger's edge rejects request bodies with more than
// 10 leaf values, and extracted data has many.
export class UpdateEvidenceDto {
  @IsOptional()
  @IsString()
  evidenceType?: string;

  @IsOptional()
  @IsString()
  extractedJson?: string;

  @IsOptional()
  @IsIn(['extracted', 'approved'])
  status?: 'extracted' | 'approved';

  @IsOptional()
  @IsBoolean()
  includeInReport?: boolean;
}
