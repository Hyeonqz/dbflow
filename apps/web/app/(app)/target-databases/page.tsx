'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import {
  createTargetDatabase,
  deleteTargetDatabase,
  listTargetDatabases,
  testTargetDatabaseConnection,
  updateTargetDatabase,
  type CreateTargetDatabaseInput,
  type DbType,
  type TargetDatabase,
  type TargetEnv,
  type TestConnectionResult,
  type UpdateTargetDatabaseInput,
} from '@/lib/api';
import { EnvBadge } from '@/components/badges';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/page-header';

const ENV_OPTIONS: TargetEnv[] = ['DEV', 'STAGING', 'PROD'];
const DB_TYPE_OPTIONS: DbType[] = ['MYSQL', 'POSTGRES', 'MARIADB', 'ORACLE'];

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

export default function TargetDatabasesPage() {
  const t = useTranslations('targetDatabases');
  const tCommon = useTranslations('common');
  const { user, ready } = useCurrentUser();
  const [items, setItems] = useState<TargetDatabase[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    return listTargetDatabases()
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  if (!ready || !user) {
    return <p className="text-muted">{tCommon('loading')}</p>;
  }

  if (user.role !== 'APPROVER') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">
        {t('approverOnly')}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          !creating && (
            <button onClick={() => setCreating(true)} className="btn-primary px-4 py-2.5 text-sm">
              {t('newButton')}
            </button>
          )
        }
      />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      {creating && (
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
          <h2 className="text-base font-semibold text-ink">{t('createHeading')}</h2>
          <TargetDatabaseForm
            mode="create"
            submitLabel={t('register')}
            onCancel={() => setCreating(false)}
            onError={setError}
            onSubmit={async (values) => {
              await createTargetDatabase(values as CreateTargetDatabaseInput);
              setCreating(false);
              await load();
            }}
          />
        </section>
      )}

      <section>
        {!error && items === null && <p className="text-muted">{tCommon('loading')}</p>}

        {!error && items !== null && items.length === 0 && !creating && (
          <div className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">{t('emptyList')}</p>
          </div>
        )}

        <ul className="space-y-3">
          {items?.map((db) => (
            <li key={db.id}>
              <TargetDatabaseCard db={db} onError={setError} onChanged={load} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 개별 대상 DB 카드 — 연결 테스트 / 수정 / 삭제
// ---------------------------------------------------------------------------
function TargetDatabaseCard({
  db,
  onError,
  onChanged,
}: {
  db: TargetDatabase;
  onError: (msg: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('targetDatabases');
  const tCommon = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    onError('');
    try {
      setTestResult(await testTargetDatabaseConnection(db.id));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('deleteConfirm', { name: db.name }))) return;
    setDeleting(true);
    onError('');
    try {
      await deleteTargetDatabase(db.id);
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-2xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-base font-semibold text-ink">{t('editHeading')}</h2>
        <TargetDatabaseForm
          mode="edit"
          initial={db}
          submitLabel={tCommon('save')}
          onCancel={() => setEditing(false)}
          onError={onError}
          onSubmit={async (values) => {
            await updateTargetDatabase(db.id, values);
            setEditing(false);
            await onChanged();
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-ink">{db.name}</h2>
            <EnvBadge env={db.env} />
            <span className="text-xs font-medium text-muted">{db.dbType}</span>
          </div>
          <p className="mt-2 font-mono text-sm text-muted">
            {db.username}@{db.host}:{db.port}/{db.database}
          </p>
          <p className="mt-1 text-xs text-muted">{t('updatedAtLabel', { date: formatDateTime(db.updatedAt) })}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={runTest} disabled={testing} className="btn-primary px-4 py-2 text-sm">
          {testing ? t('testing') : t('testConnection')}
        </button>
        <button
          onClick={() => setEditing(true)}
          className="focusable rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle"
        >
          {t('edit')}
        </button>
        <button
          onClick={remove}
          disabled={deleting}
          className="focusable rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
        >
          {deleting ? t('deleting') : tCommon('delete')}
        </button>
      </div>

      {testResult && (
        <p
          className={`mt-3 rounded-2xl px-4 py-3 text-sm ${
            testResult.success
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300'
          }`}
        >
          {testResult.success
            ? t('testSuccess', { dbType: db.dbType, version: testResult.serverVersion, latencyMs: testResult.latencyMs })
            : t('testFailure', { error: testResult.error })}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 등록/수정 공용 폼 — 비밀번호는 쓰기 전용(응답에 없음)
// ---------------------------------------------------------------------------
type FormValues = {
  name: string;
  env: TargetEnv;
  dbType: DbType;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
};

function TargetDatabaseForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onError,
}: {
  mode: 'create' | 'edit';
  initial?: TargetDatabase;
  submitLabel: string;
  onSubmit: (values: CreateTargetDatabaseInput | UpdateTargetDatabaseInput) => Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('targetDatabases');
  const tCommon = useTranslations('common');
  const fid = useId(); // 폼 인스턴스별 고유 id 접두사(등록/수정 동시 렌더 시 id 충돌 방지)
  const [values, setValues] = useState<FormValues>({
    name: initial?.name ?? '',
    env: initial?.env ?? 'DEV',
    dbType: initial?.dbType ?? 'MYSQL',
    host: initial?.host ?? '',
    port: initial ? String(initial.port) : '3306',
    username: initial?.username ?? '',
    password: '',
    database: initial?.database ?? '',
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof FormValues>(key: K, val: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');

    const name = values.name.trim();
    const host = values.host.trim();
    const username = values.username.trim();
    const database = values.database.trim();
    const port = Number(values.port);

    if (!name || !host || !username || !database) {
      onError(t('validationRequired'));
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      onError(t('validationPort'));
      return;
    }
    if (mode === 'create' && !values.password) {
      onError(t('validationPassword'));
      return;
    }

    setBusy(true);
    try {
      if (mode === 'create') {
        await onSubmit({
          name,
          env: values.env,
          dbType: values.dbType,
          host,
          port,
          username,
          password: values.password,
          database,
        });
      } else {
        // 수정: 비밀번호는 입력했을 때만 전송(미입력 시 기존 유지)
        const patch: UpdateTargetDatabaseInput = {
          name,
          env: values.env,
          dbType: values.dbType,
          host,
          port,
          username,
          database,
        };
        if (values.password) patch.password = values.password;
        await onSubmit(patch);
      }
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div className="space-y-2">
        <label htmlFor={`${fid}-name`} className="block text-sm font-semibold">{t('nameLabel')}</label>
        <input
          id={`${fid}-name`}
          className={inputClass}
          placeholder={t('namePlaceholder')}
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-env`} className="block text-sm font-semibold">{t('envLabel')}</label>
          <select
            id={`${fid}-env`}
            className={inputClass}
            value={values.env}
            onChange={(e) => set('env', e.target.value as TargetEnv)}
          >
            {ENV_OPTIONS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-dbType`} className="block text-sm font-semibold">{t('dbTypeLabel')}</label>
          <select
            id={`${fid}-dbType`}
            className={inputClass}
            value={values.dbType}
            onChange={(e) => set('dbType', e.target.value as DbType)}
          >
            {DB_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="space-y-2 sm:flex-1">
          <label htmlFor={`${fid}-host`} className="block text-sm font-semibold">{t('hostLabel')}</label>
          <input
            id={`${fid}-host`}
            className={inputClass}
            placeholder="db.prod.internal"
            value={values.host}
            onChange={(e) => set('host', e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:w-40">
          <label htmlFor={`${fid}-port`} className="block text-sm font-semibold">{t('portLabel')}</label>
          <input
            id={`${fid}-port`}
            className={`${inputClass} tabular-nums`}
            inputMode="numeric"
            placeholder="3306"
            value={values.port}
            onChange={(e) => set('port', e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-username`} className="block text-sm font-semibold">{t('usernameLabel')}</label>
          <input
            id={`${fid}-username`}
            className={inputClass}
            placeholder="app"
            value={values.username}
            onChange={(e) => set('username', e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-2">
          <label htmlFor={`${fid}-database`} className="block text-sm font-semibold">{t('databaseLabel')}</label>
          <input
            id={`${fid}-database`}
            className={inputClass}
            placeholder="service"
            value={values.database}
            onChange={(e) => set('database', e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={`${fid}-password`} className="block text-sm font-semibold">
          {t('passwordLabel')}
          {mode === 'edit' && (
            <span className="ml-1 font-normal text-muted">{t('passwordEditHint')}</span>
          )}
        </label>
        <input
          id={`${fid}-password`}
          className={inputClass}
          type="password"
          autoComplete="new-password"
          placeholder={mode === 'edit' ? '••••••••' : t('passwordLabel')}
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="btn-primary flex-1 px-4 py-2.5 text-sm">
          {busy ? t('saving') : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="focusable rounded-2xl bg-card px-4 py-2.5 text-sm font-semibold text-muted ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
        >
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}
