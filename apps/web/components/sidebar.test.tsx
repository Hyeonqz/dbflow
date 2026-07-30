import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render-with-intl';
import { Sidebar } from '@/components/sidebar';
import { makeUser } from '@/test/fixtures';

const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const { inbox } = vi.hoisted(() => ({ inbox: { value: { items: [], count: 0, loading: false, refresh: async () => {} } } }));
vi.mock('@/components/inbox-context', () => ({ useInbox: () => inbox.value }));

beforeEach(() => {
  inbox.value = { items: [], count: 0, loading: false, refresh: async () => {} };
});

describe('sidebar inbox badge', () => {
  it('shows the count for a reviewer', () => {
    inbox.value = { ...inbox.value, count: 3 };
    renderWithIntl(<Sidebar user={makeUser({ role: 'REVIEWER' })} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders nothing at all when the count is zero — not "0"', () => {
    renderWithIntl(<Sidebar user={makeUser({ role: 'REVIEWER' })} />);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('exposes the count in the accessible name when collapsed', () => {
    // 접힌 모드에서 Link 자신이 aria-label을 가지므로, 중첩 배지의 라벨은 읽히지 않는다.
    // 따라서 Link의 aria-label에 합성해야 한다.
    inbox.value = { ...inbox.value, count: 3 };
    renderWithIntl(<Sidebar user={makeUser({ role: 'REVIEWER' })} collapsed />);
    expect(screen.getByRole('link', { name: /3 awaiting your decision/ })).toBeInTheDocument();
  });

  it('has no badge for a developer', () => {
    inbox.value = { ...inbox.value, count: 3 };
    renderWithIntl(<Sidebar user={makeUser({ role: 'DEVELOPER' })} />);
    expect(screen.queryByText('3')).toBeNull();
  });
});
