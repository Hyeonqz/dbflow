'use client';

import { useTranslations } from 'next-intl';
import type {
  BackupStatus,
  ChangeRequestStatus,
  DiffKind,
  ExecutionStatus,
  LintSeverity,
  SqlType,
  TargetEnv,
} from '@/lib/api';

const STATUS_STYLE: Record<ChangeRequestStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  SUBMITTED: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  REVIEW_APPROVED: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  REVIEW_REJECTED: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  FINAL_APPROVED: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  FINAL_REJECTED: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  APPLIED: 'bg-emerald-600 text-white',
};

const ENV_STYLE: Record<TargetEnv, { label: string; className: string }> = {
  DEV: { label: 'DEV', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' },
  STAGING: { label: 'STAGING', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  PROD: { label: 'PROD', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
};

// English fallback; page consumers of this constant are out of Task 2 scope (see report).
export const SQL_TYPE_LABEL: Record<SqlType, string> = {
  DDL: 'DDL (structure)',
  DML: 'DML (data)',
};

const EXECUTION_STATUS_STYLE: Record<ExecutionStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  RUNNING: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  SUCCESS: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  FAILED: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
};

const DIFF_KIND_STYLE: Record<DiffKind, string> = {
  CREATE_TABLE: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  ADD_COLUMN: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  DROP_COLUMN: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  MODIFY_COLUMN: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  ADD_INDEX: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  DROP_INDEX: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  DROP_TABLE: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
};

const LINT_SEVERITY_STYLE: Record<LintSeverity, { label: string; className: string }> = {
  INFO: { label: 'INFO', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' },
  WARN: { label: 'WARN', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  BLOCK: { label: 'BLOCK', className: 'bg-red-600 text-white' },
};

const BACKUP_STATUS_STYLE: Record<BackupStatus, string> = {
  SUCCESS: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  PARTIAL: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  FAILED: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
};

const baseBadge = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold';

export function StatusBadge({ status }: { status: ChangeRequestStatus }) {
  const t = useTranslations('enum');
  const className = STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300';
  const label = t.has(`status.${status}`) ? t(`status.${status}`) : status;
  return <span className={`${baseBadge} ${className}`}>{label}</span>;
}

export function EnvBadge({ env }: { env: TargetEnv }) {
  const e = ENV_STYLE[env] ?? { label: env, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${e.className}`}>{e.label}</span>;
}

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  const t = useTranslations('enum');
  const className = EXECUTION_STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300';
  const label = t.has(`execution.${status}`) ? t(`execution.${status}`) : status;
  return <span className={`${baseBadge} ${className}`}>{label}</span>;
}

export function LintSeverityBadge({ severity }: { severity: LintSeverity }) {
  const s = LINT_SEVERITY_STYLE[severity] ?? { label: severity, className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' };
  return <span className={`${baseBadge} ${s.className}`}>{s.label}</span>;
}

export function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const t = useTranslations('enum');
  const className = BACKUP_STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300';
  const label = t.has(`backup.${status}`) ? t(`backup.${status}`) : status;
  return <span className={`${baseBadge} ${className}`}>{label}</span>;
}

export function DiffKindBadge({ kind }: { kind: DiffKind }) {
  const t = useTranslations('enum');
  const className = DIFF_KIND_STYLE[kind] ?? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300';
  const label = t.has(`diffKind.${kind}`) ? t(`diffKind.${kind}`) : kind;
  return <span className={`${baseBadge} ${className}`}>{label}</span>;
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
