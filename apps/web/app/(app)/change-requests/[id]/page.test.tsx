import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

describe('action errors', () => {
  /** 검토자가 제출된 CR을 보는 상태 — DecisionAction(검토)이 렌더된다. */
  function signInAsReviewer() {
    signIn(makeUser({ id: 'u-rev', role: 'REVIEWER', name: 'Rev' }));
    vi.mocked(api.getChangeRequest).mockResolvedValue(makeCr({ status: 'SUBMITTED' }));
  }

  it('shows the missing-reason validation inside the decision section and marks the field', async () => {
    signInAsReviewer();
    renderPage();

    const reject = await screen.findByRole('button', { name: 'Reject' });
    await userEvent.click(reject);

    // 에러는 반려 버튼이 속한 DecisionAction 안에 있어야 한다.
    // (Task 2에서 DecisionAction 루트를 <section>으로 바꿨기에 이 단언이 인스턴스에 결합한다)
    const decisionSection = reject.closest('section');
    expect(decisionSection).not.toBeNull();
    const alert = within(decisionSection as HTMLElement).getByRole('alert');
    expect(alert).toHaveTextContent('Please enter a reason when rejecting.');

    const textarea = screen.getByLabelText('Review comment');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-describedby', alert.id);
    expect(textarea).toHaveFocus();

    // 에러는 textarea와 버튼 사이에 렌더되어야 한다(DOM 순서 결합).
    expect(alert.compareDocumentPosition(reject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clears the validation message as soon as the user types a reason', async () => {
    signInAsReviewer();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Review comment'), 'needs an index name');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('scopes a failed decision to its own instance and keeps the typed comment', async () => {
    // canActAsDelegate=true면 검토용과 결재용 DecisionAction이 동시에 마운트된다.
    // 이 상황이야말로 루트를 <section>으로 바꾼 이유이므로 여기서 검증한다.
    signIn(makeUser({ id: 'u-rev', role: 'REVIEWER', name: 'Rev' }));
    vi.mocked(api.getChangeRequest).mockResolvedValue(
      makeCr({ status: 'SUBMITTED', canActAsDelegate: true }),
    );
    vi.mocked(api.reviewChangeRequest).mockRejectedValue(new Error('Already reviewed.'));
    renderPage();

    // 두 인스턴스가 같은 라벨/버튼명을 쓰므로 제목으로 섹션을 특정한 뒤 그 안에서 찾는다.
    const reviewSection = (await screen.findByRole('heading', { name: 'Review (1st)' }))
      .closest('section') as HTMLElement;
    const textarea = within(reviewSection).getByLabelText('Review comment');
    await userEvent.type(textarea, 'looks good');
    await userEvent.click(within(reviewSection).getByRole('button', { name: 'Approve' }));

    expect(await within(reviewSection).findByRole('alert')).toHaveTextContent('Already reviewed.');
    // API 실패는 필드 잘못이 아니므로 invalid로 마킹하지 않아야 한다.
    expect(textarea).not.toHaveAttribute('aria-invalid');
    // 형제 인스턴스에는 에러가 새지 않아야 한다.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // 이 페이지에서 손실 비용이 가장 큰 데이터다. 실패 시 반드시 보존되어야 한다.
    expect(textarea).toHaveValue('looks good');

    // API 실패 메시지는 실제 서버 결과이므로 재입력해도 지워지지 않아야 한다.
    await userEvent.type(textarea, '!');
    expect(within(reviewSection).getByRole('alert')).toHaveTextContent('Already reviewed.');
  });

  it('shows a failed submit inside the action panel, not only in the page banner', async () => {
    vi.mocked(api.submitChangeRequest).mockRejectedValue(new Error('Reviewer is required.'));
    renderPage();

    const submit = await screen.findByRole('button', { name: 'Request review' });
    await userEvent.click(submit);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reviewer is required.');
    // 포함 관계를 단언하지 않으면 상단 배너만으로도 통과해 인라인 배치를 전혀 증명하지 못한다
    // (프로토타입 실행에서 실제로 수정 전에도 통과함을 확인했다).
    expect(submit.closest('section')!.contains(alert)).toBe(true);
  });

  it('shows a failed assignee save inside the assignee panel', async () => {
    vi.mocked(api.setAssignees).mockRejectedValue(new Error('Approver not found.'));
    renderPage();

    const save = await screen.findByRole('button', { name: 'Update assignment' });
    await userEvent.click(save);

    const panel = save.closest('section') as HTMLElement;
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Approver not found.');
  });
});
