import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreatePageDto {
  @IsUrl({ require_protocol: false })
  pageUrl: string;

  @IsOptional()
  @IsString()
  pageName?: string;

  @IsOptional()
  @IsString()
  libraryImageId?: string;
}
