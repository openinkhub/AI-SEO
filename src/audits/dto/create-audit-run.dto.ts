import { IsOptional, IsString } from 'class-validator';

export class CreateAuditRunDto {
  // Optional override of the Customer's stored website — lets an agency
  // user audit a staging URL before it goes live.
  @IsOptional()
  @IsString()
  website?: string;
}
