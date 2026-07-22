'use client';

import Link from 'next/link';
import type { SVGProps } from 'react';
import { usePathname } from 'next/navigation';
import { ROLE_LABEL, logout, type Role, type User } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme';
import { CalendarIcon, ChevronIcon, ClipboardIcon, DatabaseIcon, DiffIcon, HomeIcon, ShieldCheckIcon, ShieldIcon, UsersCheckIcon, UsersIcon, UserSwitchIcon } from '@/components/icons';

type NavItem = {
  href: string;
  label: string;
  Icon: (p: SVGProps<SVGSVGElement>) => JSX.Element;
  /** 접근 가능한 역할(스펙 §3). 미지정 시 전 역할. */
  roles?: Role[];
};

const NAV: NavItem[] = [
  { href: '/dashboard', label: '대시보드', Icon: HomeIcon },
  { href: '/change-requests', label: '변경요청', Icon: ClipboardIcon },
  // 스키마 Diff: 검토자 접근 불가 (개발자·결재자만)
  { href: '/schema-diff', label: '스키마 Diff', Icon: DiffIcon, roles: ['DEVELOPER', 'APPROVER'] },
  // 대상 DB: 결재자만
  { href: '/target-databases', label: '대상 DB', Icon: DatabaseIcon, roles: ['APPROVER'] },
  // 부재 위임: 검토자·결재자·관리자
  { href: '/delegations', label: '부재 위임', Icon: UserSwitchIcon, roles: ['REVIEWER', 'APPROVER', 'ADMIN'] },
  // 사용자 관리: 관리자만
  { href: '/users', label: '사용자 관리', Icon: UsersIcon, roles: ['ADMIN'] },
  // 감사 로그: 관리자만
  { href: '/audit', label: '감사 로그', Icon: ShieldIcon, roles: ['ADMIN'] },
  // SQL 리뷰 정책: 관리자만
  { href: '/sql-review', label: 'SQL 리뷰 정책', Icon: ShieldCheckIcon, roles: ['ADMIN'] },
  // 결재 정책: 관리자만
  { href: '/approval-policy', label: '결재 정책', Icon: UsersCheckIcon, roles: ['ADMIN'] },
  { href: '/apply-schedule', label: '작업창·동결', Icon: CalendarIcon, roles: ['ADMIN'] },
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
  const items = NAV.filter((it) => !it.roles || it.roles.includes(user.role));

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
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
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
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? it.label : undefined}
              aria-label={collapsed ? it.label : undefined}
              className={`focusable flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center' : ''
              } ${active ? 'bg-primary text-white' : 'text-muted hover:bg-subtle hover:text-ink'}`}
            >
              <it.Icon className="shrink-0" />
              {!collapsed && <span>{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="space-y-3 border-t border-border px-3 py-4">
          <ThemeToggle />
          <div className="px-2">
            <p className="text-sm">
              <span className="font-semibold text-ink">{user.name}</span>{' '}
              <span className="text-muted">| {user.department}</span>
            </p>
            <p className="text-xs text-muted">{ROLE_LABEL[user.role]}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              logout();
              window.location.href = '/login';
            }}
            className="focusable w-full rounded-2xl bg-subtle px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-border-strong"
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
