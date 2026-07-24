'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useUser } from '@/components/user-context';
import { listChangeRequests, type ChangeRequestSummary } from '@/lib/api';
import { EnvBadge, StatusBadge } from '@/components/badges';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';

type StaffRole = 'DEVELOPER' | 'REVIEWER' | 'APPROVER';

const ROLE_ACTION: Record<StaffRole, { labelKey: string; href: string }> = {
  DEVELOPER: { labelKey: 'action.developer', href: '/change-requests/new' },
  REVIEWER: { labelKey: 'action.reviewer', href: '/change-requests' },
  APPROVER: { labelKey: 'action.approver', href: '/change-requests' },
};

// 목록 페이지 FILTERS 키와 동일. href 미지정 카드는 status 조합이 단일 필터로 매핑되지 않음.
type FilterKey = 'REVIEW_PENDING' | 'APPROVE_PENDING' | 'REJECTED' | 'DONE';

type CardDef = {
  labelKey: string;
  match: (cr: ChangeRequestSummary) => boolean;
  filter?: FilterKey;
  emphasis?: boolean;
};

// §12.1 역할별 KPI 카드 매트릭스 — 지정 기반 가시성(T5): 세 역할 모두 자기 응답 집계.
// ADMIN은 컴포넌트 상단 가드에서 리다이렉트되어 이 맵에 절대 접근하지 않는다.
const CARDS_BY_ROLE: Record<StaffRole, CardDef[]> = {
  DEVELOPER: [
    { labelKey: 'card.developer.drafts', match: (cr) => cr.status === 'DRAFT' },
    {
      labelKey: 'card.developer.inProgress',
      match: (cr) => cr.status === 'SUBMITTED' || cr.status === 'REVIEW_APPROVED',
      emphasis: true,
    },
    {
      labelKey: 'card.developer.rejected',
      match: (cr) => cr.status === 'REVIEW_REJECTED' || cr.status === 'FINAL_REJECTED',
      filter: 'REJECTED',
    },
    {
      labelKey: 'card.developer.done',
      match: (cr) => cr.status === 'FINAL_APPROVED' || cr.status === 'APPLIED',
      filter: 'DONE',
    },
  ],
  REVIEWER: [
    { labelKey: 'card.reviewer.pending', match: (cr) => cr.status === 'SUBMITTED', filter: 'REVIEW_PENDING', emphasis: true },
    { labelKey: 'card.reviewer.approvePending', match: (cr) => cr.status === 'REVIEW_APPROVED', filter: 'APPROVE_PENDING' },
    {
      labelKey: 'card.reviewer.rejected',
      match: (cr) => cr.status === 'REVIEW_REJECTED' || cr.status === 'FINAL_REJECTED',
      filter: 'REJECTED',
    },
    { labelKey: 'card.reviewer.done', match: (cr) => cr.status === 'FINAL_APPROVED' || cr.status === 'APPLIED', filter: 'DONE' },
  ],
  APPROVER: [
    { labelKey: 'card.approver.reviewInProgress', match: (cr) => cr.status === 'SUBMITTED', filter: 'REVIEW_PENDING' },
    { labelKey: 'card.approver.pending', match: (cr) => cr.myApprovalPending, filter: 'APPROVE_PENDING', emphasis: true },
    {
      labelKey: 'card.approver.rejected',
      match: (cr) => cr.status === 'REVIEW_REJECTED' || cr.status === 'FINAL_REJECTED',
      filter: 'REJECTED',
    },
    { labelKey: 'card.approver.done', match: (cr) => cr.status === 'FINAL_APPROVED' || cr.status === 'APPLIED', filter: 'DONE' },
  ],
};

const SUMMARY_KEY: Record<StaffRole, string> = {
  DEVELOPER: 'summary.developer',
  REVIEWER: 'summary.reviewer',
  APPROVER: 'summary.approver',
};

