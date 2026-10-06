import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdatePageDto {
  @IsOptional()
  @IsUrl({ require_protocol: false })
  pageUrl?: string;

  @IsOptional()
  @IsString()
  pageName?: string;

  @IsOptional()
  @IsString()
  aliasName?: string;

  @IsOptional()
  @IsString()
  h1Keyword?: string;

  // Pass an empty string to explicitly un-map (never deletes the image).
  @IsOptional()
  @IsString()
  libraryImageId?: string;
}
