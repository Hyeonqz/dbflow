'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import {
  applySchemaDiffToChangeRequest,
  listTargetDatabases,
  previewSchemaDiff,
  type DiffItem,
  type SchemaDiffPreviewResult,
  type TargetDatabase,
} from '@/lib/api';
import { DiffKindBadge } from '@/components/badges';
import { PageHeader } from '@/components/page-header';
import { AlertIcon } from '@/components/icons';

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

export default function SchemaDiffPage() {
  const t = useTranslations('schemaDiff');
  const tCommon = useTranslations('common');
  const { user, ready } = useCurrentUser();
  const router = useRouter();

  const [dbs, setDbs] = useState<TargetDatabase[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [desiredSql, setDesiredSql] = useState('');
  const [preview, setPreview] = useState<SchemaDiffPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');

  const loadDbs = useCallback(() => {
    return listTargetDatabases()
      .then(setDbs)
      .catch((err: Error) => {
        setDbs([]);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
    if (user.role === 'REVIEWER') return; // 검토자는 접근 불가
    loadDbs();
  }, [ready, user, loadDbs]);

  if (!ready || !user) {
    return <p className="text-muted">{tCommon('loading')}</p>;
  }

  if (user.role === 'REVIEWER') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">
        {t('reviewerBlocked')}
      </p>
    );
  }

  const canCreateCr = user.role === 'DEVELOPER';

  async function runPreview() {
    if (!targetId) {
      setError(t('targetDbRequired'));
      return;
    }
    if (!desiredSql.trim()) {
      setError(t('desiredSqlRequired'));
      return;
    }
    setPreviewing(true);
    setError('');
    setPreview(null);
    try {
      const result = await previewSchemaDiff({
        targetDatabaseId: targetId,
        desiredSchemaSql: desiredSql,
      });
      setPreview(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
      />

      {error && (
        <p role="alert" className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      <section className="mt-6 space-y-5 rounded-2xl bg-card p-5 ring-1 ring-border">
        <div className="space-y-2">
          <label htmlFor="target-db" className="block text-sm font-semibold">
            {t('targetDbLabel')}
          </label>
          {dbs === null ? (
            <p className="text-sm text-muted">{tCommon('loading')}</p>
          ) : dbs.length === 0 ? (
            <p className="rounded-2xl bg-subtle px-4 py-3 text-sm text-muted">
              {t('targetDbEmpty')}
              {canCreateCr && t('targetDbEmptyDevHint')}
            </p>
          ) : (
            <select
              id="target-db"
              className={inputClass}
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">{t('targetDbPlaceholder')}</option>
              {dbs.map((d) => (
                <option key={d.id} value={d.id}>
                  {t('targetDbOption', { env: d.env, name: d.name, host: d.host, port: d.port, database: d.database })}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="desired-sql" className="block text-sm font-semibold">
            {t('desiredSqlLabel')}
          </label>
          <textarea
            id="desired-sql"
            className={`${inputClass} min-h-[200px] resize-y font-mono text-sm`}
            placeholder={'CREATE TABLE users (\n  id INT NOT NULL AUTO_INCREMENT,\n  email VARCHAR(255) NOT NULL,\n  PRIMARY KEY (id),\n  UNIQUE KEY uq_users_email (email)\n);'}
            spellCheck={false}
            value={desiredSql}
            onChange={(e) => setDesiredSql(e.target.value)}
          />
          <p className="text-xs text-muted">
            {t('desiredSqlHint')}
          </p>
        </div>

        <button onClick={runPreview} disabled={previewing} className="btn-primary w-full px-4 py-3 text-sm">
          {previewing ? t('comparing') : t('previewButton')}
        </button>
      </section>

      {preview && (
        <DiffResult
          preview={preview}
          canCreateCr={canCreateCr}
          targetDatabaseId={targetId}
          desiredSchemaSql={desiredSql}
          onError={setError}
          onCreated={(id) => router.push(`/change-requests/${id}`)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Diff 결과 뷰 + 변경요청 생성
// ---------------------------------------------------------------------------
function DiffResult({
  preview,
  canCreateCr,
  targetDatabaseId,
  desiredSchemaSql,
  onError,
  onCreated,
}: {
  preview: SchemaDiffPreviewResult;
  canCreateCr: boolean;
  targetDatabaseId: string;
  desiredSchemaSql: string;
  onError: (msg: string) => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('schemaDiff');
  const { currentSnapshotSummary: snap, diff, hasChanges } = preview;
  const destructiveCount = diff.filter((d) => d.destructive).length;
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{t('resultTitle')}</h2>
        <span className="text-xs text-muted">
          {t('tableCount', { database: snap.database, count: snap.tableCount })}
        </span>
      </div>

      {!hasChanges ? (
        <div className="mt-3 rounded-2xl bg-card px-6 py-10 text-center ring-1 ring-border">
          <p className="text-muted">{t('noChanges')}</p>
        </div>
      ) : (
        <>
          {destructiveCount > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/15 dark:text-red-300">
              <AlertIcon className="mt-0.5 shrink-0" width={18} height={18} />
              <span>{t('destructiveWarning', { count: destructiveCount })}</span>
            </p>
          )}

          <ul className="mt-3 space-y-3">
            {diff.map((item, idx) => (
              <DiffCard key={idx} item={item} />
            ))}
          </ul>

          {canCreateCr && !showForm && (
            <button onClick={() => setShowForm(true)} className="btn-primary mt-5 w-full px-4 py-3 text-sm">
              {t('createCrButton')}
            </button>
          )}

          {canCreateCr && showForm && (
            <CreateCrForm
              targetDatabaseId={targetDatabaseId}
              desiredSchemaSql={desiredSchemaSql}
              onCancel={() => setShowForm(false)}
              onError={onError}
              onCreated={onCreated}
            />
          )}
        </>
      )}
    </section>
  );
}

function DiffCard({ item }: { item: DiffItem }) {
  const t = useTranslations('schemaDiff');
  return (
    <li
      className={`overflow-hidden rounded-2xl ring-1 ${
        item.destructive ? 'ring-red-200 dark:ring-red-500/30' : 'ring-border'
      }`}
    >
      <div className="flex items-center justify-between gap-3 bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <DiffKindBadge kind={item.kind} />
          <span className="font-mono text-sm text-ink">{item.table}</span>
        </div>
        {item.destructive && (
          <span className="text-xs font-semibold text-red-600 dark:text-red-300">{t('destructiveBadge')}</span>
        )}
      </div>
      <pre className="overflow-x-auto bg-code px-4 py-3 text-xs leading-relaxed text-code-fg">
        <code>{item.statement}</code>
      </pre>
    </li>
  );
}

function CreateCrForm({
  targetDatabaseId,
  desiredSchemaSql,
  onCancel,
  onError,
  onCreated,
}: {
  targetDatabaseId: string;
  desiredSchemaSql: string;
  onCancel: () => void;
  onError: (msg: string) => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('schemaDiff');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    const titleValue = title.trim();
    const descriptionValue = description.trim();
    if (!titleValue) {
      onError(t('titleRequired'));
      return;
    }
    if (!descriptionValue) {
      onError(t('descriptionRequired'));
      return;
    }
    setBusy(true);
    try {
      const cr = await applySchemaDiffToChangeRequest({
        targetDatabaseId,
        desiredSchemaSql,
        title: titleValue,
        description: descriptionValue,
      });
      onCreated(cr.id);
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4 rounded-2xl bg-card p-5 ring-1 ring-border">
      <h3 className="text-sm font-semibold">{t('createCrHeading')}</h3>
      <div className="space-y-2">
        <label htmlFor="cr-title" className="block text-sm font-medium text-muted">
          {t('titleLabel')}
        </label>
        <input
          id="cr-title"
          className={inputClass}
          placeholder={t('titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="cr-desc" className="block text-sm font-medium text-muted">
          {t('descriptionLabel')}
        </label>
        <textarea
          id="cr-desc"
          className={`${inputClass} min-h-[88px] resize-y`}
          placeholder={t('descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="btn-primary flex-1 px-4 py-2.5 text-sm">
          {busy ? t('creating') : t('createSubmit')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="focusable rounded-2xl bg-card px-4 py-2.5 text-sm font-semibold text-muted ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
