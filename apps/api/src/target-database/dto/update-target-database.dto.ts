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

/**
 * Partial update. Every field is optional; when `password` is present it is
 * re-encrypted, when absent the stored credential is left untouched
 * (see contract §3.5). Written explicitly to avoid pulling in
 * `@nestjs/mapped-types`.
 */
export class UpdateTargetDatabaseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(TargetEnv)
  env?: TargetEnv;

  @IsOptional()
  @IsEnum(DbType)
  dbType?: DbType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  database?: string;
}
