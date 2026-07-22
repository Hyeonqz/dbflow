import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditOutcome, AuditTargetType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditInput } from './audit.types';

export const AUDIT_EXPORT_MAX_ROWS = 10000;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** 트랜잭션 배열($transaction)에 넣을 create data를 만든다. */
  buildData(input: AuditInput): Prisma.AuditLogUncheckedCreateInput {
    return {
      actorId: input.actor?.userId ?? null,
      actorName: input.actor?.name ?? null,
      actorRole: input.actor?.role ?? null,
      actorDept: input.actor?.department ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      summary: input.summary,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      outcome: input.outcome ?? AuditOutcome.SUCCESS,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    };
  }

  /** best-effort 기록 — 감사 실패가 호출자를 절대 깨뜨리지 않는다. */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.buildData(input) });
    } catch (err) {
      this.logger.error(`audit record failed: ${(err as Error).message}`);
    }
  }

  private buildWhere(q: {
    actor?: string; action?: AuditAction; targetType?: AuditTargetType;
    outcome?: AuditOutcome; from?: string; to?: string;
  }): Prisma.AuditLogWhereInput {
    return {
      ...(q.action ? { action: q.action } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.actor ? { actorId: q.actor } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };
  }

  async list(q: {
    actor?: string; action?: AuditAction; targetType?: AuditTargetType;
    outcome?: AuditOutcome; from?: string; to?: string; page?: number;
  }) {
    const pageSize = 50;
    const page = q.page && q.page > 0 ? q.page : 1;
    const where = this.buildWhere(q);
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** list와 동일 where, 페이지네이션 없이 최신순 전체(내보내기 상한 10000). */
  exportRows(q: Parameters<AuditService['list']>[0]) {
    const where = this.buildWhere(q);
    return this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: AUDIT_EXPORT_MAX_ROWS });
  }

  toCsv(rows: any[]): string {
    const cols = ['id', 'createdAt', 'actorName', 'action', 'targetType', 'targetId', 'outcome', 'summary', 'metadata', 'actorId', 'actorRole', 'actorDept', 'ip', 'userAgent'];
    const esc = (v: unknown) => {
      let s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`; // CSV 수식 인젝션 방지 — 스프레드시트가 수식으로 해석하지 못하게 접두
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
    return lines.join('\n') + '\n';
  }
}
