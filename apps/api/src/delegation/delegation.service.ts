import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';

function parseKst(value: string): Date {
  return new Date(`${value}:00`);
}

@Injectable()
export class DelegationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** 지금 이 사람이 대리 가능한 위임자 id 목록. */
  async activeDelegatorIds(delegateId: string, now = new Date()): Promise<string[]> {
    const rows = await this.prisma.delegation.findMany({
      where: { delegateId, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { delegatorId: true },
    });
    return rows.map((r) => r.delegatorId);
  }

  async isActiveDelegateFor(delegateId: string, delegatorId: string, now = new Date()): Promise<boolean> {
    const row = await this.prisma.delegation.findFirst({
      where: { delegateId, delegatorId, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { id: true },
    });
    return !!row;
  }

  async list(user: { userId: string; role: Role }) {
    const where =
      user.role === Role.ADMIN
        ? {}
        : { OR: [{ delegatorId: user.userId }, { delegateId: user.userId }] };
    return this.prisma.delegation.findMany({
      where,
      orderBy: { startsAt: 'desc' },
      select: {
        id: true, startsAt: true, endsAt: true, reason: true,
        delegator: { select: { name: true, role: true } },
        delegate: { select: { name: true, role: true } },
        createdBy: { select: { name: true } },
      },
    });
  }

  async createDelegation(
    dto: { delegatorId?: string; delegateId: string; startsAt: string; endsAt: string; reason?: string },
    actor: AuditActorSnapshot & { role: Role },
  ) {
    // 비-ADMIN은 self 강제. AuditActorSnapshot.userId는 감사 로깅용으로 nullable이지만
    // createDelegation은 인증된 actor로만 호출됨.
    const delegatorId = actor.role === Role.ADMIN && dto.delegatorId ? dto.delegatorId : actor.userId!;
    if (delegatorId === dto.delegateId)
      throw new BadRequestException({ key: 'delegation.selfDelegationForbidden' });
    const startsAt = parseKst(dto.startsAt);
    const endsAt = parseKst(dto.endsAt);
    if (!(startsAt < endsAt)) throw new BadRequestException({ key: 'delegation.startBeforeEnd' });

    const users = await this.prisma.user.findMany({
      where: { id: { in: [delegatorId, dto.delegateId] } },
      select: { id: true, role: true },
    });
    const del = users.find((u) => u.id === delegatorId);
    const dee = users.find((u) => u.id === dto.delegateId);
    const ALLOWED: Role[] = [Role.REVIEWER, Role.APPROVER];
    if (!del || !dee || del.role !== dee.role || !ALLOWED.includes(del.role))
      throw new BadRequestException({ key: 'delegation.sameRoleOnly' });

    const row = await this.prisma.delegation.create({
      data: { delegatorId, delegateId: dto.delegateId, startsAt, endsAt, reason: dto.reason ?? null, createdById: actor.userId! },
    });
    await this.audit.record({
      actor, action: AuditAction.DELEGATION_UPDATED, targetType: AuditTargetType.DELEGATION, targetId: row.id,
      summary: `위임 등록: ${delegatorId} → ${dto.delegateId}`,
      metadata: { op: 'CREATE', delegatorId, delegateId: dto.delegateId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    });
    return row;
  }

  async deleteDelegation(id: string, actor: AuditActorSnapshot & { role: Role }) {
    const row = await this.prisma.delegation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ key: 'delegation.notFound' });
    if (actor.role !== Role.ADMIN && row.delegatorId !== actor.userId)
      throw new ForbiddenException({ key: 'delegation.ownerOrAdminOnly' });
    await this.prisma.delegation.delete({ where: { id } });
    await this.audit.record({
      actor, action: AuditAction.DELEGATION_UPDATED, targetType: AuditTargetType.DELEGATION, targetId: id,
      summary: `위임 해제: ${row.delegatorId} → ${row.delegateId}`,
      metadata: { op: 'DELETE', delegatorId: row.delegatorId, delegateId: row.delegateId },
    });
    return { ok: true };
  }
}
