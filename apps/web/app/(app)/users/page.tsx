'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useUser } from '@/components/user-context';
import { createUser, listUsersByRole, type AdminUserInput, type UserSummary } from '@/lib/api';
import { ROLE_LABEL, type Role } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';

const ROLE_OPTIONS: Role[] = ['DEVELOPER', 'REVIEWER', 'APPROVER', 'ADMIN'];
// 목록용 조회 대상. api의 listUsersByRole은 REVIEWER/APPROVER만 지원한다.
// ponytail: DEVELOPER/ADMIN 목록까지 필요해지면 api 시그니처를 넓히고 여기 추가.
const LISTABLE_ROLES: Array<'REVIEWER' | 'APPROVER'> = ['REVIEWER', 'APPROVER'];

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

type ListedUser = UserSummary & { role: 'REVIEWER' | 'APPROVER' };

export default function UsersPage() {
  const { user, ready } = useUser();
  const [items, setItems] = useState<ListedUser[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return Promise.all(LISTABLE_ROLES.map((role) => listUsersByRole(role).then((users) => users.map((u) => ({ ...u, role })))))
      .then((groups) => setItems(groups.flat()))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!ready || user?.role !== 'ADMIN') return;
    load();
  }, [ready, user, load]);

  if (!ready || !user) {
    return <p className="text-muted">불러오는 중…</p>;
  }

  if (user.role !== 'ADMIN') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">접근 불가</p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="사용자 관리" description="새 사용자를 등록하고 역할별 목록을 확인합니다." />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-base font-semibold text-ink">새 사용자 등록</h2>
        <UserForm
          onError={setError}
          onSubmit={async (values) => {
            await createUser(values);
            await load();
          }}
        />
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">사용자 목록</h2>

        {!error && items === null && <p className="mt-3 text-muted">불러오는 중…</p>}

        {!error && items !== null && items.length === 0 && (
          <div className="mt-3 rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">등록된 사용자가 없습니다.</p>
          </div>
        )}

        <ul className="mt-3 space-y-3">
          {items?.map((u) => (
            <li key={`${u.role}-${u.id}`} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{u.name}</p>
                  <p className="mt-1 text-sm text-muted">{u.department}</p>
                </div>
                <span className="rounded-full bg-subtle px-3 py-1 text-xs font-medium text-muted">
                  {ROLE_LABEL[u.role]}
                </span>
              </div>
            </li>
          ))}
        </ul>
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
