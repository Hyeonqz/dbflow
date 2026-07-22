import { ConflictException } from '@nestjs/common';
import { ChangeRequestStatus } from '@prisma/client';
import { getNextStatus, TransitionAction } from './change-request.state-machine';

describe('change-request state machine', () => {
  describe('valid transitions', () => {
    const cases: Array<[ChangeRequestStatus, TransitionAction, ChangeRequestStatus]> = [
      [ChangeRequestStatus.DRAFT, 'SUBMIT', ChangeRequestStatus.SUBMITTED],
      [ChangeRequestStatus.SUBMITTED, 'REVIEW_APPROVE', ChangeRequestStatus.REVIEW_APPROVED],
      [ChangeRequestStatus.SUBMITTED, 'REVIEW_REJECT', ChangeRequestStatus.REVIEW_REJECTED],
      [ChangeRequestStatus.REVIEW_APPROVED, 'FINAL_APPROVE', ChangeRequestStatus.FINAL_APPROVED],
      [ChangeRequestStatus.REVIEW_APPROVED, 'FINAL_REJECT', ChangeRequestStatus.FINAL_REJECTED],
      [ChangeRequestStatus.FINAL_APPROVED, 'APPLY', ChangeRequestStatus.APPLIED],
    ];

    it.each(cases)('%s --%s--> %s', (from, action, expected) => {
      expect(getNextStatus(from, action)).toBe(expected);
    });
  });

  describe('illegal transitions throw ConflictException (409)', () => {
    const cases: Array<[ChangeRequestStatus, TransitionAction]> = [
      // wrong precondition state for each action
      [ChangeRequestStatus.SUBMITTED, 'SUBMIT'],
      [ChangeRequestStatus.DRAFT, 'REVIEW_APPROVE'],
      [ChangeRequestStatus.REVIEW_APPROVED, 'REVIEW_REJECT'],
      [ChangeRequestStatus.SUBMITTED, 'FINAL_APPROVE'],
      [ChangeRequestStatus.FINAL_APPROVED, 'FINAL_REJECT'],
      // terminal states cannot transition further
      [ChangeRequestStatus.REVIEW_REJECTED, 'FINAL_APPROVE'],
      [ChangeRequestStatus.FINAL_REJECTED, 'FINAL_APPROVE'],
      [ChangeRequestStatus.APPLIED, 'SUBMIT'],
    ];

    it.each(cases)('rejects %s --%s-->', (from, action) => {
      expect(() => getNextStatus(from, action)).toThrow(ConflictException);
    });
  });
});
