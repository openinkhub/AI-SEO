import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

// Shape of the payload WP (KP21) posts to the Engine when a customer is
// created/updated - the "profile data" half of decision 2/4 (auto-fetch
// sync + one-time import). Field names mirror kp21_profiles' known
// columns (company/website/industry/business_domain/sector/contact
// fields) per claude/task2-layer21-layer23-status.md; unknown/extra
// fields sent by WP are ignored (whitelist validation), never persisted
// as a guess.
export class WpSyncCustomerDto {
  @IsString()
  wpUserId: string;

  @IsString()
  companyName: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  businessDomain?: string;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsArray()
  competitors?: string[];
}
