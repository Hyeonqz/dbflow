'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
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
import { formatDateTime, formatKstDateTime } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import type { Locale } from '@/i18n/config';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function ChangeRequestDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const locale = useLocale() as Locale;
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
    return <p className="text-muted">불러오는 중…</p>;
  }

  return (
    <>
      {error && !cr && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}

      {!error && !cr && <p className="text-muted">불러오는 중…</p>}

      {cr && (
        <>
          <PageHeader title={cr.title} action={<StatusBadge status={cr.status} />} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <EnvBadge env={cr.targetEnv} />
            <span>{cr.authorName ?? cr.authorId}</span>
            <span aria-hidden>·</span>
            <span>{formatDateTime(cr.createdAt, locale)}</span>
            <span aria-hidden>·</span>
            <span>검토자 {cr.reviewerName ?? '미지정'}</span>
            <span aria-hidden>·</span>
            <span>
              결재자{' '}
              {cr.approvers.length === 0
                ? '미지정'
                : cr.approvers.map((a) => a.name ?? '이름 없음').join(', ')}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 왼쪽: 설명 + SQL 파일 */}
            <div className="space-y-6">
              {cr.description && (
                <p className="whitespace-pre-wrap rounded-2xl bg-card p-5 text-sm leading-relaxed text-ink ring-1 ring-border">
                  {cr.description}
                </p>
              )}

              <section>
                <h2 className="text-base font-semibold text-ink">SQL 파일 ({cr.files.length})</h2>
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

            {/* 오른쪽: 액션 + 적용 + 이력 + 상태 히스토리 */}
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
                <h2 className="text-base font-semibold text-ink">상태 히스토리</h2>
                <ol className="mt-4 space-y-4">
                  {cr.statusHistory.length === 0 && (
                    <li className="text-sm text-muted">기록이 없습니다.</li>
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
// 역할/상태에 따라 가능한 액션만 노출
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
          title="검토 (1차)"
          badge={isReviewDelegate ? <DelegateBadge label="위임 검토" /> : null}
          run={(decision, comment) => reviewChangeRequest(cr.id, decision, comment)}
          onError={onError}
          onDone={onDone}
        />
      )}
      {canApprove && (
        <DecisionAction
          title="최종 결재"
          badge={isApproveDelegate ? <DelegateBadge label="위임 결재" /> : null}
          run={(decision, comment) => approveChangeRequest(cr.id, decision, comment)}
          onError={onError}
          onDone={onDone}
        />
      )}
      {myDecisionMade && myApprover && (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">최종 결재</h2>
          <ApproverDecisionBadge decision={myApprover.decision} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 결재 진행 — 결재자별 승인/반려/대기 상태와 전체 진행률(approved/required)
// ---------------------------------------------------------------------------
function DelegateBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
      {label}
    </span>
  );
}

function ApproverDecisionBadge({ decision }: { decision: 'APPROVE' | 'REJECT' | null }) {
  if (decision === 'APPROVE') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
        승인
      </span>
    );
  }
  if (decision === 'REJECT') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">
        반려
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
      대기
    </span>
  );
}