/** 인사 밑 한 문장 요약(토스식). emphasis 카드의 건수로 "지금 할 일"을 자연어로. */
function buildSummary(
  t: ReturnType<typeof useTranslations<'dashboard'>>,
  role: StaffRole,
  items: ChangeRequestSummary[],
  cards: CardDef[],
): string {
  const focus = cards.find((c) => c.emphasis);
  if (!focus) return t('summaryFallback', { count: items.length });
  const n = items.filter((it) => focus.match(it)).length;
  if (n === 0) return t('summaryNone');
  return t(SUMMARY_KEY[role], { count: n });
}

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const tEnum = useTranslations('enum');
  const { user, ready } = useUser();
  const router = useRouter();
  const [items, setItems] = useState<ChangeRequestSummary[] | null>(null);
  const [error, setError] = useState('');

  // ADMIN은 대시보드가 아닌 사용자 관리로 리다이렉트 — CARDS_BY_ROLE에 ADMIN 키가 없으므로 필수.
  useEffect(() => {
    if (ready && user?.role === 'ADMIN') router.replace('/users');
  }, [ready, user, router]);

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

  const recent = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  }, [items]);

  if (!ready || !user || user.role === 'ADMIN') return <DashboardSkeleton />;

  const action = ROLE_ACTION[user.role];
  const cards = CARDS_BY_ROLE[user.role];
  const roleKey = `role.${user.role}`;
  const summary = items
    ? buildSummary(t, user.role, items, cards)
    : tEnum.has(roleKey)
      ? tEnum(roleKey)
      : user.role;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('greeting', { name: user.name })}
        description={summary}
        action={
          action && (
            <Link href={action.href} className="btn-primary inline-flex px-5 py-2.5 text-sm">
              {t(action.labelKey)}
            </Link>
          )
        }
      />

      {error && (
        <p
          role="alert"
          className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {items === null && !error ? (
        <DashboardSkeleton bodyOnly />
      ) : (
        items !== null && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {cards.map((c) => (
                <StatCard
                  key={c.labelKey}
                  label={t(c.labelKey)}
                  value={items.filter((it) => c.match(it)).length}
                  href={c.filter ? `/change-requests?filter=${c.filter}` : undefined}
                  emphasis={c.emphasis}
                />
              ))}
            </div>

            <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">{t('recentTitle')}</h2>
                <Link
                  href="/change-requests"
                  className="focusable rounded-lg text-sm font-medium text-muted transition-colors hover:text-ink"
                >
                  {t('viewAll')}
                </Link>
              </div>

              {recent.length === 0 ? (
                <div className="mt-4 rounded-2xl bg-subtle px-6 py-12 text-center text-muted">{t('emptyRecent')}</div>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {recent.map((it) => (
                    <li key={it.id}>
                      <Link
                        href={`/change-requests/${it.id}`}
                        className="focusable -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-subtle"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-ink">{it.title}</p>
                          <p className="mt-0.5 truncate text-sm text-muted">
                            {it.authorName ?? it.authorId} · {formatDateTime(it.createdAt)}
                          </p>
                        </div>
                        <EnvBadge env={it.targetEnv} />
                        <StatusBadge status={it.status} />
                        <span aria-hidden className="text-muted">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}

/** 로딩 자리표시자. bodyOnly면 헤더(이미 렌더됨)를 제외한 본문만. */
function DashboardSkeleton({ bodyOnly }: { bodyOnly?: boolean }) {
  const body = (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-2xl bg-subtle" />
        ))}
      </div>
      <div className="rounded-2xl bg-card p-5 ring-1 ring-border">
        <div className="h-5 w-32 animate-pulse rounded bg-subtle" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-subtle" />
          ))}
        </div>
      </div>
    </div>
  );
  if (bodyOnly) return body;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-subtle" />
        <div className="h-4 w-40 animate-pulse rounded bg-subtle" />
      </div>
      {body}
    </div>
  );
}
