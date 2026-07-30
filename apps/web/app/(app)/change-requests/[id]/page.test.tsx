import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from '@/test/render-with-intl';
// Task 4~6이 이 파일에 테스트를 덧붙이면서 makeTargetDb·makeExecution·makeBackup을 추가로 import한다.
import { makeBackup, makeCr, makeExecution, makeLint, makeTargetDb, makeUser } from '@/test/fixtures';

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

// The page wires its refresh() (not load()) into afterAction so a just-approved
// item stops lingering in the sidebar badge. Spy on refresh so a decision test
// can assert that wiring without pulling in the real InboxProvider/API.
const { inboxRefresh } = vi.hoisted(() => ({ inboxRefresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/inbox-context', () => ({
  useInbox: () => ({ items: [], count: 0, loading: false, refresh: inboxRefresh }),
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
    // 형제 인스턴스(같은 섹션 안의 결재용 DecisionAction)에는 에러가 새지 않아야 한다.
    expect(within(reviewSection).getAllByRole('alert')).toHaveLength(1);
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

describe('apply panel', () => {
  /** 결재자가 최종 승인된 PROD CR을 보는 상태 — 적용 게이트가 열려 있다. */
  function signInForProdApply() {
    signIn(makeUser({ id: 'u-appr', role: 'APPROVER', name: 'Appr' }));
    vi.mocked(api.getChangeRequest).mockResolvedValue(
      makeCr({ targetEnv: 'PROD', status: 'FINAL_APPROVED' }),
    );
    vi.mocked(api.listTargetDatabases).mockResolvedValue([
      makeTargetDb({ id: 'db-prod', name: 'orders-prod', env: 'PROD' }),
    ]);
  }

  /** 결재자가 DEV CR을 보는 상태 — DEV는 최종 승인 전에도 적용할 수 있다. */
  function signInForDevApply() {
    signIn(makeUser({ id: 'u-appr', role: 'APPROVER', name: 'Appr' }));
    vi.mocked(api.getChangeRequest).mockResolvedValue(makeCr({ targetEnv: 'DEV', status: 'DRAFT' }));
    vi.mocked(api.listTargetDatabases).mockResolvedValue([makeTargetDb()]);
  }

  async function selectTargetDb(name: string) {
    await userEvent.selectOptions(await screen.findByLabelText(/Target database/), [
      screen.getByRole('option', { name: new RegExp(name) }),
    ]);
  }

  it('blocks apply on PROD when the lint result cannot be loaded, and offers a retry', async () => {
    signInForProdApply();
    vi.mocked(api.lintChangeRequest).mockRejectedValue(new Error('Request failed. (500)'));
    renderPage();

    await selectTargetDb('orders-prod');

    expect(await screen.findByRole('status')).toHaveTextContent('cannot be applied');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('does not block apply on DEV when the lint result cannot be loaded', async () => {
    // 서버가 DEV의 BLOCK을 WARN으로 강등하므로 DEV에서 린트는 게이트가 아니다.
    signInForDevApply();
    vi.mocked(api.lintChangeRequest).mockRejectedValue(new Error('Request failed. (500)'));
    renderPage();

    await selectTargetDb('orders-dev');

    // DEV 문구는 "적용할 수 없습니다"가 아니라 "위험 구문이 표시되지 않는다"여야 한다 —
    // 적용 버튼이 활성인 채로 반대 문구를 띄우면 알림 자체가 신뢰를 잃는다.
    expect(await screen.findByRole('status')).toHaveTextContent('will not be flagged');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('re-enables apply after a successful lint retry', async () => {
    signInForProdApply();
    vi.mocked(api.lintChangeRequest)
      .mockRejectedValueOnce(new Error('Request failed. (500)'))
      .mockResolvedValue(makeLint({ targetEnv: 'PROD' }));
    renderPage();

    await selectTargetDb('orders-prod');
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a dry-run failure inside the dry-run section, not next to Apply', async () => {
    signInForProdApply();
    vi.mocked(api.dryRunChangeRequest).mockRejectedValue(new Error('Connection refused.'));
    renderPage();

    await selectTargetDb('orders-prod');
    const runDryRun = screen.getByRole('button', { name: 'Run dry-run' });
    await userEvent.click(runDryRun);

    // bg-subtle은 dry-run 래퍼(DryRunSection 루트)에만 붙어 있어 조상 중 유일하게 매칭된다.
    const dryRunBox = runDryRun.closest('div[class*="bg-subtle"]') as HTMLElement;
    expect(await within(dryRunBox).findByRole('alert')).toHaveTextContent('Connection refused.');
    // 적용 버튼 옆이 아니라 dry-run 영역 안에 있어야 한다.
    const applyButton = screen.getByRole('button', { name: 'Apply' });
    expect(dryRunBox.contains(applyButton)).toBe(false);
    // ApplyPanel 안에 중복 렌더되지 않고 alert가 정확히 하나여야 한다.
    const applyPanel = applyButton.closest('section') as HTMLElement;
    expect(within(applyPanel).getAllByRole('alert')).toHaveLength(1);
  });
});

describe('apply history notices', () => {
  /** 결재자 + 실행 이력 1건 — ExecutionHistory 섹션이 렌더되는 최소 조건. */
  function signInWithHistory() {
    signIn(makeUser({ id: 'u-appr', role: 'APPROVER', name: 'Appr' }));
    vi.mocked(api.getChangeRequest).mockResolvedValue(
      makeCr({ targetEnv: 'DEV', status: 'APPLIED' }),
    );
    vi.mocked(api.listExecutions).mockResolvedValue([makeExecution()]);
    vi.mocked(api.listBackups).mockResolvedValue([makeBackup()]);
  }

  it('warns when the backup list could not be loaded', async () => {
    signInWithHistory();
    vi.mocked(api.listBackups).mockRejectedValue(new api.ApiError(500, 'Request failed. (500)'));
    renderPage();

    expect(await screen.findByRole('status')).toHaveTextContent('Could not load the backup list');
  });

  it('stays silent when the backup list is forbidden for this role', async () => {
    signInWithHistory();
    vi.mocked(api.listBackups).mockRejectedValue(new api.ApiError(403, 'Forbidden'));
    renderPage();

    // 섹션 자체는 렌더되어야 "알림 없음"이 의미를 갖는다(섹션이 통째로 없으면 공허한 단언).
    expect(await screen.findByRole('heading', { name: /Apply history/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the history could not be loaded instead of showing a zero count', async () => {
    signInWithHistory();
    vi.mocked(api.listExecutions).mockRejectedValue(new Error('Request failed. (500)'));
    vi.mocked(api.listBackups).mockRejectedValue(new api.ApiError(500, 'Request failed. (500)'));
    renderPage();

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('does not mean the change was never applied');
    // "적용 이력 (0)"은 §4-3이 없애려는 바로 그 거짓 음성이다.
    const historyHeading = screen.getByRole('heading', { name: 'Apply history' });
    expect(historyHeading).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Apply history \(0\)/ })).toBeNull();
    // 이력을 못 불러온 상황에서 백업 알림은 중복이자 무의미하다(섹션 안에서만 확인).
    const historySection = historyHeading.closest('section') as HTMLElement;
    expect(within(historySection).getAllByRole('status')).toHaveLength(1);
  });

  it('re-enables the rollback button after a successful rollback', async () => {
    signInWithHistory();
    vi.spyOn(window, 'confirm').mockReturnValue(true); // jsdom 미구현 — 스텁하지 않으면 롤백이 실행되지 않는다
    vi.mocked(api.rollbackExecution).mockResolvedValue(makeExecution({ id: 'ex2', kind: 'ROLLBACK' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Rollback' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rollback' })).toBeEnabled());
  });

  it('shows a failed rollback inside its own execution card, not only in the page banner', async () => {
    signInWithHistory();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.rollbackExecution).mockRejectedValue(new Error('Backup expired.'));
    renderPage();

    const rollback = await screen.findByRole('button', { name: 'Rollback' });
    await userEvent.click(rollback);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Backup expired.');
    // ExecutionCard의 루트는 <article>이다. 포함 관계 없이는 상단 배너만으로 통과한다
    // (프로토타입 실행에서 실제로 수정 전에도 통과함을 확인했다).
    expect(rollback.closest('article')!.contains(alert)).toBe(true);
  });
});

describe('stale content banner', () => {
  // 이 태스크에서 마지막 onError 작성자가 사라지므로, 이제 상단 배너에 도달하는 에러는
  // 로드 실패뿐이다. 그래야 "갱신 실패" 접두가 사실과 일치한다.
  it('tells the user the screen is stale when a post-action refresh fails', async () => {
    vi.mocked(api.getChangeRequest)
      .mockResolvedValueOnce(makeCr())
      .mockRejectedValue(new Error('Request failed. (500)'));
    vi.mocked(api.submitChangeRequest).mockResolvedValue(makeCr());

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }));

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('may be out of date');
    expect(banner).toHaveTextContent('Request failed. (500)');
    expect(screen.getByRole('heading', { name: 'Add index on orders' })).toBeInTheDocument();
  });

  it('does not claim staleness when the very first load fails', async () => {
    vi.mocked(api.getChangeRequest).mockRejectedValue(new Error('Request failed. (500)'));
    renderPage();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Request failed. (500)');
    // 아직 아무것도 못 불러왔으므로 "아래 내용이 낡았다"고 말할 대상이 없다.
    expect(banner).not.toHaveTextContent('may be out of date');
  });
});

describe('inbox refresh wiring', () => {
  it('calls useInbox().refresh() after a successful decision, so the badge drops the item', async () => {
    vi.mocked(api.submitChangeRequest).mockResolvedValue(makeCr({ status: 'SUBMITTED' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }));

    await waitFor(() => expect(inboxRefresh).toHaveBeenCalled());
  });
});
