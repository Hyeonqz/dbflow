'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { type Role } from '@/lib/auth';
import { useUser } from '@/components/user-context';
import { listChangeRequests, type ChangeRequestStatus, type ChangeRequestSummary } from '@/lib/api';
import { EnvBadge, StatusBadge } from '@/components/badges';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/page-header';

type FilterKey = 'ALL' | 'REVIEW_PENDING' | 'APPROVE_PENDING' | 'REJECTED' | 'DONE';

type FilterDef = { key: FilterKey; labelKey: string; match: (s: ChangeRequestStatus) => boolean };

const FILTERS: FilterDef[] = [
  { key: 'ALL', labelKey: 'filterAll', match: () => true },
  { key: 'REVIEW_PENDING', labelKey: 'filterReviewPending', match: (s) => s === 'SUBMITTED' },
  { key: 'APPROVE_PENDING', labelKey: 'filterApprovePending', match: (s) => s === 'REVIEW_APPROVED' },
  {
    key: 'REJECTED',
    labelKey: 'filterRejected',
    match: (s) => s === 'REVIEW_REJECTED' || s === 'FINAL_REJECTED',
  },
  { key: 'DONE', labelKey: 'filterDone', match: (s) => s === 'FINAL_APPROVED' || s === 'APPLIED' },
];

// ADMIN은 컴포넌트 상단 가드에서 리다이렉트되어 이 맵에 절대 접근하지 않는다.
const DEFAULT_FILTER_BY_ROLE: Record<'DEVELOPER' | 'REVIEWER' | 'APPROVER', FilterKey> = {
  DEVELOPER: 'ALL',
  REVIEWER: 'REVIEW_PENDING',
  APPROVER: 'APPROVE_PENDING',
};

// 지정 기반 가시성(T5): 검토자/결재자 응답 모두 자기에게 지정된 SUBMITTED를 포함하므로 전 상태 노출.
function filtersForRole(_role: Role) {
  return FILTERS;
}

export default function ChangeRequestListPage() {
  const { user, ready } = useUser();
  const router = useRouter();
  const t = useTranslations('changeRequests');
  const tCommon = useTranslations('common');
  const locale = useLocale() as Locale;
  const [items, setItems] = useState<ChangeRequestSummary[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('ALL');

  // ADMIN은 변경 요청 목록이 아닌 사용자 관리로 리다이렉트 — DEFAULT_FILTER_BY_ROLE에 ADMIN 키가 없으므로 필수.
  useEffect(() => {
    if (ready && user?.role === 'ADMIN') router.replace('/users');
  }, [ready, user, router]);

  // 역할이 정해지면 필터 초기화: ?filter= 딥링크(대시보드 KPI 카드)가 있고
  // 그 역할에서 유효하면 우선, 없으면 역할별 기본값.
  useEffect(() => {
    if (!user || user.role === 'ADMIN') return;
    const q = new URLSearchParams(window.location.search).get('filter');
    const allowed = filtersForRole(user.role).map((f) => f.key) as string[];
    setFilter(q && allowed.includes(q) ? (q as FilterKey) : DEFAULT_FILTER_BY_ROLE[user.role] ?? 'ALL');
  }, [user]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    listChangeRequests()
      .then((data) => active && setItems(data))
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [ready]);

  const visible = useMemo(() => {
    if (!items) return [];
    const m = FILTERS.find((f) => f.key === filter)?.match ?? (() => true);
    return items.filter((it) => m(it.status));
  }, [items, filter]);

  if (!ready || !user || user.role === 'ADMIN') {
    return <p className="text-muted">{tCommon('loading')}</p>;
  }

  const filters = filtersForRole(user.role);

  return (
    <>
      <PageHeader
        title={t('listTitle')}
        action={
          user.role === 'DEVELOPER' && (
            <Link href="/change-requests/new" className="btn-primary inline-flex px-4 py-2.5 text-sm">
              {t('newTitle')}
            </Link>
          )
        }
      />

      {/* 상태 필터 — 탭이 아닌 토글 버튼 그룹(선택이 화면을 전환하지 않고 목록을 걸러냄). */}
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label={t('statusFilterAriaLabel')}>
        {filters.map((f) => {
          const selected = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(f.key)}
              className={`focusable rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                selected
                  ? 'bg-primary text-white'
                  : 'bg-card text-muted ring-1 ring-border-strong hover:text-ink'
              }`}
            >
              {t(f.labelKey)}
            </button>
          );
        })}
      </div>

      <section className="mt-6">
        {error && (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">
            {error}
          </p>
        )}

        {!error && items === null && <p className="text-muted">{tCommon('loading')}</p>}

        {!error && items !== null && visible.length === 0 && (
          <div className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">{t('emptyList')}</p>
          </div>
        )}

        {visible.length > 0 && (
          <>
            {/* sm 이상: 테이블 */}
            <div className="hidden overflow-x-auto rounded-2xl ring-1 ring-border sm:block">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold text-muted">
                    <th className="px-4 py-3">{t('colTitle')}</th>
                    <th className="px-4 py-3">{t('colEnv')}</th>
                    <th className="px-4 py-3">{t('colStatus')}</th>
                    <th className="px-4 py-3">{t('colAuthor')}</th>
                    <th className="px-4 py-3">{t('colCreatedAt')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((it) => (
                    <tr
                      key={it.id}
                      role="link"
                      tabIndex={0}
                      aria-label={t('rowDetailAriaLabel', { title: it.title })}
                      onClick={() => router.push(`/change-requests/${it.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(`/change-requests/${it.id}`);
                        }
                      }}
                      className="focusable cursor-pointer bg-card transition-colors hover:bg-subtle focus-visible:relative"
                    >
                      <td className="px-4 py-3 font-semibold text-ink">{it.title}</td>
                      <td className="px-4 py-3">
                        <EnvBadge env={it.targetEnv} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={it.status} />
                      </td>
                      <td className="px-4 py-3 text-muted">{it.authorName ?? it.authorId}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {formatDateTime(it.createdAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* sm 미만: 카드 스택 */}
            <ul className="space-y-3 sm:hidden">
              {visible.map((it) => (
                <li key={it.id}>
                  <Link
                    href={`/change-requests/${it.id}`}
                    className="focusable block rounded-2xl bg-card p-5 ring-1 ring-border transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold text-ink">{it.title}</h2>
                      <StatusBadge status={it.status} />
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                      <EnvBadge env={it.targetEnv} />
                      <span>{it.authorName ?? it.authorId}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDateTime(it.createdAt, locale)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
