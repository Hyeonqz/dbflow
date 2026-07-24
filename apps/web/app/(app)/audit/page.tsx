'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useUser } from '@/components/user-context';
import { downloadAuditExport, listAuditLogs, type AuditLogRow, type AuditQuery } from '@/lib/api';
import type { Role } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { formatDateTime } from '@/lib/format';

// apps/api/prisma/schema.prisma의 AuditAction/AuditTargetType 열거값과 동일하게 유지(서버가 엄격히 검증).
const ACTION_OPTIONS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCESS_DENIED', 'USER_CREATED', 'USER_PROFILE_UPDATED',
  'CR_CREATED', 'CR_SUBMITTED', 'CR_REVIEWED', 'CR_APPROVED', 'CR_ASSIGNEES_CHANGED',
  'CR_APPLIED', 'CR_ROLLED_BACK', 'TARGET_DB_CREATED', 'TARGET_DB_UPDATED', 'TARGET_DB_DELETED',
  'SQL_POLICY_UPDATED', 'APPROVAL_POLICY_UPDATED', 'APPLY_WINDOW_UPDATED', 'FREEZE_UPDATED', 'DELEGATION_UPDATED',
];
const TARGET_TYPE_OPTIONS = ['CHANGE_REQUEST', 'USER', 'TARGET_DATABASE', 'EXECUTION', 'AUTH', 'SQL_REVIEW_POLICY', 'APPROVAL_POLICY', 'APPLY_SCHEDULE', 'DELEGATION'];

const inputClass =
  'w-full rounded-2xl bg-card px-3 py-2 text-sm outline-none ring-1 ring-border-strong focus:ring-primary';

type Filters = { actor: string; action: string; targetType: string; outcome: string; from: string; to: string };
const EMPTY_FILTERS: Filters = { actor: '', action: '', targetType: '', outcome: '', from: '', to: '' };

/** 날짜 input(YYYY-MM-DD)을 하루 경계 ISO로 변환(from=시작, to=끝). 서버는 gte/lte 포함 범위로 처리. */
function toIsoRange(date: string, edge: 'start' | 'end'): string | undefined {
  if (!date) return undefined;
  return `${date}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`;
}

