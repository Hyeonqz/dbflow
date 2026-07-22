import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Role, TargetEnv } from '@prisma/client';

export interface SafetyActor {
  userId: string;
  role: Role;
  // Optional: controllers pass the full CurrentUserPayload, which carries these
  // for audit snapshots (Task 7). Optional so pre-existing call sites/tests that
  // only supply userId/role keep compiling.
  name?: string;
  department?: string;
}

/**
 * Environment-based apply/rollback permission (Plan 3 rule, reused across the
 * apply, dry-run and rollback paths):
 *  - DEV: APPROVER or the change request's author (DEVELOPER);
 *  - STAGING|PROD: APPROVER only.
 */
export function assertApplyPermission(actor: SafetyActor, env: TargetEnv, authorId: string): void {
  if (env === TargetEnv.DEV) {
    const allowed =
      actor.role === Role.APPROVER ||
      (actor.role === Role.DEVELOPER && actor.userId === authorId);
    if (!allowed) {
      throw new ForbiddenException('DEV 적용은 APPROVER 또는 변경요청 작성자(개발자)만 가능합니다.');
    }
    return;
  }
  if (actor.role !== Role.APPROVER) {
    throw new ForbiddenException('STAGING/PROD 적용은 APPROVER만 가능합니다.');
  }
}

/** Rejects when the change request's env does not match the target DB's env. */
export function assertEnvMatch(crEnv: TargetEnv, targetEnv: TargetEnv): void {
  if (crEnv !== targetEnv) {
    throw new ConflictException(
      `환경 불일치: 변경요청(${crEnv})과 대상 DB(${targetEnv})의 환경이 다릅니다.`,
    );
  }
}
