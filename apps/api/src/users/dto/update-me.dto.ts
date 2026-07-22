import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @IsString() @MaxLength(50) department?: string;
  @IsOptional() @IsString() @MaxLength(64) telegramChatId?: string;
}
