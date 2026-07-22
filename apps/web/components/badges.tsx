import type {
  BackupStatus,
  ChangeRequestStatus,
  DiffKind,
  ExecutionStatus,
  LintSeverity,
  SqlType,
  TargetEnv,
} from '@/lib/api';

const STATUS_STYLE: Record<ChangeRequestStatus, { label: string; className: string }> = {
  DRAFT: { label: '작성 중', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' },
  SUBMITTED: { label: '제출됨', className: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' },
  REVIEW_APPROVED: { label: '검토 승인', className: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
  REVIEW_REJECTED: { label: '검토 반려', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
  FINAL_APPROVED: { label: '최종 승인', className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  FINAL_REJECTED: { label: '최종 반려', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
  APPLIED: { label: '반영 완료', className: 'bg-emerald-600 text-white' },
};

const ENV_STYLE: Record<TargetEnv, { label: string; className: string }> = {
  DEV: { label: 'DEV', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' },
  STAGING: { label: 'STAGING', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  PROD: { label: 'PROD', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
};

export const SQL_TYPE_LABEL: Record<SqlType, string> = {
  DDL: 'DDL (구조 변경)',
  DML: 'DML (데이터 변경)',
};

const EXECUTION_STATUS_STYLE: Record<ExecutionStatus, { label: string; className: string }> = {
  PENDING: { label: '대기', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' },
  RUNNING: { label: '실행 중', className: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' },
  SUCCESS: { label: '성공', className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  FAILED: { label: '실패', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
};

const DIFF_KIND_STYLE: Record<DiffKind, { label: string; className: string }> = {
  CREATE_TABLE: { label: '테이블 생성', className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  ADD_COLUMN: { label: '컬럼 추가', className: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  DROP_COLUMN: { label: '컬럼 삭제', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
  MODIFY_COLUMN: { label: '컬럼 변경', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  ADD_INDEX: { label: '인덱스 추가', className: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
  DROP_INDEX: { label: '인덱스 삭제', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
  DROP_TABLE: { label: '테이블 삭제', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
};

const LINT_SEVERITY_STYLE: Record<LintSeverity, { label: string; className: string }> = {
  INFO: { label: 'INFO', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' },
  WARN: { label: 'WARN', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  BLOCK: { label: 'BLOCK', className: 'bg-red-600 text-white' },
};

const BACKUP_STATUS_STYLE: Record<BackupStatus, { label: string; className: string }> = {
  SUCCESS: { label: '백업 완료', className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  PARTIAL: { label: '부분 백업', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  FAILED: { label: '백업 실패', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
};

const baseBadge = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold';

export function StatusBadge({ status }: { status: ChangeRequestStatus }) {
  const s = STATUS_STYLE[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${s.className}`}>{s.label}</span>;
}

export function EnvBadge({ env }: { env: TargetEnv }) {
  const e = ENV_STYLE[env] ?? { label: env, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${e.className}`}>{e.label}</span>;
}

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  const s = EXECUTION_STATUS_STYLE[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${s.className}`}>{s.label}</span>;
}

export function LintSeverityBadge({ severity }: { severity: LintSeverity }) {
  const s = LINT_SEVERITY_STYLE[severity] ?? { label: severity, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${s.className}`}>{s.label}</span>;
}

export function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const s = BACKUP_STATUS_STYLE[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${s.className}`}>{s.label}</span>;
}

export function DiffKindBadge({ kind }: { kind: DiffKind }) {
  const s = DIFF_KIND_STYLE[kind] ?? { label: kind, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${s.className}`}>{s.label}</span>;
}

export function SqlTypeBadge({ sqlType }: { sqlType: SqlType }) {
  const isDdl = sqlType === 'DDL';
  return (
    <span
      className={`${baseBadge} ${
        isDdl
          ? 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300'
          : 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300'
      }`}
    >
      {sqlType}
    </span>
  );
}