export default function AuditPage() {
  const t = useTranslations('audit');
  const tCommon = useTranslations('common');
  const { user, ready } = useUser();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: AuditLogRow[]; total: number; page: number; pageSize: number } | null>(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  const query: AuditQuery = {
    actor: applied.actor.trim() || undefined,
    action: applied.action || undefined,
    targetType: applied.targetType || undefined,
    outcome: applied.outcome || undefined,
    from: toIsoRange(applied.from, 'start'),
    to: toIsoRange(applied.to, 'end'),
    page,
  };
  const queryKey = JSON.stringify(query);

  const load = useCallback(() => {
    listAuditLogs(query)
      .then(setResult)
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  useEffect(() => {
    if (!ready || user?.role !== 'ADMIN') return;
    load();
  }, [ready, user, load]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setApplied(draft);
  }

  async function runExport(format: 'csv' | 'json') {
    setExporting(format);
    setError('');
    try {
      await downloadAuditExport(
        {
          actor: applied.actor.trim() || undefined,
          action: applied.action || undefined,
          targetType: applied.targetType || undefined,
          outcome: applied.outcome || undefined,
          from: toIsoRange(applied.from, 'start'),
          to: toIsoRange(applied.to, 'end'),
        },
        format,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(null);
    }
  }

  if (!ready || !user) {
    return <p className="text-muted">{tCommon('loading')}</p>;
  }

  if (user.role !== 'ADMIN') {
    return <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">{t('accessDenied')}</p>;
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => runExport('csv')}
              disabled={exporting !== null}
              className="focusable rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
            >
              {exporting === 'csv' ? t('exporting') : t('exportCsv')}
            </button>
            <button
              type="button"
              onClick={() => runExport('json')}
              disabled={exporting !== null}
              className="focusable rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle disabled:opacity-50"
            >
              {exporting === 'json' ? t('exporting') : t('exportJson')}
            </button>
          </div>
        }
      />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      <form onSubmit={applyFilters} className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-muted">{t('actorLabel')}</label>
            <input
              className={inputClass}
              placeholder={t('actorPlaceholder')}
              value={draft.actor}
              onChange={(e) => setDraft((f) => ({ ...f, actor: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('actionLabel')}</label>
            <select
              className={inputClass}
              value={draft.action}
              onChange={(e) => setDraft((f) => ({ ...f, action: e.target.value }))}
            >
              <option value="">{t('all')}</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('targetTypeLabel')}</label>
            <select
              className={inputClass}
              value={draft.targetType}
              onChange={(e) => setDraft((f) => ({ ...f, targetType: e.target.value }))}
            >
              <option value="">{t('all')}</option>
              {TARGET_TYPE_OPTIONS.map((tt) => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('outcomeLabel')}</label>
            <select
              className={inputClass}
              value={draft.outcome}
              onChange={(e) => setDraft((f) => ({ ...f, outcome: e.target.value }))}
            >
              <option value="">{t('all')}</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILURE">FAILURE</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('fromLabel')}</label>
            <input
              type="date"
              className={inputClass}
              value={draft.from}
              onChange={(e) => setDraft((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('toLabel')}</label>
            <input
              type="date"
              className={inputClass}
              value={draft.to}
              onChange={(e) => setDraft((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="submit" className="btn-primary px-4 py-2 text-sm">{t('searchButton')}</button>
        </div>
      </form>

      <section>
        {!error && result === null && <p className="text-muted">{tCommon('loading')}</p>}

        {!error && result !== null && result.items.length === 0 && (
          <div className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">{t('emptyList')}</p>
          </div>
        )}

        {result !== null && result.items.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold text-muted">
                    <th className="px-4 py-3">{t('colTime')}</th>
                    <th className="px-4 py-3">{t('colActor')}</th>
                    <th className="px-4 py-3">{t('colAction')}</th>
                    <th className="px-4 py-3">{t('colTarget')}</th>
                    <th className="px-4 py-3">{t('colOutcome')}</th>
                    <th className="px-4 py-3">{t('colSummary')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((row) => (
                    <AuditRow
                      key={row.id}
                      row={row}
                      expanded={expandedId === row.id}
                      onToggle={() => setExpandedId((id) => (id === row.id ? null : row.id))}
                    />
                  ))}
                </tbody>
              </table>
            </div>

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
// 행 클릭 시 metadata를 펼쳐 보여주는 감사 로그 한 줄
// ---------------------------------------------------------------------------
function AuditRow({ row, expanded, onToggle }: { row: AuditLogRow; expanded: boolean; onToggle: () => void }) {
  const t = useTranslations('audit');
  const tEnum = useTranslations('enum');
  const roleLabel = row.actorRole
    ? tEnum.has(`role.${row.actorRole}`)
      ? tEnum(`role.${row.actorRole as Role}`)
      : row.actorRole
    : null;

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="focusable cursor-pointer bg-card transition-colors hover:bg-subtle focus-visible:relative"
      >
        <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(row.createdAt)}</td>
        <td className="px-4 py-3">
          <p className="font-semibold text-ink">{row.actorName ?? row.actorId ?? t('systemActor')}</p>
          {(row.actorDept || roleLabel) && (
            <p className="text-xs text-muted">
              {[row.actorDept, roleLabel].filter(Boolean).join(' · ')}
            </p>
          )}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-ink">{row.action}</td>
        <td className="px-4 py-3 text-xs text-muted">
          {row.targetType}
          {row.targetId ? ` · ${row.targetId}` : ''}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
              row.outcome === 'FAILURE'
                ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300'
                : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
            }`}
          >
            {row.outcome}
          </span>
        </td>
        <td className="px-4 py-3 text-muted">{row.summary}</td>
      </tr>
      {expanded && (
        <tr className="bg-subtle">
          <td colSpan={6} className="px-4 py-3">
            <details open className="text-xs">
              <summary className="cursor-pointer font-semibold text-ink">metadata</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-muted">
                {row.metadata != null ? JSON.stringify(row.metadata, null, 2) : t('noMetadata')}
              </pre>
              {(row.ip || row.userAgent) && (
                <p className="mt-2 text-muted">
                  {row.ip ? `IP: ${row.ip}` : ''}
                  {row.ip && row.userAgent ? ' · ' : ''}
                  {row.userAgent ? `UA: ${row.userAgent}` : ''}
                </p>
              )}
            </details>
          </td>
        </tr>
      )}
    </>
  );
}
