import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { renderWithIntl } from '@/test/render-with-intl';
import { InboxProvider, useInbox } from '@/components/inbox-context';
import { makeSummary, makeUser } from '@/test/fixtures';
import messages from '@/messages/en.json';
import type { ChangeRequestSummary } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listInbox: vi.fn(),
}));

import * as api from '@/lib/api';

// usePathname must be controllable so we can prove the title-mirroring effect
// re-runs on navigation (real next/navigation defaults to a null context value
// under jsdom, which is fine for the other tests but useless for this one).
const { nav } = vi.hoisted(() => ({ nav: { pathname: '/dashboard' } }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

function Probe() {
  const { count, loading, refresh } = useInbox();
  return (
    <div>
      <span data-testid="count">{count}</span>
      <span data-testid="loading">{String(loading)}</span>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listInbox).mockResolvedValue([]);
  nav.pathname = '/dashboard';
});

describe('useInbox without a provider', () => {
  it('returns a default instead of throwing', () => {
    // CR 상세 테스트 19개는 컴포넌트를 단독 렌더한다. throw하면 그 전부가 깨진다.
    renderWithIntl(<Probe />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });
});

describe('InboxProvider', () => {
  it('fetches for a reviewer and exposes the count', async () => {
    vi.mocked(api.listInbox).mockResolvedValue([makeSummary({ id: 'a' }), makeSummary({ id: 'b' })]);
    renderWithIntl(
      <InboxProvider user={makeUser({ role: 'REVIEWER' })}>
        <Probe />
      </InboxProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
  });

  it('does not call the API for a developer', async () => {
    renderWithIntl(
      <InboxProvider user={makeUser({ role: 'DEVELOPER' })}>
        <Probe />
      </InboxProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(api.listInbox).not.toHaveBeenCalled();
  });

  it('degrades to zero without breaking when the fetch fails', async () => {
    vi.mocked(api.listInbox).mockRejectedValue(new Error('boom'));
    renderWithIntl(
      <InboxProvider user={makeUser({ role: 'APPROVER' })}>
        <Probe />
      </InboxProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('refresh() refetches', async () => {
    vi.mocked(api.listInbox).mockResolvedValue([makeSummary({ id: 'a' })]);
    renderWithIntl(
      <InboxProvider user={makeUser({ role: 'APPROVER' })}>
        <Probe />
      </InboxProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    vi.mocked(api.listInbox).mockResolvedValue([makeSummary({ id: 'a' }), makeSummary({ id: 'b' })]);
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
  });
});

describe('tab title mirror', () => {
  it('mirrors the inbox count into document.title for a reviewer', async () => {
    vi.mocked(api.listInbox).mockResolvedValue([makeSummary({ id: 'a' }), makeSummary({ id: 'b' })]);
    renderWithIntl(
      <InboxProvider user={makeUser({ role: 'REVIEWER' })}>
        <Probe />
      </InboxProvider>,
    );
    await waitFor(() => expect(document.title).toBe('(2) DBFlow'));
  });

  it('restores document.title to "DBFlow" on unmount', async () => {
    vi.mocked(api.listInbox).mockResolvedValue([makeSummary({ id: 'a' })]);
    const { unmount } = renderWithIntl(
      <InboxProvider user={makeUser({ role: 'REVIEWER' })}>
        <Probe />
      </InboxProvider>,
    );
    await waitFor(() => expect(document.title).toBe('(1) DBFlow'));

    unmount();
    expect(document.title).toBe('DBFlow');
  });

  it('re-applies the title on a pathname change, so Next cannot silently revert it on soft navigation', async () => {
    // next/navigation's usePathname must be a dependency of the title effect: Next
    // re-applies resolved route metadata (which resets document.title) on every
    // navigation, and count alone wouldn't change across a nav to a different route.
    vi.mocked(api.listInbox).mockResolvedValue([makeSummary({ id: 'a' }), makeSummary({ id: 'b' })]);
    // A fresh element (not a shared reference) on each render call: passing the same
    // element object to `rerender` hits React's referential-equality bailout and skips
    // re-rendering the subtree entirely, which would make this test pass for the wrong reason.
    const tree = () => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Seoul">
        <InboxProvider user={makeUser({ role: 'REVIEWER' })}>
          <Probe />
        </InboxProvider>
      </NextIntlClientProvider>
    );
    const { rerender } = render(tree());
    await waitFor(() => expect(document.title).toBe('(2) DBFlow'));

    // Simulate Next stomping the title back to the resolved metadata on navigation.
    document.title = 'DBFlow';
    nav.pathname = '/change-requests';
    rerender(tree());

    await waitFor(() => expect(document.title).toBe('(2) DBFlow'));
  });
});

describe('unmount safety', () => {
  it('does not throw when listInbox resolves after the provider has unmounted', async () => {
    let resolve!: (v: ChangeRequestSummary[]) => void;
    const pending = new Promise<ChangeRequestSummary[]>((res) => {
      resolve = res;
    });
    vi.mocked(api.listInbox).mockReturnValue(pending);

    const { unmount, container } = renderWithIntl(
      <InboxProvider user={makeUser({ role: 'REVIEWER' })}>
        <Probe />
      </InboxProvider>,
    );
    unmount();

    resolve([makeSummary({ id: 'a' })]);
    await pending;
    await Promise.resolve();

    expect(container).toBeEmptyDOMElement();
  });

  it('ignores a stale reactStrictMode double-fire response that resolves after the fresh one', async () => {
    // This is the actual scenario the `active` guard exists for (see the comment in
    // inbox-context.tsx): StrictMode fires the fetch effect, tears it down, and fires it
    // again on mount. If the *first* (torn-down) call's response happens to resolve after
    // the second (live) one, an unguarded effect would let the stale response win.
    let resolveStale!: (v: ChangeRequestSummary[]) => void;
    let resolveFresh!: (v: ChangeRequestSummary[]) => void;
    const stale = new Promise<ChangeRequestSummary[]>((res) => {
      resolveStale = res;
    });
    const fresh = new Promise<ChangeRequestSummary[]>((res) => {
      resolveFresh = res;
    });
    vi.mocked(api.listInbox).mockReturnValueOnce(stale).mockReturnValueOnce(fresh);

    render(
      <StrictMode>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Seoul">
          <InboxProvider user={makeUser({ role: 'REVIEWER' })}>
            <Probe />
          </InboxProvider>
        </NextIntlClientProvider>
      </StrictMode>,
    );

    // The live (second) effect's response arrives first, as it realistically would.
    await act(async () => {
      resolveFresh([makeSummary({ id: 'fresh' })]);
      await fresh;
    });
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    // The stale (first, already-cleaned-up) effect's response arrives late. `act` flushes
    // whatever state update it triggers, so this assertion is deterministic either way.
    await act(async () => {
      resolveStale([makeSummary({ id: 'a' }), makeSummary({ id: 'b' }), makeSummary({ id: 'c' })]);
      await stale;
    });

    // Must still reflect the fresh response, not the stale 3-item one.
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });
});
