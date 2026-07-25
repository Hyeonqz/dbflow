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
      throw new ForbiddenException({ key: 'apply.devPermissionDenied' });
    }
    return;
  }
  if (actor.role !== Role.APPROVER) {
    throw new ForbiddenException({ key: 'apply.stagingProdPermissionDenied' });
  }
}

/** Rejects when the change request's env does not match the target DB's env. */
export function assertEnvMatch(crEnv: TargetEnv, targetEnv: TargetEnv): void {
  if (crEnv !== targetEnv) {
    throw new ConflictException({ key: 'apply.envMismatch', args: { crEnv, targetEnv } });
  }
}
