import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { TargetEnv } from '@prisma/client';
export class UpdateApprovalPolicyDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @IsInt() @Min(1) @Max(5) requiredApprovals!: number;
}
