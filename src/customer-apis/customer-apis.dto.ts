import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class SaveApiSettingDto {
  // {fieldName: value}. A blank secret keeps the stored one. At most 2-3 fields per provider, so the
  // body stays well under the host's 10-leaf-value limit.
  @IsOptional()
  @IsObject()
  values?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
