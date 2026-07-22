'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useUser } from '@/components/user-context';
import type { User } from '@/lib/auth';
import {
  createDelegation,
  deleteDelegation,
  listDelegations,
  listUsersByRole,
  type DelegationRow,
  type UserSummary,
} from '@/lib/api';
import { PageHeader } from '@/components/page-header';

const ACCESS_ROLES = ['REVIEWER', 'APPROVER', 'ADMIN'];

const inputClass =
  'w-full rounded-2xl bg-card px-3 py-2 text-sm outline-none ring-1 ring-border-strong focus:ring-primary';

/** ISO 문자열을 KST(Asia/Seoul) 고정 표시로 포맷(서버 타임존과 무관하게 일관 표시). */
function fmtKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default function DelegationsPage() {
  const { user, ready } = useUser();
  const [rows, setRows] = useState<DelegationRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return listDelegations()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!ready || !user || !ACCESS_ROLES.includes(user.role)) return;
    load();
  }, [ready, user, load]);

  if (!ready || !user) {
    return <p className="text-muted">불러오는 중…</p>;
  }

  if (!ACCESS_ROLES.includes(user.role)) {
    return <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">접근 불가</p>;
  }

  async function remove(id: string) {
    setError('');
    try {
      await deleteDelegation(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="부재 위임"
        description="휴가·부재 시 검토·결재 권한을 지정 기간 동안 다른 사용자에게 위임합니다."
      />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      {!error && rows === null && <p className="text-muted">불러오는 중…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="rounded-2xl bg-card px-6 py-8 text-center ring-1 ring-border">
          <p className="text-muted">등록된 위임이 없습니다.</p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-semibold text-muted">
                <th className="px-4 py-3">위임자</th>
                <th className="px-4 py-3">대리인</th>
                <th className="px-4 py-3">기간(KST)</th>
                <th className="px-4 py-3">사유</th>
                <th className="px-4 py-3">등록자</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="bg-card">
                  <td className="px-4 py-3 text-ink">{r.delegator.name ?? '-'}</td>
                  <td className="px-4 py-3 text-ink">{r.delegate.name ?? '-'}</td>
                  <td className="px-4 py-3 tabular-nums text-ink">{fmtKst(r.startsAt)} ~ {fmtKst(r.endsAt)}</td>
                  <td className="px-4 py-3 text-muted">{r.reason ?? '-'}</td>
                  <td className="px-4 py-3 text-muted">{r.createdBy?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      className="focusable rounded-2xl bg-card px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
                    >
                      해제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DelegationForm user={user} onError={setError} onChanged={load} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 등록 폼 — 비-ADMIN은 대리인만 선택(자기 역할, self 강제), ADMIN은 위임자도 선택
// ---------------------------------------------------------------------------
function DelegationForm({
  user,
  onError,
  onChanged,
}: {
  user: User;
  onError: (msg: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const fid = useId();
  const isAdmin = user.role === 'ADMIN';
  const [reviewers, setReviewers] = useState<UserSummary[]>([]); // ADMIN 전용: 검토자 전체
  const [approvers, setApprovers] = useState<UserSummary[]>([]); // ADMIN 전용: 결재자 전체
  const [peers, setPeers] = useState<UserSummary[]>([]); // 비-ADMIN: 같은 역할 사용자(자기 제외)
  const [delegatorId, setDelegatorId] = useState('');
  const [delegateId, setDelegateId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      Promise.all([listUsersByRole('REVIEWER'), listUsersByRole('APPROVER')])
        .then(([r, a]) => {
          setReviewers(r);
          setApprovers(a);
        })
        .catch((err: Error) => onError(err.message));
    } else {
      // 이 분기는 REVIEWER/APPROVER만 도달하므로 캐스트 안전
      listUsersByRole(user.role as 'REVIEWER' | 'APPROVER')
        .then((list) => setPeers(list.filter((u) => u.id !== user.id)))
        .catch((err: Error) => onError(err.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user.role, user.id]);

  const delegators = [...reviewers, ...approvers];
  // ADMIN: 선택된 위임자와 같은 역할 후보만(자기 제외). 비-ADMIN: 미리 로드된 동료 목록.
  const delegateCandidates = isAdmin
    ? (reviewers.some((u) => u.id === delegatorId) ? reviewers : approvers).filter((u) => u.id !== delegatorId)
    : peers;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    if (!delegateId || !startsAt || !endsAt) {
      onError('대리인과 시작·종료 일시는 필수입니다.');
      return;
    }
    if (isAdmin && !delegatorId) {
      onError('위임자를 선택하세요.');
      return;
    }
    setBusy(true);
    try {
      await createDelegation({
        ...(isAdmin ? { delegatorId } : {}),
        delegateId,
        startsAt,
        endsAt,
        reason: reason.trim() || undefined,
      });
      setDelegatorId('');
      setDelegateId('');
      setStartsAt('');
      setEndsAt('');
      setReason('');
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:items-end ${isAdmin ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
        {isAdmin && (
          <div>
            <label htmlFor={`${fid}-delegator`} className="mb-1 block text-xs font-semibold text-muted">위임자</label>
            <select
              id={`${fid}-delegator`}
              className={inputClass}
              value={delegatorId}
              onChange={(e) => {
                setDelegatorId(e.target.value);
                setDelegateId('');
              }}
            >
              <option value="">선택</option>
              {delegators.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.department})</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${fid}-delegate`} className="mb-1 block text-xs font-semibold text-muted">대리인</label>
          <select
            id={`${fid}-delegate`}
            className={inputClass}
            value={delegateId}
            onChange={(e) => setDelegateId(e.target.value)}
            disabled={isAdmin && !delegatorId}
          >
            <option value="">선택</option>
            {delegateCandidates.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.department})</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fid}-starts`} className="mb-1 block text-xs font-semibold text-muted">시작</label>
          <input id={`${fid}-starts`} type="datetime-local" className={inputClass} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${fid}-ends`} className="mb-1 block text-xs font-semibold text-muted">종료</label>
          <input id={`${fid}-ends`} type="datetime-local" className={inputClass} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${fid}-reason`} className="mb-1 block text-xs font-semibold text-muted">사유</label>
          <input id={`${fid}-reason`} className={inputClass} placeholder="예: 연차" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? '등록 중…' : '위임 등록'}
        </button>
      </div>
    </form>
  );
}
