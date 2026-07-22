import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AuditOutcome, AuditTargetType } from '@prisma/client';

export class QueryAuditDto {
  @IsOptional() @IsString() actor?: string;
  @IsOptional() @IsEnum(AuditAction) action?: AuditAction;
  @IsOptional() @IsEnum(AuditTargetType) targetType?: AuditTargetType;
  @IsOptional() @IsEnum(AuditOutcome) outcome?: AuditOutcome;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}
