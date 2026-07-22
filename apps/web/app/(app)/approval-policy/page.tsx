'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/components/user-context';
import { listApprovalPolicy, updateApprovalPolicy, type ApprovalPolicyRow } from '@/lib/api';
import { PageHeader } from '@/components/page-header';

const REQUIRED_OPTIONS = [1, 2, 3, 4, 5];

const inputClass =
  'rounded-2xl bg-card px-2 py-1.5 text-xs font-semibold outline-none ring-1 ring-border-strong focus:ring-primary';

export default function ApprovalPolicyPage() {
  const { user, ready } = useUser();
  const [rows, setRows] = useState<ApprovalPolicyRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return listApprovalPolicy()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!ready || user?.role !== 'ADMIN') return;
    load();
  }, [ready, user, load]);

  async function changeRequiredApprovals(env: ApprovalPolicyRow['env'], requiredApprovals: number) {
    if (!rows) return;
    setError('');
    const prev = rows;
    // 낙관적 업데이트: 즉시 반영 후 실패 시 되돌림
    setRows((curr) => curr!.map((r) => (r.env === env ? { ...r, requiredApprovals } : r)));
    try {
      await updateApprovalPolicy(env, requiredApprovals);
    } catch (err) {
      setRows(prev);
      setError((err as Error).message);
    }
  }

  if (!ready || !user) {
    return <p className="text-muted">불러오는 중…</p>;
  }

  if (user.role !== 'ADMIN') {
    return <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">접근 불가</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="결재 정책"
        description="환경별로 최종 결재에 필요한 결재자 수를 조정합니다."
      />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      <section>
        {!error && rows === null && <p className="text-muted">불러오는 중…</p>}

        {rows !== null && rows.length === 0 && (
          <div className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">등록된 정책이 없습니다.</p>
          </div>
        )}

        {rows !== null && rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
            <table className="w-full min-w-[420px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold text-muted">
                  <th className="px-4 py-3">환경</th>
                  <th className="px-4 py-3">필요 결재자 수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.env} className="bg-card">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{row.env}</td>
                    <td className="px-4 py-3">
                      <select
                        className={inputClass}
                        value={row.requiredApprovals}
                        onChange={(e) => changeRequiredApprovals(row.env, Number(e.target.value))}
                      >
                        {REQUIRED_OPTIONS.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
