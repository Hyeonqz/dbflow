import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, TargetEnv } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function fmtMin(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fmtKst(d: Date): string {
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' });
}

/** 스펙 §4 계약: 'YYYY-MM-DDTHH:mm'(KST 벽시계) → UTC instant */
function parseKst(value: string): Date {
  return new Date(`${value}:00+09:00`);
}

type WindowRow = { dayOfWeek: number; startMinute: number; endMinute: number };

export type ScheduleStatus =
  | { allowed: true }
  | { allowed: false; reason: 'FROZEN'; freeze: { reason: string; endsAt: Date } }
  | { allowed: false; reason: 'OUT_OF_WINDOW'; nextWindow: WindowRow | null };

@Injectable()
export class ApplyScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 스펙 §3. 판정 쿼리 예외는 전파(fail-closed) — catch 후 allowed:true 폴백 금지. */
  async checkApplyAllowed(env: TargetEnv, now = new Date()): Promise<ScheduleStatus> {
    const freeze = await this.prisma.freezePeriod.findFirst({
      where: { env, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { reason: true, endsAt: true },
    });
    if (freeze) return { allowed: false, reason: 'FROZEN', freeze };

    const windows = await this.prisma.applyWindow.findMany({
      where: { env },
      select: { dayOfWeek: true, startMinute: true, endMinute: true },
    });
    if (windows.length === 0) return { allowed: true }; // 무창 = 항상 허용(무회귀)

    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();
    const open = windows.some((w) => w.dayOfWeek === day && w.startMinute <= minute && minute < w.endMinute);
    if (open) return { allowed: true };
    return { allowed: false, reason: 'OUT_OF_WINDOW', nextWindow: this.findNextWindow(windows, day, minute) };
  }

  /** now 이후 7일 내 최근접 창(오늘부터 요일 순환 스캔 — 주간 반복이라 항상 존재). */
  private findNextWindow(windows: WindowRow[], day: number, minute: number): WindowRow | null {
    for (let offset = 0; offset <= 7; offset++) {
      const d = (day + offset) % 7;
      const next = windows
        .filter((w) => w.dayOfWeek === d && (offset > 0 || w.startMinute > minute))
        .sort((a, b) => a.startMinute - b.startMinute)[0];
      if (next) return next;
    }
    return null;
  }

  async assertApplyAllowed(env: TargetEnv, now = new Date()): Promise<void> {
    const status = await this.checkApplyAllowed(env, now);
    if (status.allowed) return;
    if (status.reason === 'FROZEN') {
      throw new ConflictException({
        key: 'applySchedule.frozen',
        args: { reason: status.freeze.reason, endsAt: fmtKst(status.freeze.endsAt) },
      });
    }
    const w = status.nextWindow;
    if (w) {
      throw new ConflictException({
        key: 'applySchedule.outOfWindowNext',
        args: { day: DAY_LABELS[w.dayOfWeek], start: fmtMin(w.startMinute), end: fmtMin(w.endMinute) },
      });
    }
    throw new ConflictException({ key: 'applySchedule.outOfWindow' });
  }

  /** 스펙 §4: freezes는 진행중·미래만(과거는 감사 잔재), timezone은 TZ 어서션 노출용. */
  async list() {
    const now = new Date();
    const [windows, freezes] = await Promise.all([
      this.prisma.applyWindow.findMany({
        orderBy: [{ env: 'asc' }, { dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.freezePeriod.findMany({
        where: { endsAt: { gt: now } },
        orderBy: { startsAt: 'asc' },
        include: { createdBy: { select: { name: true } } },
      }),
    ]);
    return {
      windows,
      freezes,
      serverTime: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  async createWindow(
    dto: { env: TargetEnv; dayOfWeek: number; startMinute: number; endMinute: number },
    actor: AuditActorSnapshot,
  ) {
    if (dto.startMinute >= dto.endMinute) {
      throw new BadRequestException({ key: 'applySchedule.windowStartAfterEnd' });
    }
    const row = await this.prisma.applyWindow.create({ data: dto });
    await this.audit.record({
      actor,
      action: AuditAction.APPLY_WINDOW_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: row.id,
      summary: `작업창 추가: ${dto.env} ${DAY_LABELS[dto.dayOfWeek]} ${fmtMin(dto.startMinute)}~${fmtMin(dto.endMinute)}`,
      metadata: { op: 'CREATE', ...dto },
    });
    return row;
  }

  async deleteWindow(id: string, actor: AuditActorSnapshot) {
    const row = await this.prisma.applyWindow.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ key: 'applySchedule.windowNotFound' });
    await this.prisma.applyWindow.delete({ where: { id } });
    await this.audit.record({
      actor,
      action: AuditAction.APPLY_WINDOW_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: id,
      summary: `작업창 삭제: ${row.env} ${DAY_LABELS[row.dayOfWeek]} ${fmtMin(row.startMinute)}~${fmtMin(row.endMinute)}`,
      metadata: { op: 'DELETE', env: row.env, dayOfWeek: row.dayOfWeek, startMinute: row.startMinute, endMinute: row.endMinute },
    });
    return { ok: true };
  }

  async createFreeze(
    dto: { env: TargetEnv; startsAt: string; endsAt: string; reason: string },
    actor: AuditActorSnapshot,
  ) {
    const startsAt = parseKst(dto.startsAt);
    const endsAt = parseKst(dto.endsAt);
    if (!(startsAt < endsAt)) {
      throw new BadRequestException({ key: 'applySchedule.freezeStartAfterEnd' });
    }
    const row = await this.prisma.freezePeriod.create({
      data: { env: dto.env, startsAt, endsAt, reason: dto.reason, createdById: actor.userId! }, // AuditActorSnapshot.userId is nullable for audit logging, but createFreeze is only ever called with an authenticated actor
    });
    await this.audit.record({
      actor,
      action: AuditAction.FREEZE_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: row.id,
      summary: `동결 등록: ${dto.env} ${fmtKst(startsAt)}~${fmtKst(endsAt)} (${dto.reason})`,
      metadata: { op: 'CREATE', env: dto.env, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: dto.reason },
    });
    return row;
  }

  async deleteFreeze(id: string, actor: AuditActorSnapshot) {
    const row = await this.prisma.freezePeriod.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ key: 'applySchedule.freezeNotFound' });
    await this.prisma.freezePeriod.delete({ where: { id } });
    await this.audit.record({
      actor,
      action: AuditAction.FREEZE_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: id,
      summary: `동결 해제: ${row.env} (${row.reason})`,
      metadata: { op: 'DELETE', env: row.env, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), reason: row.reason },
    });
    return { ok: true };
  }
}
