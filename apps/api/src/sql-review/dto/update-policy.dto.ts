import { IsEnum, IsIn } from 'class-validator';
import { SqlReviewLevel, TargetEnv } from '@prisma/client';
import { RULE_CATALOG } from '../../apply/lint.engine';

const RULE_KEYS = RULE_CATALOG.map((r) => r.ruleKey);

export class UpdatePolicyDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @IsIn(RULE_KEYS) ruleKey!: string;
  @IsEnum(SqlReviewLevel) level!: SqlReviewLevel;
}
