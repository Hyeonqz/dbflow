'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useUser } from '@/components/user-context';
import { adminListUsers, createUser, type AdminUser, type AdminUserInput, type Paginated } from '@/lib/api';
import { ROLE_LABEL, type Role } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { formatDateTime } from '@/lib/format';

const ROLE_OPTIONS: Role[] = ['DEVELOPER', 'REVIEWER', 'APPROVER', 'ADMIN'];

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

export default function UsersPage() {
  const { user, ready } = useUser();
  const [role, setRole] = useState<Role | ''>('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<AdminUser> | null>(null);
  const [error, setError] = useState('');
  const seqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback((p: number, r: Role | '', query: string) => {
    const my = ++seqRef.current;
    adminListUsers({ page: p, role: r, q: query })
      .then((res) => {
        if (my === seqRef.current) setResult(res);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (user?.role === 'ADMIN') load(page, role, debouncedQ);
  }, [page, role, debouncedQ, load, user]);

  if (!ready || !user) {
    return <p className="text-muted">불러오는 중…</p>;
  }

  if (user.role !== 'ADMIN') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">접근 불가</p>
    );
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title="사용자 관리" description="새 사용자를 등록하고 전체 역할 목록을 확인합니다." />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-base font-semibold text-ink">새 사용자 등록</h2>
        <UserForm
          onError={setError}
          onSubmit={async (values) => {
            await createUser(values);
            load(page, role, debouncedQ);
          }}
        />
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">사용자 목록</h2>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <select
            className={inputClass}
            value={role}
            onChange={(e) => {
              setPage(1);
              setRole(e.target.value as Role | '');
            }}
          >
            <option value="">전체</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="이름 또는 이메일 검색"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
        </div>

        {!error && result === null && <p className="mt-3 text-muted">불러오는 중…</p>}

        {!error && result !== null && result.items.length === 0 && (
          <div className="mt-3 rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">등록된 사용자가 없습니다.</p>
          </div>
        )}

        {result !== null && result.items.length > 0 && (
          <>
            <ul className="mt-3 space-y-3">
              {result.items.map((u) => (
                <li key={u.id} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{u.name}</p>
                      <p className="mt-1 text-sm text-muted">{u.email}</p>
                      <p className="mt-1 text-sm text-muted">{u.department}</p>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full bg-subtle px-3 py-1 text-xs font-medium text-muted">
                        {ROLE_LABEL[u.role]}
                      </span>
                      <p className="mt-1 text-xs text-muted">{formatDateTime(u.createdAt)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>
                총 {result.total}건 · {result.page}/{totalPages} 페이지
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="focusable rounded-2xl bg-card px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="focusable rounded-2xl bg-card px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
                >
                  다음
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 사용자 등록 폼
// ---------------------------------------------------------------------------
type FormValues = {
  email: string;
  name: string;
  department: string;
  role: Role;
  password: string;
};

const EMPTY_FORM: FormValues = { email: '', name: '', department: '', role: 'DEVELOPER', password: '' };

function UserForm({
  onSubmit,
  onError,
}: {
  onSubmit: (values: AdminUserInput) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const fid = useId();
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof FormValues>(key: K, val: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');

    const email = values.email.trim();
    const name = values.name.trim();
    const department = values.department.trim();

    if (!email || !name || !department) {
      onError('이메일·이름·부서는 필수입니다.');
      return;
    }
    if (values.password.length < 8) {
      onError('초기 비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setBusy(true);
    try {
      await onSubmit({ email, name, department, role: values.role, password: values.password });
      setValues(EMPTY_FORM);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-email`} className="block text-sm font-semibold">이메일</label>
          <input
            id={`${fid}-email`}
            className={inputClass}
            type="email"
            placeholder="user@example.com"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-name`} className="block text-sm font-semibold">이름</label>
          <input
            id={`${fid}-name`}
            className={inputClass}
            placeholder="홍길동"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-department`} className="block text-sm font-semibold">부서</label>
          <input
            id={`${fid}-department`}
            className={inputClass}
            placeholder="플랫폼팀"
            value={values.department}
            onChange={(e) => set('department', e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-role`} className="block text-sm font-semibold">역할</label>
          <select
            id={`${fid}-role`}
            className={inputClass}
            value={values.role}
            onChange={(e) => set('role', e.target.value as Role)}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={`${fid}-password`} className="block text-sm font-semibold">
          초기 비밀번호 <span className="ml-1 font-normal text-muted">(8자 이상)</span>
        </label>
        <input
          id={`${fid}-password`}
          className={inputClass}
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
        />
      </div>

      <button type="submit" disabled={busy} className="btn-primary px-4 py-2.5 text-sm">
        {busy ? '등록 중…' : '등록'}
      </button>
    </form>
  );
}
