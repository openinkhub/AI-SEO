import {
  IsArray,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CustomerStatus } from '../customer.entity';

// Not PartialType(CreateCustomerDto) — kept dependency-free (no
// @nestjs/mapped-types in package.json yet); every field is simply optional.
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  companyName?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  // Where notifications go. Empty string = clear it (fall back to the
  // account email).
  @IsOptional()
  @ValidateIf((o) => o.notificationEmail !== '')
  @IsEmail()
  notificationEmail?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  competitors?: string[];

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  // Full onboarding/Company-Profile fields, keyed the same as WP's
  // KP21_Onboarding form (brand_name, domain, seed_keywords, ...). Sent as
  // one object; a save replaces the whole profile blob (the dashboard
  // always submits the complete form, matching how KP21_Onboarding itself
  // persists this data server-side).
  @IsOptional()
  @IsObject()
  profile?: Record<string, string | string[] | boolean>;
}
