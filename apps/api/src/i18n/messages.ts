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

  'apply.targetNotFound': 'Target database not found.',
  'apply.mysqlOnly': 'MVP supports apply to MYSQL targets only.',
  'apply.blockLintDetected': 'Apply rejected: risky SQL (BLOCK) detected: {items}',
  'apply.rejectedOrAppliedStatus':
    'A change request in a rejected/applied status ({status}) cannot be applied.',
  'apply.stagingProdRequiresFinalApproved':
    'STAGING/PROD apply requires FINAL_APPROVED status. (current: {status})',
  'apply.alreadyRunning': 'An apply is already running. Try again after it finishes.',
  'apply.devPermissionDenied': 'DEV apply is allowed only for APPROVER or the request author (developer).',
  'apply.stagingProdPermissionDenied': 'STAGING/PROD apply is allowed only for APPROVER.',
  'apply.envMismatch': 'Environment mismatch: change request ({crEnv}) and target DB ({targetEnv}) differ.',

  'rollback.executionNotFound': 'Execution not found.',
  'rollback.mustBeApplyExecution': 'The rollback target must be an APPLY execution.',
  'rollback.noBackup': 'No linked backup — cannot roll back.',

  'dryRun.mysqlOnly': 'MVP supports dry-run for MYSQL targets only.',

  'applySchedule.frozen': 'Freeze period in effect: {reason} (until {endsAt})',
  'applySchedule.outOfWindow': 'Not within an apply window.',
  'applySchedule.outOfWindowNext': 'Not within an apply window. Next window: {day} {start}~{end}',
  'applySchedule.windowStartAfterEnd': 'Apply window start must be before end.',
  'applySchedule.windowNotFound': 'Apply window not found.',
  'applySchedule.freezeStartAfterEnd': 'Freeze start must be before end.',
  'applySchedule.freezeNotFound': 'Freeze period not found.',

  'delegation.selfDelegationForbidden': 'You cannot delegate to yourself.',
  'delegation.startBeforeEnd': 'Delegation start must be before end.',
  'delegation.sameRoleOnly': 'The delegator and delegate must have the same role (REVIEWER or APPROVER).',
  'delegation.notFound': 'Delegation not found.',
  'delegation.ownerOrAdminOnly': 'Only the owner of the delegation or an admin may remove it.',

  'targetDatabase.notFound': 'Target database not found.',

  'schemaDiff.noChanges': 'No schema diff — cannot create a change request.',
  'schemaDiff.mysqlOnly': 'MVP supports schema diff for MYSQL targets only.',
  'schemaDiff.noCreateTableFound':
    'No CREATE TABLE statement found in the desired SQL. (Only CREATE TABLE syntax is supported.)',

  'sqlReview.unknownRule': 'Unknown rule.',

  'auth.invalidCredentials': 'Invalid email or password.',
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

  'apply.targetNotFound': '대상 데이터베이스를 찾을 수 없습니다.',
  'apply.mysqlOnly': 'MVP는 MYSQL 대상만 적용을 지원합니다.',
  'apply.blockLintDetected': '위험 SQL(BLOCK)이 감지되어 적용을 거부합니다: {items}',
  'apply.rejectedOrAppliedStatus': '거부/적용완료 상태({status})의 변경요청은 적용할 수 없습니다.',
  'apply.stagingProdRequiresFinalApproved':
    'STAGING/PROD 적용은 FINAL_APPROVED 상태에서만 가능합니다. (현재: {status})',
  'apply.alreadyRunning': '이미 진행 중인 적용이 있습니다. 완료 후 다시 시도하세요.',
  'apply.devPermissionDenied': 'DEV 적용은 APPROVER 또는 변경요청 작성자(개발자)만 가능합니다.',
  'apply.stagingProdPermissionDenied': 'STAGING/PROD 적용은 APPROVER만 가능합니다.',
  'apply.envMismatch': '환경 불일치: 변경요청({crEnv})과 대상 DB({targetEnv})의 환경이 다릅니다.',

  'rollback.executionNotFound': '실행 이력을 찾을 수 없습니다.',
  'rollback.mustBeApplyExecution': '롤백 대상은 적용(APPLY) 실행이어야 합니다.',
  'rollback.noBackup': '연결된 백업이 없어 롤백할 수 없습니다.',

  'dryRun.mysqlOnly': 'MVP는 MYSQL 대상만 dry-run을 지원합니다.',

  'applySchedule.frozen': '동결 기간입니다: {reason} ({endsAt}까지)',
  'applySchedule.outOfWindow': '적용 작업창이 아닙니다.',
  'applySchedule.outOfWindowNext': '적용 작업창이 아닙니다. 다음 작업창: {day} {start}~{end}',
  'applySchedule.windowStartAfterEnd': '작업창 시작이 종료보다 빨라야 합니다.',
  'applySchedule.windowNotFound': '작업창을 찾을 수 없습니다.',
  'applySchedule.freezeStartAfterEnd': '동결 시작이 종료보다 빨라야 합니다.',
  'applySchedule.freezeNotFound': '동결 기간을 찾을 수 없습니다.',

  'delegation.selfDelegationForbidden': '자기 자신에게 위임할 수 없습니다.',
  'delegation.startBeforeEnd': '위임 시작이 종료보다 빨라야 합니다.',
  'delegation.sameRoleOnly': '위임자와 대리인은 같은 역할(검토자 또는 결재자)이어야 합니다.',
  'delegation.notFound': '위임을 찾을 수 없습니다.',
  'delegation.ownerOrAdminOnly': '본인 위임 또는 관리자만 해제할 수 있습니다.',

  'targetDatabase.notFound': '대상 데이터베이스를 찾을 수 없습니다.',

  'schemaDiff.noChanges': '스키마 차이가 없어 변경요청을 생성할 수 없습니다.',
  'schemaDiff.mysqlOnly': 'MVP는 MYSQL 대상만 스키마 diff를 지원합니다.',
  'schemaDiff.noCreateTableFound':
    'desired SQL에서 CREATE TABLE 문을 찾지 못했습니다. (CREATE TABLE 형식만 지원)',

  'sqlReview.unknownRule': '알 수 없는 규칙입니다.',

  'auth.invalidCredentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
};

const MESSAGES: Record<Locale, Catalog> = { en, ko };

export function translate(key: string, locale: Locale, args?: Record<string, string | number>): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (!args) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (args[k] !== undefined ? String(args[k]) : `{${k}}`));
}

export { MESSAGES };