function ApprovalProgressPanel({ cr }: { cr: ChangeRequestDetail }) {
  if (cr.approvers.length === 0) return null;
  const approved = cr.approvers.filter((a) => a.decision === 'APPROVE').length;
  const required = cr.approvers.length;

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">결재 진행</h2>
        <span className="text-xs font-medium text-muted">
          {approved}/{required} 승인
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {cr.approvers.map((a) => (
          <li key={a.userId} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink">
              {a.decidedBy && a.decidedBy !== a.name
                ? `${a.name ?? '이름 없음'} — ${a.decidedBy} 대리 결재`
                : (a.name ?? '이름 없음')}
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
// 지정자(검토자/결재자) 표시 + 재지정 — DRAFT 상태의 작성자 또는 ADMIN만 변경 가능
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
        <h2 className="text-sm font-semibold">지정자</h2>
        <p className="mt-2 text-sm text-muted">검토자 {cr.reviewerName ?? '미지정'}</p>
        <p className="mt-1 text-sm text-muted">
          결재자{' '}
          {cr.approvers.length === 0
            ? '미지정'
            : cr.approvers.map((a) => a.name ?? '이름 없음').join(', ')}
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
      <h2 className="text-sm font-semibold">지정자</h2>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <select
          aria-label="검토자"
          className="w-full rounded-2xl bg-subtle px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary sm:flex-1"
          value={reviewerId}
          onChange={(e) => setReviewerId(e.target.value)}
        >
          <option value="">검토자 미지정</option>
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
              aria-label={`결재자 ${idx + 1}`}
              className="w-full rounded-2xl bg-subtle px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary"
              value={selectedId}
              onChange={(e) => updateApproverId(idx, e.target.value)}
            >
              <option value="">결재자 미지정</option>
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
          {busy ? '변경 중…' : '지정 변경'}
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
      <p className="text-sm text-muted">검토자에게 제출하면 더 이상 수정할 수 없습니다.</p>
      <button onClick={submit} disabled={busy} className="btn-primary shrink-0 px-5 py-2.5 text-sm">
        {busy ? '제출 중…' : '검토 요청'}
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
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<ReviewDecision | null>(null);

  async function act(decision: ReviewDecision) {
    onError('');
    if (decision === 'REJECT' && !comment.trim()) {
      onError('반려 시 사유를 입력해 주세요.');
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
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      <textarea
        aria-label="검토 의견"
        className="mt-3 w-full resize-y rounded-2xl bg-subtle px-4 py-3 text-sm outline-none ring-1 ring-border-strong focus:ring-primary"
        placeholder="의견 (반려 시 필수)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => act('APPROVE')}
          disabled={busy !== null}
          className="btn-primary flex-1 px-4 py-2.5 text-sm"
        >
          {busy === 'APPROVE' ? '처리 중…' : '승인'}
        </button>
        <button
          onClick={() => act('REJECT')}
          disabled={busy !== null}
          className="focusable flex-1 rounded-2xl bg-card px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
        >
          {busy === 'REJECT' ? '처리 중…' : '반려'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 적용(Apply) — 환경별 권한·승인 게이트 정책 반영
//   · 권한: DEV는 해당 CR author(개발자) 또는 결재자, STAGING|PROD는 결재자만
//   · 게이트: DEV는 조기 허용(반려/적용완료 제외), STAGING|PROD는 FINAL_APPROVED 필수
// ---------------------------------------------------------------------------
const ENV_POLICY_NOTE: Record<TargetEnv, string> = {
  DEV: 'DEV는 최종 승인 전에도 적용할 수 있습니다(빠른 반복). 반려·적용 완료 상태에서는 적용할 수 없습니다.',
  STAGING: 'STAGING은 최종 승인(FINAL_APPROVED)된 변경 요청만 적용할 수 있습니다.',
  PROD: 'PROD는 최종 승인(FINAL_APPROVED)된 변경 요청만 적용할 수 있습니다.',
};

function applyRoleAllowed(cr: ChangeRequestDetail, user: User): boolean {
  if (cr.targetEnv === 'DEV') {
    return user.role === 'APPROVER' || (user.role === 'DEVELOPER' && user.id === cr.authorId);
  }
  return user.role === 'APPROVER';
}

function applyStatusGate(cr: ChangeRequestDetail): { allowed: boolean; reason?: string } {
  if (cr.targetEnv === 'DEV') {
    const blocked: ChangeRequestDetail['status'][] = ['REVIEW_REJECTED', 'FINAL_REJECTED', 'APPLIED'];
    if (blocked.includes(cr.status)) {
      return { allowed: false, reason: '반려되었거나 이미 적용 완료된 요청은 적용할 수 없습니다.' };
    }
    return { allowed: true };
  }
  if (cr.status !== 'FINAL_APPROVED') {
    return { allowed: false, reason: '최종 승인(FINAL_APPROVED) 후에 적용할 수 있습니다.' };
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
        // 개발자는 DEV 환경 대상 DB만 조회 가능. 권한 밖이면 안내만 노출.
        if (err instanceof ApiError && err.status === 403) {
          setDbNotice('대상 DB 목록을 조회할 권한이 없습니다.');
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
      <h2 className="text-sm font-semibold">적용</h2>
      <p className="mt-1 text-sm text-muted">{ENV_POLICY_NOTE[cr.targetEnv]}</p>

      {/* (A) 위험 SQL 린트 결과 */}
      {lint && lint.items.length > 0 && (
        <div
          className={`mt-4 rounded-2xl p-4 ring-1 ${
            lintBlocked
              ? 'bg-red-50 ring-red-200 dark:bg-red-500/15 dark:ring-red-500/30'
              : 'bg-subtle ring-border'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">린트 검사</span>
            <LintSeverityBadge severity={lint.maxSeverity} />
          </div>
          {lintBlocked && (
            <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-300">
              BLOCK 위험이 있어 {cr.targetEnv} 환경에는 적용할 수 없습니다. SQL을 수정해 주세요.
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
                  <p className="text-ink">{item.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!gate.allowed && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {gate.reason}
        </p>
      )}

      {dbNotice && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {dbNotice}
        </p>
      )}

      {gate.allowed && dbs !== null && matching.length === 0 && !dbNotice && (
        <p className="mt-3 rounded-2xl bg-subtle px-4 py-3 text-sm text-muted">
          {cr.targetEnv} 환경에 등록된 대상 DB가 없습니다. 먼저 대상 DB를 등록해 주세요.
        </p>
      )}

      {gate.allowed && matching.length > 0 && (
        <>
          {schedule && !schedule.allowed && schedule.reason === 'FROZEN' && (
            <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
              🧊 동결 중: {schedule.freeze?.reason} ({formatKstDateTime(schedule.freeze!.endsAt, locale)}까지)
            </div>
          )}
          {schedule && !schedule.allowed && schedule.reason === 'OUT_OF_WINDOW' && (
            <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600">
              적용 작업창이 아닙니다{schedule.nextWindow
                ? ` — 다음: ${DAY_LABELS[schedule.nextWindow.dayOfWeek]} ${fmtMin(schedule.nextWindow.startMinute)}~${fmtMin(schedule.nextWindow.endMinute)}`
                : ''}
            </div>
          )}
          {schedule?.allowed && (
            <p className="mt-3 text-sm text-emerald-500">지금 적용 가능한 시간대입니다.</p>
          )}

          <div className="mt-4 space-y-2">
            <label htmlFor="apply-db" className="block text-sm font-medium text-muted">
              대상 DB ({cr.targetEnv})
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
              <option value="">선택하세요</option>
              {matching.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.host}:{d.port}/{d.database}
                </option>
              ))}
            </select>
          </div>

          {/* (B) Dry-run 미리보기 */}
          <DryRunSection
            result={dryRun}
            running={dryRunning}
            disabled={!selectedId || dryRunning}
            onRun={runDryRun}
          />

          <div className="mt-4 flex items-center justify-end gap-3">
            <button onClick={apply} disabled={!canApply} className="btn-primary px-6 py-3 text-sm">
              {busy ? '적용 중…' : '적용'}
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
          {result.status === 'SUCCESS'
            ? '적용이 완료되었습니다. 아래 적용 이력에서 상세를 확인하세요.'
            : '적용이 실패했습니다. 아래 적용 이력에서 중단 지점을 확인하세요. (상태는 유지되어 재시도 가능)'}
        </p>
      )}
    </section>
  );
}

// 적용 전 영향 미리보기(Dry-run): DML은 affectedRows, DDL은 정적 분류
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
  return (
    <div className="mt-4 rounded-2xl bg-subtle p-4 ring-1 ring-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-ink">Dry-run 미리보기</span>
          <p className="text-xs text-muted">실제로 커밋하지 않고 영향 범위만 확인합니다.</p>
        </div>
        <button
          onClick={onRun}
          disabled={disabled}
          className="focusable shrink-0 rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
        >
          {running ? '확인 중…' : 'Dry-run 실행'}
        </button>
      </div>

      {result && (
        <ul className="mt-3 space-y-2">
          {result.perFile.length === 0 && (
            <li className="text-sm text-muted">영향 분석 결과가 없습니다.</li>
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
                  {f.mode === 'DML_TX_ROLLBACK' ? 'DML(롤백측정)' : 'DDL(정적)'}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">{f.impact}</span>
                {typeof f.affectedRows === 'number' && (
                  <span className="tabular-nums text-ink">{f.affectedRows} rows</span>
                )}
                {f.destructive && (
                  <span className="font-semibold text-red-600 dark:text-red-300">파괴적</span>
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
// 적용 실행 로그/결과 — Execution + ExecutionStep 타임라인 (+ 백업 상태 / 롤백)
// ---------------------------------------------------------------------------
/** 백업이 롤백으로 데이터 복구 가능한지: 실패 백업은 불가, schema-only는 데이터 복구 불가. */
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
  if (executions === null || executions.length === 0) return null;

  const backupsById = new Map(backups.map((b) => [b.id, b]));

  return (
    <section>
      <h2 className="text-base font-semibold text-ink">적용 이력 ({executions.length})</h2>
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
  const [rollingBack, setRollingBack] = useState(false);
  const isApply = (exec.kind ?? 'APPLY') === 'APPLY';
  const restorable = isBackupRestorable(backup);
  // 롤백 노출 조건: APPLY 실행 + 복구 가능한 백업 + 권한
  const showRollback = isApply && restorable && canRollback;

  async function rollback() {
    if (!window.confirm('이 적용을 백업 기준으로 롤백할까요? 구조(DDL) 변경은 되돌리지 않습니다.')) {
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
              롤백
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

      {/* 백업 상태 (적용 실행에만) */}
      {isApply && backup && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-card px-4 py-2 text-xs">
          <BackupStatusBadge status={backup.status} />
          <span className="text-muted">
            {backup.scope === 'SCHEMA_AND_DATA' ? '스키마+데이터' : '스키마 전용'}
          </span>
          <span className="text-muted">{formatBytes(backup.sizeBytes)}</span>
          <span className={restorable ? 'text-emerald-600 dark:text-emerald-300' : 'text-muted'}>
            {restorable ? '복구 가능' : '복구 불가'}
          </span>
          {backup.note && <span className="text-amber-700 dark:text-amber-300">· {backup.note}</span>}
        </div>
      )}

      <ol className="divide-y divide-border bg-card">
        {exec.steps.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted">실행된 단계가 없습니다.</li>
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
            백업 스냅샷 기준으로 데이터를 되돌립니다. DDL 구조 변경은 수동 대응이 필요합니다.
          </p>
          <button
            onClick={rollback}
            disabled={rollingBack}
            className="focusable shrink-0 rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
          >
            {rollingBack ? '롤백 중…' : '롤백'}
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
