import type { Locale } from './locale';
import { DEFAULT_LOCALE } from './locale';

type Catalog = Record<string, string>;

const en: Catalog = {
  'changeRequest.notFound': 'Change request not found.',
  'changeRequest.submitRequiresAssignees': 'Submitting requires 1 reviewer and {required} approver(s).',
  'changeRequest.submitAuthorOnly': 'Only the author can submit.',
  'changeRequest.reviewForbidden': 'Only the assigned reviewer or an active delegate may review.',
  'changeRequest.approveInvalidStatus': 'Cannot approve in the current status ({status}).',
  'changeRequest.alreadyDecided': 'You have already made a decision.',
  'changeRequest.approveForbidden': 'Only the assigned approver or an active delegate may approve.',
  'changeRequest.sodViolation':
    'Segregation of duties: you cannot approve the same change request twice (directly or as a delegate).',
  'changeRequest.reviewerMustBeReviewerRole': 'Reviewer must have the REVIEWER role.',
  'changeRequest.duplicateApprovers': 'Approvers must not be duplicated.',
  'changeRequest.approversMustBeApproverRole': 'Approvers must all have the APPROVER role.',
  'changeRequest.assigneesChangeForbidden':
    'Only the author can change assignees while in DRAFT; only an admin may change them after submission.',
  'changeRequest.approverCountMismatch':
    'A submitted request must have exactly {required} approver(s) assigned.',
};

const ko: Catalog = {
  'changeRequest.notFound': '변경요청을 찾을 수 없습니다.',
  'changeRequest.submitRequiresAssignees': '제출하려면 검토자 1명과 결재자 {required}명을 지정해야 합니다.',
  'changeRequest.submitAuthorOnly': '작성자만 제출할 수 있습니다.',
  'changeRequest.reviewForbidden': '지정된 검토자 또는 활성 대리인만 검토할 수 있습니다.',
  'changeRequest.approveInvalidStatus': '현재 상태({status})에서는 결재할 수 없습니다.',
  'changeRequest.alreadyDecided': '이미 결재하셨습니다.',
  'changeRequest.approveForbidden': '지정된 결재자 또는 활성 대리인만 결재할 수 있습니다.',
  'changeRequest.sodViolation': '직무분리 정책상 한 변경요청에 두 번(직접·대리 포함) 결재할 수 없습니다.',
  'changeRequest.reviewerMustBeReviewerRole': '검토자는 REVIEWER여야 합니다.',
  'changeRequest.duplicateApprovers': '결재자가 중복되었습니다.',
  'changeRequest.approversMustBeApproverRole': '결재자는 모두 APPROVER여야 합니다.',
  'changeRequest.assigneesChangeForbidden':
    'DRAFT 상태에서는 작성자만, 제출 후에는 관리자만 지정을 변경할 수 있습니다.',
  'changeRequest.approverCountMismatch': '제출된 요청은 결재자 {required}명을 지정해야 합니다.',
};

const MESSAGES: Record<Locale, Catalog> = { en, ko };

export function translate(key: string, locale: Locale, args?: Record<string, string | number>): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (!args) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (args[k] !== undefined ? String(args[k]) : `{${k}}`));
}

export { MESSAGES };
