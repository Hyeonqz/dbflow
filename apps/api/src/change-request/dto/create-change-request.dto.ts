import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SqlType, TargetEnv } from '@prisma/client';

export class ChangeRequestFileInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsEnum(SqlType)
  sqlType!: SqlType;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class CreateChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsEnum(TargetEnv)
  targetEnv!: TargetEnv;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChangeRequestFileInput)
  files!: ChangeRequestFileInput[];

  @IsOptional()
  @IsString()
  reviewerId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  approverIds?: string[];
}
