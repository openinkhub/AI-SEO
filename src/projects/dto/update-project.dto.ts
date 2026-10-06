import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProjectStatus } from '../project.entity';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  monthStartDate?: string;

  @IsOptional()
  @IsString()
  monthEndDate?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
