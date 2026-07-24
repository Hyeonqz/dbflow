'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import {
  createChangeRequest,
  listApprovalPolicy,
  listUsersByRole,
  type SqlType,
  type TargetEnv,
  type UserSummary,
} from '@/lib/api';
import { PageHeader } from '@/components/page-header';

type DraftFile = {
  key: string; // React 리스트 안정 키 (서버로 전송하지 않음)
  filename: string;
  sqlType: SqlType;
  content: string;
};

const ENV_OPTIONS: TargetEnv[] = ['DEV', 'STAGING', 'PROD'];
const SQL_TYPE_OPTIONS: SqlType[] = ['DDL', 'DML'];

const inputClass =
  'w-full rounded-2xl bg-card px-4 py-3 outline-none ring-1 ring-border-strong focus:ring-primary';

function newDraftFile(): DraftFile {
  return {
    key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    filename: '',
    sqlType: 'DDL',
    content: '',
  };
}

export default function NewChangeRequestPage() {
  const router = useRouter();
  const t = useTranslations('changeRequests');
  const tEnum = useTranslations('enum');
  const tCommon = useTranslations('common');
  const { user, ready } = useCurrentUser();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetEnv, setTargetEnv] = useState<TargetEnv>('DEV');
  const [files, setFiles] = useState<DraftFile[]>([newDraftFile()]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [reviewers, setReviewers] = useState<UserSummary[]>([]);
  const [approvers, setApprovers] = useState<UserSummary[]>([]);
  const [reviewerId, setReviewerId] = useState('');
  const [requiredApprovals, setRequiredApprovals] = useState(1);
  const [approverIds, setApproverIds] = useState<string[]>(['']);

  useEffect(() => {
    listUsersByRole('REVIEWER').then(setReviewers).catch(() => setReviewers([]));
    listUsersByRole('APPROVER').then(setApprovers).catch(() => setApprovers([]));
  }, []);

  // 대상 환경이 바뀔 때마다 해당 환경의 필수 결재자 수(N)를 조회해 셀렉트 개수를 맞춘다.
  useEffect(() => {
    let active = true;
    listApprovalPolicy()
      .then((rows) => {
        if (!active) return;
        const n = rows.find((r) => r.env === targetEnv)?.requiredApprovals ?? 1;
        setRequiredApprovals(n);
        setApproverIds((prev) => {
          const next = prev.slice(0, n);
          while (next.length < n) next.push('');
          return next;
        });
      })
      .catch(() => setRequiredApprovals(1));
    return () => {
      active = false;
    };
  }, [targetEnv]);

  function updateApproverId(idx: number, value: string) {
    setApproverIds((prev) => prev.map((id, i) => (i === idx ? value : id)));
  }

  if (!ready || !user) {
    return <p className="text-muted">{tCommon('loading')}</p>;
  }

  if (user.role !== 'DEVELOPER') {
    return (
      <p className="rounded-2xl bg-card px-6 py-5 ring-1 ring-border text-muted">
        {t('developerOnly')}
      </p>
    );
  }

  function updateFile(key: string, patch: Partial<DraftFile>) {
    setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  function addFile() {
    setFiles((prev) => [...prev, newDraftFile()]);
  }

  function removeFile(key: string) {
    setFiles((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError(t('titleRequired'));
      return;
    }

    const preparedFiles = files
      .map((f) => ({
        filename: f.filename.trim(),
        sqlType: f.sqlType,
        content: f.content.trim(),
      }))
      .filter((f) => f.filename || f.content);

    if (preparedFiles.length === 0) {
      setError(t('atLeastOneFile'));
      return;
    }
    const incomplete = preparedFiles.find((f) => !f.filename || !f.content);
    if (incomplete) {
      setError(t('fileFieldsRequired'));
      return;
    }

    if (!reviewerId || approverIds.some((id) => !id)) {
      setError(t('assigneesRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const created = await createChangeRequest({
        title: trimmedTitle,
        description: description.trim(),
        targetEnv,
        files: preparedFiles,
        reviewerId,
        approverIds,
      });
      router.push(`/change-requests/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('newTitle')}
        description={t('newDescription')}
      />

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        <div className="space-y-2">
          <label htmlFor="title" className="block text-sm font-semibold">
            {t('titleLabel')}
          </label>
          <input
            id="title"
            className={inputClass}
            placeholder={t('titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="description" className="block text-sm font-semibold">
            {t('descriptionLabel')} <span className="font-normal text-muted">{t('optionalLabel')}</span>
          </label>
          <textarea
            id="description"
            className={`${inputClass} min-h-[88px] resize-y`}
            placeholder={t('descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="targetEnv" className="block text-sm font-semibold">
            {t('targetEnvLabel')}
          </label>
          <select
            id="targetEnv"
            className={inputClass}
            value={targetEnv}
            onChange={(e) => setTargetEnv(e.target.value as TargetEnv)}
          >
            {ENV_OPTIONS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="reviewerId" className="block text-sm font-semibold">
              {t('reviewerLabel')}
            </label>
            <select
              id="reviewerId"
              className={inputClass}
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
            >
              <option value="">{t('selectPlaceholder')}</option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.department})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-semibold">
              {t('approverLabel')} {requiredApprovals > 1 && t('approverCount', { count: requiredApprovals })}
            </span>
            <div className="space-y-2">
              {approverIds.map((selectedId, idx) => (
                <select
                  key={idx}
                  aria-label={t('approverAriaLabel', { n: idx + 1 })}
                  className={inputClass}
                  value={selectedId}
                  onChange={(e) => updateApproverId(idx, e.target.value)}
                >
                  <option value="">{t('selectPlaceholder')}</option>
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
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{t('sqlFilesLabel')}</span>
            <button
              type="button"
              onClick={addFile}
              className="focusable rounded-full bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border-strong transition-colors hover:bg-subtle"
            >
              {t('addFile')}
            </button>
          </div>

          {files.map((file, idx) => (
            <fieldset key={file.key} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium text-muted">{t('fileNumber', { n: idx + 1 })}</legend>
                {files.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeFile(file.key)}
                    className="focusable rounded-lg px-1 text-sm text-muted transition-colors hover:text-red-500 dark:hover:text-red-400"
                  >
                    {tCommon('delete')}
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  aria-label={t('fileNameAriaLabel', { n: idx + 1 })}
                  className={`${inputClass} sm:flex-1`}
                  placeholder={t('fileNamePlaceholder')}
                  value={file.filename}
                  onChange={(e) => updateFile(file.key, { filename: e.target.value })}
                />
                <select
                  aria-label={t('sqlTypeAriaLabel', { n: idx + 1 })}
                  className={`${inputClass} sm:w-56`}
                  value={file.sqlType}
                  onChange={(e) => updateFile(file.key, { sqlType: e.target.value as SqlType })}
                >
                  {SQL_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {tEnum(`sqlType.${opt}`)}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                aria-label={t('sqlContentAriaLabel', { n: idx + 1 })}
                className={`${inputClass} mt-3 min-h-[140px] resize-y font-mono text-sm`}
                placeholder={t('sqlContentPlaceholder')}
                spellCheck={false}
                value={file.content}
                onChange={(e) => updateFile(file.key, { content: e.target.value })}
              />
            </fieldset>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-500 dark:text-red-400">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn-primary w-full px-4 py-3">
          {submitting ? t('saving') : t('createSubmit')}
        </button>
      </form>
    </>
  );
}
