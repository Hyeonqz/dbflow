import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from '@/test/render-with-intl';
// Task 4~6이 이 파일에 테스트를 덧붙이면서 makeTargetDb·makeExecution·makeBackup을 추가로 import한다.
import { makeCr, makeLint, makeUser } from '@/test/fixtures';

// useRouter는 반드시 안정된 참조를 돌려줘야 한다. 매 렌더 새 객체를 주면
// useCurrentUser의 useEffect([router])가 무한 루프를 돌아 힙 OOM으로 죽는다.
// vi.hoisted를 쓰는 이유는 vi.mock이 평범한 const보다 먼저 평가되기 때문이다.
const { router } = vi.hoisted(() => ({
  router: {
    replace: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/change-requests/cr1',
  useSearchParams: () => new URLSearchParams(),
}));

// importOriginal로 스프레드해야 ApiError 클래스가 살아남는다(instanceof 비교에 쓰임).
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getChangeRequest: vi.fn(),
  listExecutions: vi.fn(),
  listBackups: vi.fn(),
  listTargetDatabases: vi.fn(),
  listUsersByRole: vi.fn(),
  lintChangeRequest: vi.fn(),
  getScheduleStatus: vi.fn(),
  submitChangeRequest: vi.fn(),
  reviewChangeRequest: vi.fn(),
  approveChangeRequest: vi.fn(),
  applyChangeRequest: vi.fn(),
  dryRunChangeRequest: vi.fn(),
  rollbackExecution: vi.fn(),
  setAssignees: vi.fn(),
}));

import * as api from '@/lib/api';
import ChangeRequestDetailPage from './page';

/** localStorage를 심어 실제 useCurrentUser 훅을 태운다(auth는 mock하지 않는다). */
function signIn(user = makeUser()) {
  localStorage.setItem('accessToken', 'test-token');
  localStorage.setItem('user', JSON.stringify(user));
}

function renderPage() {
  return renderWithIntl(<ChangeRequestDetailPage params={{ id: 'cr1' }} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  signIn();
  // 모든 mock은 프로미스를 반환해야 한다 — 호출부가 반환값에 곧바로 .then()을 건다.
  vi.mocked(api.getChangeRequest).mockResolvedValue(makeCr());
  vi.mocked(api.listExecutions).mockResolvedValue([]);
  vi.mocked(api.listBackups).mockResolvedValue([]);
  vi.mocked(api.listTargetDatabases).mockResolvedValue([]);
  vi.mocked(api.listUsersByRole).mockResolvedValue([]);
  vi.mocked(api.lintChangeRequest).mockResolvedValue(makeLint());
  vi.mocked(api.getScheduleStatus).mockResolvedValue({ allowed: true });
});

describe('load errors', () => {
  it('shows the banner when the initial load fails', async () => {
    vi.mocked(api.getChangeRequest).mockRejectedValue(new Error('Request failed. (500)'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed. (500)');
  });

  it('keeps the loaded content visible when a refresh fails', async () => {
    vi.mocked(api.getChangeRequest)
      .mockResolvedValueOnce(makeCr())
      .mockRejectedValue(new Error('Request failed. (500)'));
    vi.mocked(api.submitChangeRequest).mockResolvedValue(makeCr());

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed. (500)');
    // 기존 내용이 남아 있어야 사용자가 무엇을 보고 있는지 알 수 있다.
    expect(screen.getByRole('heading', { name: 'Add index on orders' })).toBeInTheDocument();
  });

  it('clears the load error once a later refresh succeeds', async () => {
    vi.mocked(api.getChangeRequest)
      .mockResolvedValueOnce(makeCr())
      .mockRejectedValueOnce(new Error('Request failed. (500)'))
      .mockResolvedValue(makeCr());
    vi.mocked(api.submitChangeRequest).mockResolvedValue(makeCr());

    renderPage();
    const submit = await screen.findByRole('button', { name: 'Request review' });

    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
