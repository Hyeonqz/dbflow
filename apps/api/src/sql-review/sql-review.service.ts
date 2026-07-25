import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditTargetType, SqlReviewLevel, TargetEnv } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';
import { RULE_CATALOG, effectiveSeverity, type PolicyMap } from '../apply/lint.engine';

const RULE_KEYS = new Set(RULE_CATALOG.map((r) => r.ruleKey));

@Injectable()
export class SqlReviewService {
  private readonly logger = new Logger(SqlReviewService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** 완전한 7키 정책 Map. DB 결손/실패는 effectiveSeverity(base, env)로 채운다(fail-closed). */
  async getPolicyMap(env: TargetEnv): Promise<PolicyMap> {
    let byKey = new Map<string, SqlReviewLevel>();
    try {
      const rows = await this.prisma.sqlReviewRule.findMany({ where: { env }, select: { ruleKey: true, level: true } });
      byKey = new Map(rows.map((r) => [r.ruleKey, r.level]));
    } catch (err) {
      this.logger.error(`sql review policy load failed, using base fallback: ${(err as Error).message}`);
    }
    const map: PolicyMap = new Map();
    for (const rule of RULE_CATALOG) {
      map.set(rule.ruleKey, byKey.get(rule.ruleKey) ?? (effectiveSeverity(rule.base, env) as SqlReviewLevel));
    }
    return map;
  }

  /** 그리드 렌더용: 카탈로그 + 환경별 현재 level. */
  async listCatalogWithLevels() {
    const rows = await this.prisma.sqlReviewRule.findMany();
    const lvl = (env: TargetEnv, key: string, base: string) =>
      rows.find((r) => r.env === env && r.ruleKey === key)?.level ??
      (effectiveSeverity(base as any, env) as SqlReviewLevel);
    return RULE_CATALOG.map((r) => ({
      ruleKey: r.ruleKey, base: r.base, message: r.message,
      levels: {
        DEV: lvl('DEV', r.ruleKey, r.base),
        STAGING: lvl('STAGING', r.ruleKey, r.base),
        PROD: lvl('PROD', r.ruleKey, r.base),
      },
    }));
  }

  async update(env: TargetEnv, ruleKey: string, level: SqlReviewLevel, actor: AuditActorSnapshot) {
    if (!RULE_KEYS.has(ruleKey)) throw new BadRequestException({ key: 'sqlReview.unknownRule' });
    const prev = await this.prisma.sqlReviewRule.findUnique({ where: { env_ruleKey: { env, ruleKey } }, select: { level: true } });
    await this.prisma.sqlReviewRule.upsert({
      where: { env_ruleKey: { env, ruleKey } },
      update: { level },
      create: { env, ruleKey, level },
    });
    await this.audit.record({
      actor, action: AuditAction.SQL_POLICY_UPDATED, targetType: AuditTargetType.SQL_REVIEW_POLICY,
      targetId: `${env}:${ruleKey}`, summary: `SQL 리뷰 정책 변경: ${env}/${ruleKey} → ${level}`,
      metadata: { env, ruleKey, from: prev?.level ?? null, to: level },
    });
  }
}
