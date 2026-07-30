import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from '@/test/render-with-intl';
import { InboxProvider, useInbox } from '@/components/inbox-context';
import { makeSummary, makeUser } from '@/test/fixtures';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listInbox: vi.fn(),
}));

import * as api from '@/lib/api';

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
