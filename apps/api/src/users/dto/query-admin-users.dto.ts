import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Role } from '@prisma/client';

export class QueryAdminUsersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
