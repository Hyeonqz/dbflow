import { ConflictException } from '@nestjs/common';
import { ChangeRequestStatus } from '@prisma/client';

/**
 * Workflow actions that drive ChangeRequest status transitions.
 *
 *   DRAFT ──SUBMIT──> SUBMITTED
 *   SUBMITTED ──REVIEW_APPROVE──> REVIEW_APPROVED
 *   SUBMITTED ──REVIEW_REJECT───> REVIEW_REJECTED   [terminal]
 *   REVIEW_APPROVED ──FINAL_APPROVE──> FINAL_APPROVED
 *   REVIEW_APPROVED ──FINAL_REJECT───> FINAL_REJECTED [terminal]
 *   FINAL_APPROVED ──APPLY──> APPLIED               [terminal]
 *
 * APPLY is driven by the apply engine (Plan 3) and only used for STAGING|PROD
 * targets; DEV applies intentionally leave the status unchanged for fast
 * iteration (see docs/plan3-apply-contract.md §4.2).
 */
export type TransitionAction =
  | 'SUBMIT'
  | 'REVIEW_APPROVE'
  | 'REVIEW_REJECT'
  | 'FINAL_APPROVE'
  | 'FINAL_REJECT'
  | 'APPLY';

interface Transition {
  readonly from: ChangeRequestStatus;
  readonly to: ChangeRequestStatus;
}

const TRANSITIONS: Record<TransitionAction, Transition> = {
  SUBMIT: { from: ChangeRequestStatus.DRAFT, to: ChangeRequestStatus.SUBMITTED },
  REVIEW_APPROVE: { from: ChangeRequestStatus.SUBMITTED, to: ChangeRequestStatus.REVIEW_APPROVED },
  REVIEW_REJECT: { from: ChangeRequestStatus.SUBMITTED, to: ChangeRequestStatus.REVIEW_REJECTED },
  FINAL_APPROVE: { from: ChangeRequestStatus.REVIEW_APPROVED, to: ChangeRequestStatus.FINAL_APPROVED },
  FINAL_REJECT: { from: ChangeRequestStatus.REVIEW_APPROVED, to: ChangeRequestStatus.FINAL_REJECTED },
  APPLY: { from: ChangeRequestStatus.FINAL_APPROVED, to: ChangeRequestStatus.APPLIED },
};

/** Statuses from which no further transition is allowed. */
export const TERMINAL_STATUSES: readonly ChangeRequestStatus[] = [
  ChangeRequestStatus.REVIEW_REJECTED,
  ChangeRequestStatus.FINAL_REJECTED,
  ChangeRequestStatus.APPLIED,
];

/**
 * Resolves the next status for an action, asserting the current status is the
 * required precondition. Throws `ConflictException` (HTTP 409) on an illegal
 * transition so callers can surface it directly to the client.
 */
export function getNextStatus(
  current: ChangeRequestStatus,
  action: TransitionAction,
): ChangeRequestStatus {
  const transition = TRANSITIONS[action];
  if (transition.from !== current) {
    throw new ConflictException(
      `현재 상태(${current})에서는 '${action}' 전이를 수행할 수 없습니다. (필요 상태: ${transition.from})`,
    );
  }
  return transition.to;
}
