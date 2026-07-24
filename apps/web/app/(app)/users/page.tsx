'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { useUser } from '@/components/user-context';
import { adminListUsers, createUser, type AdminUser, type AdminUserInput, type Paginated } from '@/lib/api';
import { type Role } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { formatDateTime } from '@/lib/format';

const ROLE_OPTIONS: Role[] = ['DEVELOPER', 'REVIEWER', 'APPROVER', 'ADMIN'];

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

export default function UsersPage() {
  const t = useTranslations('users');
  const tEnum = useTranslations('enum');
  const locale = useLocale() as Locale;
  const { user, ready } = useUser();
  const [role, setRole] = useState<Role | ''>('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<AdminUser> | null>(null);
  const [error, setError] = useState('');
  const seqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
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
    return <p className="text-muted">{t('loading')}</p>;
  }

  if (user.role !== 'ADMIN') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">{t('accessDenied')}</p>
    );
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-base font-semibold text-ink">{t('registerHeading')}</h2>
        <UserForm
          onError={setError}
          onSubmit={async (values) => {
            await createUser(values);
            load(page, role, debouncedQ);
          }}
        />
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">{t('listHeading')}</h2>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <select
            className={inputClass}
            aria-label={t('roleLabel')}
            value={role}
            onChange={(e) => {
              setPage(1);
              setRole(e.target.value as Role | '');
            }}
          >
            <option value="">{t('all')}</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {tEnum.has(`role.${r}`) ? tEnum(`role.${r as Role}`) : r}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            aria-label={t('searchAriaLabel')}
            placeholder={t('searchPlaceholder')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </div>

        {!error && result === null && <p className="mt-3 text-muted">{t('loading')}</p>}

        {!error && result !== null && result.items.length === 0 && (
          <div className="mt-3 rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">{t('emptyList')}</p>
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
                        {tEnum.has(`role.${u.role}`) ? tEnum(`role.${u.role as Role}`) : u.role}
                      </span>
                      <p className="mt-1 text-xs text-muted">{formatDateTime(u.createdAt, locale)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>
                {t('paginationSummary', { total: result.total, page: result.page, totalPages })}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="focusable rounded-2xl bg-card px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
                >
                  {t('prevPage')}
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="focusable rounded-2xl bg-card px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
                >
                  {t('nextPage')}
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
  const t = useTranslations('users');
  const tEnum = useTranslations('enum');
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
      onError(t('validationRequired'));
      return;
    }
    if (values.password.length < 8) {
      onError(t('validationPassword'));
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
          <label htmlFor={`${fid}-email`} className="block text-sm font-semibold">{t('emailLabel')}</label>
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
          <label htmlFor={`${fid}-name`} className="block text-sm font-semibold">{t('nameLabel')}</label>
          <input
            id={`${fid}-name`}
            className={inputClass}
            placeholder={t('namePlaceholder')}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-department`} className="block text-sm font-semibold">{t('departmentLabel')}</label>
          <input
            id={`${fid}-department`}
            className={inputClass}
            placeholder={t('departmentPlaceholder')}
            value={values.department}
            onChange={(e) => set('department', e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-role`} className="block text-sm font-semibold">{t('roleLabel')}</label>
          <select
            id={`${fid}-role`}
            className={inputClass}
            value={values.role}
            onChange={(e) => set('role', e.target.value as Role)}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {tEnum.has(`role.${role}`) ? tEnum(`role.${role as Role}`) : role}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={`${fid}-password`} className="block text-sm font-semibold">
          {t('passwordLabel')} <span className="ml-1 font-normal text-muted">{t('passwordHint')}</span>
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
        {busy ? t('registering') : t('register')}
      </button>
    </form>
  );
}
