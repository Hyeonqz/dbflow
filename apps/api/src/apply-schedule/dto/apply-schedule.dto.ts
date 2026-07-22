import { IsEnum, IsInt, Length, Matches, Max, Min } from 'class-validator';
import { TargetEnv } from '@prisma/client';

export class QueryScheduleStatusDto {
  @IsEnum(TargetEnv) env!: TargetEnv; // 스펙 critic M1: 필수·검증
}

export class CreateApplyWindowDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @IsInt() @Min(0) @Max(6) dayOfWeek!: number;
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(1) @Max(1440) endMinute!: number; // 1440 = 24:00(자정 종료)
}

export class CreateFreezeDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAt!: string; // KST 벽시계(critic I2)
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) endsAt!: string;
  @Length(1, 200) reason!: string;
}
