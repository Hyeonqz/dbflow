import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditTargetType, TargetEnv } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';

const ENVS: TargetEnv[] = [TargetEnv.DEV, TargetEnv.STAGING, TargetEnv.PROD];

@Injectable()
export class ApprovalPolicyService {
  private readonly logger = new Logger(ApprovalPolicyService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async getRequired(env: TargetEnv): Promise<number> {
    try {
      const row = await this.prisma.approvalPolicy.findUnique({ where: { env }, select: { requiredApprovals: true } });
      return row?.requiredApprovals ?? 1;
    } catch (err) {
      this.logger.error(`approval policy load failed, default 1: ${(err as Error).message}`);
      return 1;
    }
  }

  async list() {
    const rows = await this.prisma.approvalPolicy.findMany();
    return ENVS.map((env) => ({ env, requiredApprovals: rows.find((r) => r.env === env)?.requiredApprovals ?? 1 }));
  }

  async update(env: TargetEnv, requiredApprovals: number, actor: AuditActorSnapshot) {
    const prev = await this.prisma.approvalPolicy.findUnique({ where: { env }, select: { requiredApprovals: true } });
    await this.prisma.approvalPolicy.upsert({ where: { env }, update: { requiredApprovals }, create: { env, requiredApprovals } });
    await this.audit.record({
      actor, action: AuditAction.APPROVAL_POLICY_UPDATED, targetType: AuditTargetType.APPROVAL_POLICY,
      targetId: env, summary: `결재 정책 변경: ${env} → ${requiredApprovals}명`,
      metadata: { env, from: prev?.requiredApprovals ?? null, to: requiredApprovals },
    });
  }
}
