import { IsArray, IsOptional, IsString } from 'class-validator';

export class AssigneesDto {
  @IsOptional()
  @IsString()
  reviewerId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  approverIds?: string[];
}
