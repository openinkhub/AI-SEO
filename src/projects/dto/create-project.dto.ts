import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ProjectStatus } from '../project.entity';

export class CreateProjectDto {
  @IsInt()
  @Min(0)
  monthIndex: number;

  @IsString()
  monthCode: string;

  @IsOptional()
  @IsString()
  monthStartDate?: string;

  @IsOptional()
  @IsString()
  monthEndDate?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  source?: string;
}
