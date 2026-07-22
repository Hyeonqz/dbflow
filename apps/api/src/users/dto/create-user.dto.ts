import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) department!: string;
  @IsString() @MinLength(8) @MaxLength(72) password!: string;
  @IsEnum(Role) role!: Role;
}
