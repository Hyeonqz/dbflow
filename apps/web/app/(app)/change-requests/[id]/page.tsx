'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCurrentUser, type User } from '@/lib/auth';
import {
  applyChangeRequest,
  approveChangeRequest,
  dryRunChangeRequest,
  getChangeRequest,
  lintChangeRequest,
  listBackups,
  listExecutions,
  listTargetDatabases,
  getScheduleStatus,
  listUsersByRole,
  reviewChangeRequest,
  rollbackExecution,
  setAssignees,
  submitChangeRequest,
  ApiError,
  type Backup,
  type ChangeRequestDetail,
  type DryRunResult,
  type Execution,
  type LintResult,
  type ReviewDecision,
  type ScheduleStatus,
  type TargetDatabase,
  type TargetEnv,
  type UserSummary,
} from '@/lib/api';
import {
  BackupStatusBadge,
  EnvBadge,
  ExecutionStatusBadge,
  LintSeverityBadge,
  SqlTypeBadge,
  StatusBadge,
} from '@/components/badges';
import { formatBusinessDateTime, formatDateTime } from '@/lib/format';
import { InlineError } from '@/components/inline-error';
import { PageHeader } from '@/components/page-header';
import type { Locale } from '@/i18n/config';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function ChangeRequestDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const locale = useLocale() as Locale;
  const t = useTranslations('changeRequestDetail');
  const { user, ready } = useCurrentUser();
  const [cr, setCr] = useState<ChangeRequestDetail | null>(null);
  const [executions, setExecutions] = useState<Execution[] | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return getChangeRequest(id)
      .then(setCr)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  const loadExecutions = useCallback(() => {
    return listExecutions(id)
      .then(setExecutions)
      .catch(() => setExecutions([])); // 이력 조회 실패는 본문 흐름을 막지 않음
  }, [id]);

  const loadBackups = useCallback(() => {
    return listBackups(id)
      .then(setBackups)
      .catch(() => setBackups([])); // 권한/조회 실패는 본문 흐름을 막지 않음
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    load();
    loadExecutions();
    loadBackups();
  }, [ready, load, loadExecutions, loadBackups]);

  if (!ready || !user) {
    return <p className="text-muted">{t('loading')}</p>;
  }

  return (
    <>
      {!cr && <InlineError message={error} />}

      {!error && !cr && <p className="text-muted">{t('loading')}</p>}

      {cr && (
        <>
          <PageHeader title={cr.title} action={<StatusBadge status={cr.status} />} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <EnvBadge env={cr.targetEnv} />
            <span>{cr.authorName ?? cr.authorId}</span>
            <span aria-hidden>·</span>
            <span>{formatDateTime(cr.createdAt, locale)}</span>
            <span aria-hidden>·</span>
            <span>{t('reviewerLabel', { name: cr.reviewerName ?? t('unassigned') })}</span>
            <span aria-hidden>·</span>
            <span>
              {t('approverLabel', {
                names:
                  cr.approvers.length === 0
                    ? t('unassigned')
                    : cr.approvers.map((a) => a.name ?? t('noName')).join(', '),
              })}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left: description + SQL files */}
            <div className="space-y-6">
              {cr.description && (
                <p className="whitespace-pre-wrap rounded-2xl bg-card p-5 text-sm leading-relaxed text-ink ring-1 ring-border">
                  {cr.description}
                </p>
              )}

              <section>
                <h2 className="text-base font-semibold text-ink">{t('sqlFiles', { count: cr.files.length })}</h2>
                <div className="mt-3 space-y-4">
                  {cr.files.map((file, idx) => (
                    <article key={`${file.filename}-${idx}`} className="overflow-hidden rounded-2xl ring-1 ring-border">
                      <div className="flex items-center justify-between bg-card px-4 py-3">
                        <span className="font-mono text-sm text-ink">{file.filename}</span>
                        <SqlTypeBadge sqlType={file.sqlType} />
                      </div>
                      <pre className="overflow-x-auto bg-code px-4 py-3 text-xs leading-relaxed text-code-fg">
                        <code>{file.content}</code>
                      </pre>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            {/* Right: actions + apply + history + status history */}
            <div className="flex flex-col gap-6">
              <AssigneePanel cr={cr} user={user} onError={setError} onDone={load} />

              <ApprovalProgressPanel cr={cr} />

              <ActionPanel
                cr={cr}
                user={user}
                onError={setError}
                onDone={load}
              />

              <ApplyPanel
                cr={cr}
                user={user}
                onError={setError}
                onApplied={async () => {
                  await Promise.all([load(), loadExecutions(), loadBackups()]);
                }}
              />

              <ExecutionHistory
                executions={executions}
                backups={backups}
                canRollback={applyRoleAllowed(cr, user)}
                onError={setError}
                onRolledBack={async () => {
                  await Promise.all([load(), loadExecutions(), loadBackups()]);
                }}
              />

              <section>
                <h2 className="text-base font-semibold text-ink">{t('statusHistory')}</h2>
                <ol className="mt-4 space-y-4">
                  {cr.statusHistory.length === 0 && (
                    <li className="text-sm text-muted">{t('noHistory')}</li>
                  )}
                  {cr.statusHistory.map((h, idx) => (
                    <li key={idx} className="relative pl-6">
                      <span
                        className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary"
                        aria-hidden
                      />
                      {idx < cr.statusHistory.length - 1 && (
                        <span className="absolute left-[4.5px] top-4 h-full w-px bg-border-strong" aria-hidden />
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={h.toStatus} />
                        <span className="text-sm text-ink">{h.actorName ?? h.actorId}</span>
                        <span className="text-xs text-muted">{formatDateTime(h.createdAt, locale)}</span>
                      </div>
                      {h.comment && <p className="mt-1 text-sm text-muted">{h.comment}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Expose only the actions available for the current role/status
// ---------------------------------------------------------------------------
function ActionPanel({
  cr,
  user,
  onError,
  onDone,
}: {
  cr: ChangeRequestDetail;
  user: User;
  onError: (msg: string) => void;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const role = user.role;
  const canSubmit = role === 'DEVELOPER' && cr.status === 'DRAFT';
  const canReview = role === 'REVIEWER' && cr.status === 'SUBMITTED';
  const myApprover = cr.approvers.find((a) => a.userId === user.id);
  const canApprove =
    (role === 'APPROVER' && cr.status === 'REVIEW_APPROVED' && !!myApprover && myApprover.decision === null && !cr.iAlreadyActed) ||
    cr.canActAsDelegate;
  const myDecisionMade = role === 'APPROVER' && !!myApprover && myApprover.decision !== null;
  const isReviewDelegate = canReview && cr.canActAsDelegate && cr.reviewerId !== user.id;
  const isApproveDelegate = canApprove && cr.canActAsDelegate && !myApprover;

  if (!canSubmit && !canReview && !canApprove && !myDecisionMade) return null;

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
      {canSubmit && (
        <SubmitAction id={cr.id} onError={onError} onDone={onDone} />
      )}
      {canReview && (
        <DecisionAction
          title={t('reviewTitle')}
          badge={isReviewDelegate ? <DelegateBadge label={t('delegateReview')} /> : null}
          run={(decision, comment) => reviewChangeRequest(cr.id, decision, comment)}
          onError={onError}
          onDone={onDone}
        />
      )}
      {canApprove && (
        <DecisionAction
          title={t('finalApprovalTitle')}
          badge={isApproveDelegate ? <DelegateBadge label={t('delegateApproval')} /> : null}
          run={(decision, comment) => approveChangeRequest(cr.id, decision, comment)}
          onError={onError}
          onDone={onDone}
        />
      )}
      {myDecisionMade && myApprover && (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t('finalApprovalTitle')}</h2>
          <ApproverDecisionBadge decision={myApprover.decision} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Approval progress — per-approver approve/reject/pending status and overall progress (approved/required)
// ---------------------------------------------------------------------------
function DelegateBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
      {label}
    </span>
  );
}

function ApproverDecisionBadge({ decision }: { decision: 'APPROVE' | 'REJECT' | null }) {
  const t = useTranslations('changeRequestDetail');
  if (decision === 'APPROVE') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
        {t('approve')}
      </span>
    );
  }
  if (decision === 'REJECT') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">
        {t('reject')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
      {t('pending')}
    </span>
  );
}

function ApprovalProgressPanel({ cr }: { cr: ChangeRequestDetail }) {
  const t = useTranslations('changeRequestDetail');
  if (cr.approvers.length === 0) return null;
  const approved = cr.approvers.filter((a) => a.decision === 'APPROVE').length;
  const required = cr.approvers.length;

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('approvalProgress')}</h2>
        <span className="text-xs font-medium text-muted">
          {t('approvalCount', { approved, required })}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {cr.approvers.map((a) => (
          <li key={a.userId} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink">
              {a.decidedBy && a.decidedBy !== a.name
                ? t('delegatedApprovalBy', { name: a.name ?? t('noName'), decidedBy: a.decidedBy })
                : (a.name ?? t('noName'))}
              {a.department && <span className="text-muted"> ({a.department})</span>}
            </span>
            <ApproverDecisionBadge decision={a.decision} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Assignee (reviewer/approver) display + reassignment — only the DRAFT author or ADMIN can change
// ---------------------------------------------------------------------------
function AssigneePanel({
  cr,
  user,
  onError,
  onDone,
}: {
  cr: ChangeRequestDetail;
  user: User;
  onError: (msg: string) => void;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const canReassign = (cr.status === 'DRAFT' && user.id === cr.authorId) || user.role === 'ADMIN';

  const [reviewers, setReviewers] = useState<UserSummary[]>([]);
  const [approvers, setApprovers] = useState<UserSummary[]>([]);
  const [reviewerId, setReviewerId] = useState(cr.reviewerId ?? '');
  const [approverIds, setApproverIds] = useState<string[]>(
    cr.approvers.length > 0 ? cr.approvers.map((a) => a.userId) : [''],
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canReassign) return;
    listUsersByRole('REVIEWER').then(setReviewers).catch(() => setReviewers([]));
    listUsersByRole('APPROVER').then(setApprovers).catch(() => setApprovers([]));
  }, [canReassign]);

  useEffect(() => {
    setReviewerId(cr.reviewerId ?? '');
    setApproverIds(cr.approvers.length > 0 ? cr.approvers.map((a) => a.userId) : ['']);
  }, [cr.reviewerId, cr.approvers]);

  if (!canReassign) {
    return (
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-sm font-semibold">{t('assignees')}</h2>
        <p className="mt-2 text-sm text-muted">{t('reviewerLabel', { name: cr.reviewerName ?? t('unassigned') })}</p>
        <p className="mt-1 text-sm text-muted">
          {t('approverLabel', {
            names:
              cr.approvers.length === 0
                ? t('unassigned')
                : cr.approvers.map((a) => a.name ?? t('noName')).join(', '),
          })}
        </p>
      </section>
    );
  }

  function updateApproverId(idx: number, value: string) {
    setApproverIds((prev) => prev.map((id, i) => (i === idx ? value : id)));
  }

  async function reassign() {
    setBusy(true);
    onError('');
    try {
      await setAssignees(cr.id, {
        reviewerId: reviewerId || undefined,
        approverIds: approverIds.filter((id) => id),
      });
      await onDone();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
      <h2 className="text-sm font-semibold">{t('assignees')}</h2>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <select
          aria-label={t('reviewer')}
          className="w-full rounded-2xl bg-subtle px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary sm:flex-1"
          value={reviewerId}
          onChange={(e) => setReviewerId(e.target.value)}
        >
          <option value="">{t('reviewerUnassignedOption')}</option>
          {reviewers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.department})
            </option>
          ))}
        </select>
        <div className="w-full space-y-2 sm:flex-1">
          {approverIds.map((selectedId, idx) => (
            <select
              key={idx}
              aria-label={t('approverAriaLabel', { n: idx + 1 })}
              className="w-full rounded-2xl bg-subtle px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary"
              value={selectedId}
              onChange={(e) => updateApproverId(idx, e.target.value)}
            >
              <option value="">{t('approverUnassignedOption')}</option>
              {approvers
                .filter((a) => a.id === selectedId || !approverIds.includes(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.department})
                  </option>
                ))}
            </select>
          ))}
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={reassign} disabled={busy} className="btn-primary px-5 py-2.5 text-sm">
          {busy ? t('changing') : t('changeAssignment')}
        </button>
      </div>
    </section>
  );
}

function SubmitAction({
  id,
  onError,
  onDone,
}: {
  id: string;
  onError: (msg: string) => void;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    onError('');
    try {
      await submitChangeRequest(id);
      await onDone();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted">{t('submitNotice')}</p>
      <button onClick={submit} disabled={busy} className="btn-primary shrink-0 px-5 py-2.5 text-sm">
        {busy ? t('submitting') : t('requestReview')}
      </button>
    </div>
  );
}

function DecisionAction({
  title,
  badge,
  run,
  onError,
  onDone,
}: {
  title: string;
  badge?: React.ReactNode;
  run: (decision: ReviewDecision, comment: string) => Promise<unknown>;
  onError: (msg: string) => void;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<ReviewDecision | null>(null);

  async function act(decision: ReviewDecision) {
    onError('');
    if (decision === 'REJECT' && !comment.trim()) {
      onError(t('rejectReasonRequired'));
      return;
    }
    setBusy(decision);
    try {
      await run(decision, comment.trim());
      setComment('');
      await onDone();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      <textarea
        aria-label={t('reviewCommentAriaLabel')}
        className="mt-3 w-full resize-y rounded-2xl bg-subtle px-4 py-3 text-sm outline-none ring-1 ring-border-strong focus:ring-primary"
        placeholder={t('commentPlaceholder')}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => act('APPROVE')}
          disabled={busy !== null}
          className="btn-primary flex-1 px-4 py-2.5 text-sm"
        >
          {busy === 'APPROVE' ? t('processing') : t('approve')}
        </button>
        <button
          onClick={() => act('REJECT')}
          disabled={busy !== null}
          className="focusable flex-1 rounded-2xl bg-card px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
        >
          {busy === 'REJECT' ? t('processing') : t('reject')}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Apply — reflects per-environment permission/approval gate policy
//   · Permission: DEV allows the CR author (developer) or an approver, STAGING|PROD require an approver
//   · Gate: DEV allows early apply (except rejected/already-applied), STAGING|PROD require FINAL_APPROVED
// ---------------------------------------------------------------------------
const ENV_POLICY_KEY: Record<TargetEnv, string> = {
  DEV: 'envPolicyDev',
  STAGING: 'envPolicyStaging',
  PROD: 'envPolicyProd',
};

function applyRoleAllowed(cr: ChangeRequestDetail, user: User): boolean {
  if (cr.targetEnv === 'DEV') {
    return user.role === 'APPROVER' || (user.role === 'DEVELOPER' && user.id === cr.authorId);
  }
  return user.role === 'APPROVER';
}

function applyStatusGate(cr: ChangeRequestDetail): { allowed: boolean; reasonKey?: string } {
  if (cr.targetEnv === 'DEV') {
    const blocked: ChangeRequestDetail['status'][] = ['REVIEW_REJECTED', 'FINAL_REJECTED', 'APPLIED'];
    if (blocked.includes(cr.status)) {
      return { allowed: false, reasonKey: 'gateBlockedDev' };
    }
    return { allowed: true };
  }
  if (cr.status !== 'FINAL_APPROVED') {
    return { allowed: false, reasonKey: 'gateNotFinalApproved' };
  }
  return { allowed: true };
}

function ApplyPanel({
  cr,
  user,
  onError,
  onApplied,
}: {
  cr: ChangeRequestDetail;
  user: User;
  onError: (msg: string) => void;
  onApplied: () => Promise<unknown>;
}) {
  const locale = useLocale() as Locale;
  // next-intl request config always sets timeZone (see i18n/request.ts); non-null by construction.
  const timeZone = useTimeZone()!;
  const t = useTranslations('changeRequestDetail');
  const ts = useTranslations('serverMessages');
  const [dbs, setDbs] = useState<TargetDatabase[] | null>(null);
  const [dbNotice, setDbNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string } | null>(null);

  // 안전장치(Plan 5)
  const [lint, setLint] = useState<LintResult | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [dryRunning, setDryRunning] = useState(false);

  // 적용 작업창/동결 상태(Plan 6) — 배너는 보조 표시, 실제 강제는 서버 게이트
  const [schedule, setSchedule] = useState<ScheduleStatus | null>(null);
  useEffect(() => {
    getScheduleStatus(cr.targetEnv).then(setSchedule).catch(() => setSchedule(null));
  }, [cr.targetEnv]);

  const roleAllowed = applyRoleAllowed(cr, user);
  const gate = applyStatusGate(cr);

  useEffect(() => {
    if (!roleAllowed) return;
    let active = true;
    listTargetDatabases()
      .then((list) => active && setDbs(list))
      .catch((err: unknown) => {
        if (!active) return;
        setDbs([]);
        // Developers can only view target DBs for the DEV environment; show a notice if out of permission.
        if (err instanceof ApiError && err.status === 403) {
          setDbNotice(t('dbNoticeForbidden'));
        } else {
          setDbNotice((err as Error).message);
        }
      });
    return () => {
      active = false;
    };
  }, [roleAllowed]);

  // 적용 전 위험 SQL 린트(대상 DB와 무관, CR 파일 정적 분석). 환경정책 반영된 severity.
  useEffect(() => {
    if (!roleAllowed) return;
    let active = true;
    lintChangeRequest(cr.id)
      .then((res) => active && setLint(res))
      .catch(() => active && setLint(null)); // 린트 실패는 적용을 막지 않되 표시만 생략
    return () => {
      active = false;
    };
  }, [roleAllowed, cr.id]);

  const matching = useMemo(
    () => (dbs ?? []).filter((d) => d.env === cr.targetEnv),
    [dbs, cr.targetEnv],
  );

  if (!roleAllowed) return null;

  const lintBlocked = lint?.maxSeverity === 'BLOCK';

  async function runDryRun() {
    if (!selectedId) return;
    setDryRunning(true);
    setDryRun(null);
    onError('');
    try {
      setDryRun(await dryRunChangeRequest(cr.id, selectedId));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setDryRunning(false);
    }
  }

  async function apply() {
    if (!selectedId) return;
    setBusy(true);
    onError('');
    setResult(null);
    try {
      const exec = await applyChangeRequest(cr.id, selectedId);
      setResult({ status: exec.status });
      await onApplied();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canApply =
    gate.allowed &&
    !!selectedId &&
    !busy &&
    matching.length > 0 &&
    !lintBlocked &&
    (schedule === null || schedule.allowed);

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
      <h2 className="text-sm font-semibold">{t('applyTitle')}</h2>
      <p className="mt-1 text-sm text-muted">{t(ENV_POLICY_KEY[cr.targetEnv])}</p>

      {/* (A) Risky SQL lint results */}
      {lint && lint.items.length > 0 && (
        <div
          className={`mt-4 rounded-2xl p-4 ring-1 ${
            lintBlocked
              ? 'bg-red-50 ring-red-200 dark:bg-red-500/15 dark:ring-red-500/30'
              : 'bg-subtle ring-border'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">{t('lintCheck')}</span>
            <LintSeverityBadge severity={lint.maxSeverity} />
          </div>
          {lintBlocked && (
            <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-300">
              {t('lintBlockedMessage', { env: cr.targetEnv })}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {lint.items.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <LintSeverityBadge severity={item.severity} />
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted">
                    {item.filename}
                    {item.line ? `:${item.line}` : ''} · {item.rule}
                  </span>
                  <p className="text-ink">
                    {ts.has(`lintRule.${item.rule}`) ? ts(`lintRule.${item.rule}`) : item.message}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!gate.allowed && gate.reasonKey && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {t(gate.reasonKey)}
        </p>
      )}

      <InlineError message={dbNotice} tone="notice" className="mt-3" />

      {gate.allowed && dbs !== null && matching.length === 0 && !dbNotice && (
        <p className="mt-3 rounded-2xl bg-subtle px-4 py-3 text-sm text-muted">
          {t('noTargetDb', { env: cr.targetEnv })}
        </p>
      )}

      {gate.allowed && matching.length > 0 && (
        <>
          {schedule && !schedule.allowed && schedule.reason === 'FROZEN' && (
            <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {'🧊 '}
              {t('freezeActive', {
                reason: schedule.freeze?.reason ?? '',
                until: formatBusinessDateTime(schedule.freeze!.endsAt, locale, timeZone),
              })}
            </div>
          )}
          {schedule && !schedule.allowed && schedule.reason === 'OUT_OF_WINDOW' && (
            <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600">
              {t('outOfWindow')}
              {schedule.nextWindow
                ? t('nextWindowSuffix', {
                    day: t(`day.${DAY_KEYS[schedule.nextWindow.dayOfWeek]}`),
                    start: fmtMin(schedule.nextWindow.startMinute),
                    end: fmtMin(schedule.nextWindow.endMinute),
                  })
                : ''}
            </div>
          )}
          {schedule?.allowed && (
            <p className="mt-3 text-sm text-emerald-500">{t('windowOpen')}</p>
          )}

          <div className="mt-4 space-y-2">
            <label htmlFor="apply-db" className="block text-sm font-medium text-muted">
              {t('targetDbLabel', { env: cr.targetEnv })}
            </label>
            <select
              id="apply-db"
              className="w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setDryRun(null);
              }}
            >
              <option value="">{t('selectPlaceholder')}</option>
              {matching.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.host}:{d.port}/{d.database}
                </option>
              ))}
            </select>
          </div>

          {/* (B) Dry-run preview */}
          <DryRunSection
            result={dryRun}
            running={dryRunning}
            disabled={!selectedId || dryRunning}
            onRun={runDryRun}
          />

          <div className="mt-4 flex items-center justify-end gap-3">
            <button onClick={apply} disabled={!canApply} className="btn-primary px-6 py-3 text-sm">
              {busy ? t('applying') : t('applyTitle')}
            </button>
          </div>
        </>
      )}

      {result && (
        <p
          className={`mt-3 rounded-2xl px-4 py-3 text-sm ${
            result.status === 'SUCCESS'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300'
          }`}
        >
          {result.status === 'SUCCESS' ? t('applySuccess') : t('applyFailure')}
        </p>
      )}
    </section>
  );
}

// Impact preview before apply (dry-run): DML shows affectedRows, DDL is statically classified
function DryRunSection({
  result,
  running,
  disabled,
  onRun,
}: {
  result: DryRunResult | null;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  const t = useTranslations('changeRequestDetail');
  return (
    <div className="mt-4 rounded-2xl bg-subtle p-4 ring-1 ring-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-ink">{t('dryRunPreview')}</span>
          <p className="text-xs text-muted">{t('dryRunDesc')}</p>
        </div>
        <button
          onClick={onRun}
          disabled={disabled}
          className="focusable shrink-0 rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
        >
          {running ? t('checking') : t('runDryRun')}
        </button>
      </div>

      {result && (
        <ul className="mt-3 space-y-2">
          {result.perFile.length === 0 && (
            <li className="text-sm text-muted">{t('noImpactResult')}</li>
          )}
          {result.perFile.map((f, idx) => (
            <li
              key={idx}
              className={`rounded-xl bg-card px-3 py-2 ring-1 ${
                f.destructive ? 'ring-red-200 dark:ring-red-500/30' : 'ring-border'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-ink">{f.filename}</span>
                <span className="text-xs font-medium text-muted">
                  {f.mode === 'DML_TX_ROLLBACK' ? t('dmlMode') : t('ddlMode')}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">{f.impact}</span>
                {typeof f.affectedRows === 'number' && (
                  <span className="tabular-nums text-ink">{f.affectedRows} rows</span>
                )}
                {f.destructive && (
                  <span className="font-semibold text-red-600 dark:text-red-300">{t('destructive')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apply execution log/results — Execution + ExecutionStep timeline (+ backup status / rollback)
// ---------------------------------------------------------------------------
/** Whether a backup can restore data via rollback: not for failed backups; schema-only backups can't restore data. */
function isBackupRestorable(backup: Backup | undefined): boolean {
  if (!backup) return false;
  return backup.status !== 'FAILED';
}

function ExecutionHistory({
  executions,
  backups,
  canRollback,
  onError,
  onRolledBack,
}: {
  executions: Execution[] | null;
  backups: Backup[];
  canRollback: boolean;
  onError: (msg: string) => void;
  onRolledBack: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  if (executions === null || executions.length === 0) return null;

  const backupsById = new Map(backups.map((b) => [b.id, b]));

  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{t('applyHistory', { count: executions.length })}</h2>
      <div className="mt-3 space-y-4">
        {executions.map((exec) => (
          <ExecutionCard
            key={exec.id}
            exec={exec}
            backup={exec.backupId ? backupsById.get(exec.backupId) : undefined}
            canRollback={canRollback}
            onError={onError}
            onRolledBack={onRolledBack}
          />
        ))}
      </div>
    </section>
  );
}

function ExecutionCard({
  exec,
  backup,
  canRollback,
  onError,
  onRolledBack,
}: {
  exec: Execution;
  backup: Backup | undefined;
  canRollback: boolean;
  onError: (msg: string) => void;
  onRolledBack: () => Promise<unknown>;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('changeRequestDetail');
  const [rollingBack, setRollingBack] = useState(false);
  const isApply = (exec.kind ?? 'APPLY') === 'APPLY';
  const restorable = isBackupRestorable(backup);
  // Rollback exposure condition: APPLY execution + restorable backup + permission
  const showRollback = isApply && restorable && canRollback;

  async function rollback() {
    if (!window.confirm(t('rollbackConfirm'))) {
      return;
    }
    setRollingBack(true);
    onError('');
    try {
      await rollbackExecution(exec.id);
      await onRolledBack();
    } catch (err) {
      onError((err as Error).message);
      setRollingBack(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl ring-1 ring-border">
      <div className="flex items-center justify-between gap-3 bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          {!isApply && (
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              {t('rollback')}
            </span>
          )}
          <ExecutionStatusBadge status={exec.status} />
          <span className="text-xs text-muted">{formatDateTime(exec.createdAt, locale)}</span>
        </div>
        <span className="text-xs tabular-nums text-muted">
          {exec.startedAt && exec.finishedAt
            ? `${new Date(exec.finishedAt).getTime() - new Date(exec.startedAt).getTime()}ms`
            : ''}
        </span>
      </div>

      {/* Backup status (apply executions only) */}
      {isApply && backup && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-card px-4 py-2 text-xs">
          <BackupStatusBadge status={backup.status} />
          <span className="text-muted">
            {backup.scope === 'SCHEMA_AND_DATA' ? t('schemaAndData') : t('schemaOnly')}
          </span>
          <span className="text-muted">{formatBytes(backup.sizeBytes)}</span>
          <span className={restorable ? 'text-emerald-600 dark:text-emerald-300' : 'text-muted'}>
            {restorable ? t('restorableYes') : t('restorableNo')}
          </span>
          {backup.note && <span className="text-amber-700 dark:text-amber-300">· {backup.note}</span>}
        </div>
      )}

      <ol className="divide-y divide-border bg-card">
        {exec.steps.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted">{t('noSteps')}</li>
        )}
        {exec.steps.map((step) => (
          <li key={step.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-sm text-ink">{step.filename}</span>
              <ExecutionStatusBadge status={step.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted">
              {step.durationMs !== null && <span>{step.durationMs}ms</span>}
              {step.rowsAffected !== null && <span>{step.rowsAffected} rows</span>}
            </div>
            {step.error && (
              <pre className="mt-2 overflow-x-auto rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/15 dark:text-red-300">
                <code>{step.error}</code>
              </pre>
            )}
          </li>
        ))}
      </ol>

      {showRollback && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
          <p className="text-xs text-muted">
            {t('rollbackDesc')}
          </p>
          <button
            onClick={rollback}
            disabled={rollingBack}
            className="focusable shrink-0 rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
          >
            {rollingBack ? t('rollingBack') : t('rollback')}
          </button>
        </div>
      )}
    </article>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
