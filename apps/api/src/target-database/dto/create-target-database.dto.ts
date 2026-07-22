import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DbType, TargetEnv } from '@prisma/client';

export class CreateTargetDatabaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEnum(TargetEnv)
  env!: TargetEnv;

  @IsOptional()
  @IsEnum(DbType)
  dbType?: DbType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  database!: string;
}
