import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render-with-intl';
import { makeSummary, makeUser } from '@/test/fixtures';
import { UserProvider } from '@/components/user-context';

const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const { inbox } = vi.hoisted(() => ({ inbox: { value: { items: [] as any[], count: 0, loading: false, refresh: async () => {} } } }));
vi.mock('@/components/inbox-context', () => ({ useInbox: () => inbox.value }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listChangeRequests: vi.fn(),
}));

import * as api from '@/lib/api';
import Dashboard from './page';

function signIn(user = makeUser({ role: 'REVIEWER' })) {
  localStorage.setItem('accessToken', 'test-token');
  localStorage.setItem('user', JSON.stringify(user));
}

// Dashboard는 useUser()(컨텍스트 기반)를 쓴다 — useCurrentUser()와 달리 UserProvider 없이는
// throw한다. 실제 앱에서는 (app)/layout.tsx가 이 provider를 씌워준다.
function renderPage() {
  return renderWithIntl(
    <UserProvider>
      <Dashboard />
    </UserProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  signIn();
  inbox.value = { items: [], count: 0, loading: false, refresh: async () => {} };
  vi.mocked(api.listChangeRequests).mockResolvedValue([]);
});

describe('dashboard inbox', () => {
  it('lists items with their wait duration and links to the detail page', async () => {
    inbox.value = {
      ...inbox.value,
      items: [makeSummary({ id: 'cr-old', title: 'Old one', updatedAt: '2026-07-01T00:00:00.000Z' })],
    };
    renderPage();
    const section = (await screen.findByRole('heading', { name: 'Waiting on you' })).closest('section') as HTMLElement;
    const link = within(section).getByRole('link', { name: /Old one/ });
    expect(link).toHaveAttribute('href', '/change-requests/cr-old');
    expect(within(section).getByText(/waiting/)).toBeInTheDocument();
  });

  it('keeps the section and shows an empty state when nothing is waiting', async () => {
    renderPage();
    const section = (await screen.findByRole('heading', { name: 'Waiting on you' })).closest('section') as HTMLElement;
    expect(within(section).getByText('No change requests are waiting on your decision.')).toBeInTheDocument();
  });

  it('marks a delegated item with the delegator name', async () => {
    inbox.value = {
      ...inbox.value,
      items: [makeSummary({ id: 'cr-d', title: 'Routed', delegatedFrom: '김검토' })],
    };
    renderPage();
    expect(await screen.findByText(/Delegated from 김검토/)).toBeInTheDocument();
  });

  it('shows no inbox section for a developer', async () => {
    signIn(makeUser({ role: 'DEVELOPER' }));
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { name: 'Waiting on you' })).toBeNull();
  });

  it("labels a developer's own requests with what blocks them", async () => {
    signIn(makeUser({ role: 'DEVELOPER' }));
    vi.mocked(api.listChangeRequests).mockResolvedValue([
      makeSummary({ id: 'cr-1', title: 'Mine', status: 'SUBMITTED', reviewerName: '김검토' }),
    ]);
    renderPage();
    expect(await screen.findByText('Waiting for review by 김검토')).toBeInTheDocument();
  });
});
