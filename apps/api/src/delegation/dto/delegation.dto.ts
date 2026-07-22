import { IsOptional, IsString, Length, Matches } from 'class-validator';
export class CreateDelegationDto {
  @IsOptional() @IsString() delegatorId?: string;        // ADMIN만 의미
  @IsString() delegateId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAt!: string; // KST 벽시계
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) endsAt!: string;
  @IsOptional() @Length(1, 200) reason?: string;
}
