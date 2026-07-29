'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  const [executionsNotice, setExecutionsNotice] = useState('');
  const [backupsNotice, setBackupsNotice] = useState('');

  const load = useCallback(() => {
    return getChangeRequest(id)
      .then((next) => {
        setCr(next);
        setError(''); // 이전 실패 배너가 남지 않도록 성공 시 반드시 지운다
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  const loadExecutions = useCallback(() => {
    return listExecutions(id)
      .then((rows) => {
        setExecutions(rows);
        setExecutionsNotice('');
      })
      .catch(() => {
        // 조회 실패를 빈 배열로 삼키면 "적용된 적 없음"으로 보인다 — 감사 제품에서 최악의 거짓 음성.
        setExecutions([]);
        setExecutionsNotice(t('executionsUnavailable'));
      });
  }, [id, t]);

  const loadBackups = useCallback(() => {
    return listBackups(id)
      .then((rows) => {
        setBackups(rows);
        setBackupsNotice('');
      })
      .catch((err: unknown) => {
        setBackups([]);
        // REVIEWER·ADMIN은 백업 조회 권한이 없어 매 조회마다 403을 받는다(정상 경로).
        // 그들은 롤백 버튼도 볼 수 없으므로 알리면 소음이다. 그 외 실패만 알린다.
        setBackupsNotice(err instanceof ApiError && err.status === 403 ? '' : t('backupsUnavailable'));
      });
  }, [id, t]);

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
      {/* cr이 이미 있는데 에러가 났다면 갱신만 실패한 것이다. 원시 에러만 보여주면
          "내 승인이 실패했다"로 읽혀 사용자가 다시 눌러 중복 결재를 만든다. */}
      <InlineError message={error ? (cr ? `${t('staleContent')} ${error}` : error) : ''} />

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
              <AssigneePanel cr={cr} user={user} onDone={load} />

              <ApprovalProgressPanel cr={cr} />

              <ActionPanel cr={cr} user={user} onDone={load} />

              <ApplyPanel
                cr={cr}
                user={user}
                onApplied={async () => {
                  await Promise.all([load(), loadExecutions(), loadBackups()]);
                }}
              />

              <ExecutionHistory
                executions={executions}
                backups={backups}
                canRollback={applyRoleAllowed(cr, user)}
                executionsNotice={executionsNotice}
                backupsNotice={backupsNotice}
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
  onDone,
}: {
  cr: ChangeRequestDetail;
  user: User;
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
      {canSubmit && <SubmitAction id={cr.id} onDone={onDone} />}
      {canReview && (
        <DecisionAction
          title={t('reviewTitle')}
          badge={isReviewDelegate ? <DelegateBadge label={t('delegateReview')} /> : null}
          run={(decision, comment) => reviewChangeRequest(cr.id, decision, comment)}
          onDone={onDone}
        />
      )}
      {canApprove && (
        <DecisionAction
          title={t('finalApprovalTitle')}
          badge={isApproveDelegate ? <DelegateBadge label={t('delegateApproval')} /> : null}
          run={(decision, comment) => approveChangeRequest(cr.id, decision, comment)}
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
  onDone,
}: {
  cr: ChangeRequestDetail;
  user: User;
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
  const [error, setError] = useState('');

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
    setError('');
    try {
      await setAssignees(cr.id, {
        reviewerId: reviewerId || undefined,
        approverIds: approverIds.filter((id) => id),
      });
      await onDone();
    } catch (err) {
      setError((err as Error).message);
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
      <InlineError message={error} className="mt-3" />
    </section>
  );
}

function SubmitAction({
  id,
  onDone,
}: {
  id: string;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await submitChangeRequest(id);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('submitNotice')}</p>
        <button onClick={submit} disabled={busy} className="btn-primary shrink-0 px-5 py-2.5 text-sm">
          {busy ? t('submitting') : t('requestReview')}
        </button>
      </div>
      <InlineError message={error} className="mt-3" />
    </section>
  );
}

function DecisionAction({
  title,
  badge,
  run,
  onDone,
}: {
  title: string;
  badge?: React.ReactNode;
  run: (decision: ReviewDecision, comment: string) => Promise<unknown>;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState('');
  // 검증 실패일 때만 textarea를 aria로 연결한다. API 실패는 필드 잘못이 아니다.
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function act(decision: ReviewDecision) {
    setError('');
    setInvalid(false);
    if (decision === 'REJECT' && !comment.trim()) {
      setError(t('rejectReasonRequired'));
      setInvalid(true);
      textareaRef.current?.focus(); // WCAG 3.3.1 — 문제가 된 필드를 식별시킨다
      return;
    }
    setBusy(decision);
    try {
      await run(decision, comment.trim());
      setComment('');
      await onDone();
    } catch (err) {
      setError((err as Error).message);
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
        ref={textareaRef}
        aria-label={t('reviewCommentAriaLabel')}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className="mt-3 w-full resize-y rounded-2xl bg-subtle px-4 py-3 text-sm outline-none ring-1 ring-border-strong focus:ring-primary"
        placeholder={t('commentPlaceholder')}
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          // 검증 에러만 입력 즉시 지운다. API 실패는 실제 서버 결과이므로 재시도까지 남긴다.
          if (invalid) {
            setError('');
            setInvalid(false);
          }
        }}
      />
      <InlineError message={error} id={errorId} className="mt-3" />
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
  onApplied,
}: {
  cr: ChangeRequestDetail;
  user: User;
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
  const [lintNotice, setLintNotice] = useState('');
  const [lintRetrying, setLintRetrying] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunError, setDryRunError] = useState('');
  const [applyError, setApplyError] = useState('');

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
  // 실패 시 STAGING/PROD는 적용을 막으므로(fail-closed) 재시도 수단이 반드시 필요하다.
  const loadLint = useCallback(() => {
    let active = true;
    // lintNotice를 여기서 지우지 않는다 — 지우면 재시도 클릭 즉시 알림과 버튼이 함께
    // 사라져 요청이 끝날 때까지 Apply만 비활성인 채 설명 없는 화면이 된다. 대신
    // lintRetrying으로 버튼 라벨만 바꾸고, 알림은 결과가 온 뒤에만 갱신한다.
    setLintRetrying(true);
    lintChangeRequest(cr.id)
      .then((res) => {
        if (!active) return;
        setLint(res);
        setLintNotice('');
      })
      .catch(() => {
        if (!active) return;
        setLint(null);
        // DEV는 적용이 막히지 않으므로 "적용할 수 없습니다"라고 말하면 안 된다.
        setLintNotice(t(cr.targetEnv === 'DEV' ? 'lintUnavailableDev' : 'lintUnavailable'));
      })
      .finally(() => {
        if (!active) return;
        setLintRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [cr.id, cr.targetEnv, t]);

  useEffect(() => {
    if (!roleAllowed) return;
    return loadLint();
  }, [roleAllowed, loadLint]);

  const matching = useMemo(
    () => (dbs ?? []).filter((d) => d.env === cr.targetEnv),
    [dbs, cr.targetEnv],
  );

  if (!roleAllowed) return null;

  const lintBlocked = lint?.maxSeverity === 'BLOCK';
  // DEV는 정책이 없을 때만 서버가 BLOCK→WARN으로 강등한다(기본값, apps/api/src/apply/lint.engine.ts:89).
  // DEV에 BLOCK 정책이 명시적으로 저장돼 있으면 서버 게이트(apply.service.ts의 hasBlock, 환경 무관)가
  // DEV도 막는다 — 그 경우 이 클라이언트 게이트는 의도적으로 느슨하며, 조회 실패 시 서버가 최종 방어선이다.
  const lintGateRequired = cr.targetEnv !== 'DEV';

  async function runDryRun() {
    if (!selectedId) return;
    setDryRunning(true);
    setDryRun(null);
    setDryRunError('');
    try {
      setDryRun(await dryRunChangeRequest(cr.id, selectedId));
    } catch (err) {
      setDryRunError((err as Error).message);
    } finally {
      setDryRunning(false);
    }
  }

  async function apply() {
    if (!selectedId) return;
    setBusy(true);
    setApplyError('');
    setResult(null);
    try {
      const exec = await applyChangeRequest(cr.id, selectedId);
      setResult({ status: exec.status });
      await onApplied();
    } catch (err) {
      setApplyError((err as Error).message);
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
    !(lintGateRequired && lint === null) &&
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

      {lintNotice && (
        <div className="mt-3">
          <InlineError message={lintNotice} tone="notice" />
          <div className="mt-2 flex justify-end">
            <button
              onClick={loadLint}
              disabled={lintRetrying}
              className="focusable rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
            >
              {lintRetrying ? t('checking') : t('lintRetry')}
            </button>
          </div>
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
            error={dryRunError}
          />

          <div className="mt-4 flex items-center justify-end gap-3">
            <button onClick={apply} disabled={!canApply} className="btn-primary px-6 py-3 text-sm">
              {busy ? t('applying') : t('applyTitle')}
            </button>
          </div>
          <InlineError message={applyError} className="mt-3" />
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
  error,
}: {
  result: DryRunResult | null;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
  error?: string;
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

      <InlineError message={error} className="mt-3" />

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
  executionsNotice,
  backupsNotice,
  onRolledBack,
}: {
  executions: Execution[] | null;
  backups: Backup[];
  canRollback: boolean;
  executionsNotice: string;
  backupsNotice: string;
  onRolledBack: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const rows = executions ?? [];
  // 알림이 있으면 목록이 비어도 섹션을 렌더해야 알림이 표시될 자리가 생긴다.
  // 단, backupsNotice는 rows.length===0이면 아래에서 절대 표시되지 않으므로(위 message 조건 참고)
  // 그것만으로는 섹션을 렌더할 이유가 안 된다 — 안 그러면 빈 "Apply history (0)" 제목만 남는다.
  if (rows.length === 0 && !executionsNotice) return null;

  const backupsById = new Map(backups.map((b) => [b.id, b]));

  return (
    <section>
      <h2 className="text-base font-semibold text-ink">
        {executionsNotice ? t('applyHistoryTitle') : t('applyHistory', { count: rows.length })}
      </h2>
      {/* 이력을 못 불러온 상황에서 백업 알림은 중복이고, 롤백할 이력 자체가 없어 무의미하다.
          canRollback이 false거나(그 역할은 롤백 버튼 자체를 볼 수 없다) 실행 이력이 0건이면
          (롤백 대상이 없다) 백업 알림도 보여줄 이유가 없다. */}
      <InlineError
        message={executionsNotice || (canRollback && rows.length > 0 ? backupsNotice : '')}
        tone="notice"
        className="mt-3"
      />
      <div className="mt-3 space-y-4">
        {rows.map((exec) => (
          <ExecutionCard
            key={exec.id}
            exec={exec}
            backup={exec.backupId ? backupsById.get(exec.backupId) : undefined}
            canRollback={canRollback}
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
  onRolledBack,
}: {
  exec: Execution;
  backup: Backup | undefined;
  canRollback: boolean;
  onRolledBack: () => Promise<unknown>;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('changeRequestDetail');
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState('');
  const isApply = (exec.kind ?? 'APPLY') === 'APPLY';
  const restorable = isBackupRestorable(backup);
  // Rollback exposure condition: APPLY execution + restorable backup + permission
  const showRollback = isApply && restorable && canRollback;

  async function rollback() {
    if (!window.confirm(t('rollbackConfirm'))) {
      return;
    }
    setRollingBack(true);
    setError('');
    try {
      await rollbackExecution(exec.id);
      await onRolledBack();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      // 성공 경로에도 반드시 리셋해야 한다. 카드는 exec.id 키로 그대로 마운트된 채 남으므로
      // 리셋하지 않으면 버튼이 "롤백 중…" 라벨로 영구 비활성이 된다.
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
        <div className="border-t border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">{t('rollbackDesc')}</p>
            <button
              onClick={rollback}
              disabled={rollingBack}
              className="focusable shrink-0 rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
            >
              {rollingBack ? t('rollingBack') : t('rollback')}
            </button>
          </div>
          <InlineError message={error} className="mt-3" />
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
