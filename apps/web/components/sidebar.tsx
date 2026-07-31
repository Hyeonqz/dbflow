'use client';

import Link from 'next/link';
import type { SVGProps } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { logout, type Role, type User } from '@/lib/auth';
import { useInbox } from '@/components/inbox-context';
import { ThemeToggle } from '@/components/theme';
import { LocaleToggle } from '@/components/locale-toggle';
import { CalendarIcon, ChevronIcon, ClipboardIcon, DatabaseIcon, DiffIcon, HomeIcon, ShieldCheckIcon, ShieldIcon, UsersCheckIcon, UsersIcon, UserSwitchIcon } from '@/components/icons';

type NavItem = {
  href: string;
  labelKey: string;
  Icon: (p: SVGProps<SVGSVGElement>) => JSX.Element;
  /** 접근 가능한 역할(스펙 §3). 미지정 시 전 역할. */
  roles?: Role[];
};

const NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', Icon: HomeIcon },
  { href: '/change-requests', labelKey: 'changeRequests', Icon: ClipboardIcon },
  // 스키마 Diff: 검토자 접근 불가 (개발자·결재자만)
  { href: '/schema-diff', labelKey: 'schemaDiff', Icon: DiffIcon, roles: ['DEVELOPER', 'APPROVER'] },
  // 대상 DB: 결재자만
  { href: '/target-databases', labelKey: 'targetDatabases', Icon: DatabaseIcon, roles: ['APPROVER'] },
  // 부재 위임: 검토자·결재자·관리자
  { href: '/delegations', labelKey: 'delegations', Icon: UserSwitchIcon, roles: ['REVIEWER', 'APPROVER', 'ADMIN'] },
  // 사용자 관리: 관리자만
  { href: '/users', labelKey: 'users', Icon: UsersIcon, roles: ['ADMIN'] },
  // 감사 로그: 관리자만
  { href: '/audit', labelKey: 'audit', Icon: ShieldIcon, roles: ['ADMIN'] },
  // SQL 리뷰 정책: 관리자만
  { href: '/sql-review', labelKey: 'sqlReview', Icon: ShieldCheckIcon, roles: ['ADMIN'] },
  // 결재 정책: 관리자만
  { href: '/approval-policy', labelKey: 'approvalPolicy', Icon: UsersCheckIcon, roles: ['ADMIN'] },
  { href: '/apply-schedule', labelKey: 'applySchedule', Icon: CalendarIcon, roles: ['ADMIN'] },
];

export function Sidebar({
  user,
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  user: User;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const tEnum = useTranslations('enum');
  const tCommon = useTranslations('common');
  const items = NAV.filter((it) => !it.roles || it.roles.includes(user.role));
  const { count: inboxCount } = useInbox();
  const canDecide = user.role === 'REVIEWER' || user.role === 'APPROVER';

  return (
    <div className="flex h-full flex-col">
      <div className={collapsed ? 'flex flex-col items-center gap-2 px-2 py-4' : 'px-5 py-5'}>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="text-xl font-bold text-ink"
        >
          {collapsed ? 'DB' : 'DBFlow'}
        </Link>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? tCommon('expandSidebar') : tCommon('collapseSidebar')}
            aria-expanded={!collapsed}
            className="focusable inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted hover:bg-subtle hover:text-ink"
          >
            <ChevronIcon className={collapsed ? 'rotate-180' : ''} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
          const showBadge = canDecide && inboxCount > 0 && it.href === '/change-requests';
          const badgeText = showBadge ? t('inboxBadgeAria', { count: inboxCount }) : '';
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? t(it.labelKey) : undefined}
              // 접힘 모드: Link의 aria-label이 하위 트리의 접근 가능한 이름을 대체하므로
              // 배지에 라벨을 붙이면 절대 읽히지 않는다. 여기서 합성한다.
              aria-label={
                collapsed
                  ? showBadge
                    ? `${t(it.labelKey)}, ${badgeText}`
                    : t(it.labelKey)
                  : undefined
              }
              className={`focusable flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? 'relative justify-center' : ''
              } ${active ? 'bg-primary text-white' : 'text-muted hover:bg-subtle hover:text-ink'}`}
            >
              <it.Icon className="shrink-0" />
              {!collapsed && <span>{t(it.labelKey)}</span>}
              {showBadge && (
                <span
                  // 펼침 모드에서는 배지가 접근 가능한 이름에 기여해야 하므로 라벨을 준다.
                  aria-label={collapsed ? undefined : badgeText}
                  className={
                    collapsed
                      ? 'absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-card'
                      : 'ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-white'
                  }
                >
                  {inboxCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="space-y-3 border-t border-border px-3 py-4">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LocaleToggle />
          </div>
          <div className="px-2">
            <p className="text-sm">
              <span className="font-semibold text-ink">{user.name}</span>{' '}
              <span className="text-muted">| {user.department}</span>
            </p>
            <p className="text-xs text-muted">{tEnum(`role.${user.role}`)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              logout();
              window.location.href = '/login';
            }}
            className="focusable w-full rounded-2xl bg-subtle px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-border-strong"
          >
            {tCommon('logout')}
          </button>
        </div>
      )}
    </div>
  );
}
