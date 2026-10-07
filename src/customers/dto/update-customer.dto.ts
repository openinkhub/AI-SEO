import {
  IsArray,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
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

  // Manual account details for customers that were created in the Engine
  // before the WP sync could pair them (new signups fill these in
  // automatically). Empty string = clear.
  @IsOptional()
  @IsString()
  @Matches(/^\d*$/, { message: 'WP User ID must be a number.' })
  wpUserId?: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @ValidateIf((o) => o.accountEmail !== '')
  @IsEmail()
  accountEmail?: string;

  // Registration (ACT) date that anchors the 30-day month cycle.
  @IsOptional()
  @ValidateIf((o) => o.actDate !== '')
  @Matches(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, {
    message: 'Registration date must look like YYYY-MM-DD.',
  })
  actDate?: string;

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
