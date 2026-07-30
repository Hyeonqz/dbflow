import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render-with-intl';
import { makeSummary, makeUser } from '@/test/fixtures';

const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listInbox: vi.fn(),
}));

import * as api from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { UserProvider } from '@/components/user-context';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('accessToken', 'test-token');
  localStorage.setItem('user', JSON.stringify(makeUser({ role: 'REVIEWER' })));
  vi.mocked(api.listInbox).mockResolvedValue([makeSummary({ id: 'a' }), makeSummary({ id: 'b' })]);
});

describe('AppShell inbox wiring', () => {
  it('puts the sidebar inside the InboxProvider so the badge sees the count', async () => {
    // provider가 {children}만 감싸면 이 단언만 실패한다 — 다른 테스트는 전부 초록으로 남는다.
    // AppShell은 useUser()로 컨텍스트에서 사용자를 읽으므로 실제 app/(app)/layout.tsx처럼
    // UserProvider로 감싸야 한다(그래야 내부에서 localStorage의 user를 읽어 채운다).
    renderWithIntl(
      <UserProvider>
        <AppShell><p>body</p></AppShell>
      </UserProvider>,
    );
    expect(await screen.findByText('2')).toBeInTheDocument();
  });
});
