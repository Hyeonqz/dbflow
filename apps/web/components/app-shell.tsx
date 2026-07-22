'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUser } from '@/components/user-context';
import { Sidebar } from '@/components/sidebar';
import { MenuIcon } from '@/components/icons';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready } = useUser();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Esc로 드로어 닫기
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // 드로어 열림: 포커스를 드로어 안으로. 닫힘: 트리거(햄버거)로 복귀.
  // (초기 마운트에는 포커스를 옮기지 않도록 open 이력을 확인)
  const openedOnce = useRef(false);
  useEffect(() => {
    if (drawerOpen) {
      openedOnce.current = true;
      drawerRef.current?.focus();
    } else if (openedOnce.current) {
      triggerRef.current?.focus();
    }
  }, [drawerOpen]);

  // 가드: 훅이 /login으로 리다이렉트하는 동안 로딩 표시
  if (!ready || !user) {
    return <div className="p-6 text-muted">불러오는 중…</div>;
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* 데스크톱: 고정 사이드바 */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:sticky lg:top-0 lg:block lg:h-screen">
        <Sidebar user={user} />
      </aside>

      {/* 모바일: 상단바 */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-label="메뉴 열기"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          className="focusable inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink hover:bg-subtle"
        >
          <MenuIcon />
        </button>
        <span className="text-lg font-bold text-ink">DBFlow</span>
      </header>

      {/* 모바일: 슬라이드 드로어 */}
      {drawerOpen && (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="메뉴"
            tabIndex={-1}
            className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card outline-none"
          >
            <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        {children}
      </main>
    </div>
  );
}
