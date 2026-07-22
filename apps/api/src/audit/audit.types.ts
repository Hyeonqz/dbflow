import { AuditAction, AuditTargetType, AuditOutcome } from '@prisma/client';

export type AuditActorSnapshot = {
  userId?: string | null; name?: string | null;
  role?: string | null; department?: string | null;
};

export type AuditInput = {
  actor?: AuditActorSnapshot | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  outcome?: AuditOutcome;
  ip?: string | null;
  userAgent?: string | null;
};
