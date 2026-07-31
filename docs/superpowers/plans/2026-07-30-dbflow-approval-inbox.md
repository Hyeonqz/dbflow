# 결재 인박스 구현 계획 (E1 · E2 · E8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인하면 내가 결정해야 할 변경요청이 화면에 있게 만든다 — 대시보드 인박스, 사이드바 배지, 위임 표면화.

**Architecture:** 백엔드는 기존 `visibilityWhere`·`toSummary`를 재사용하는 별도 인박스 엔드포인트 하나와 요약·상세 응답의 가산적 필드 두 개만 추가한다. 프론트엔드는 `AppShell`에 인박스 컨텍스트를 두어 배지와 대시보드가 같은 fetch를 공유한다. 기존 `GET /change-requests` 계약과 KPI 카드·딥링크는 건드리지 않는다.

**Tech Stack:** NestJS 10 · Prisma 5 · MySQL 8 · Jest / Next.js 14 App Router · React 18 · next-intl 4.13 · Tailwind · Vitest + RTL

**설계 근거 문서:** [docs/superpowers/specs/2026-07-30-dbflow-approval-inbox-design.md](../specs/2026-07-30-dbflow-approval-inbox-design.md)

## Global Constraints

- **기준선 248개 테스트가 무수정 통과해야 한다** (api 221 + web 27). 기존 테스트를 고쳐야 한다면 계약을 깬 신호다.
- **`GET /change-requests`의 계약을 변경하지 않는다.** 인박스는 별도 엔드포인트다.
- **`myApprovalPending`의 계산을 바꾸지 않는다.** 조이면 APPROVER의 KPI 카드 카운트가 변한다.
- **인박스 술어는 `myApprovalPending && !alreadyActed`다.** `myApprovalPending`만 쓰면 SoD로 409가 나는 항목이 인박스에 뜨고 배지가 과다 계수한다.
- **`alreadyActed`는 private 헬퍼 하나로만 존재한다.** `toDetail`의 `iAlreadyActed`와 인박스 필터가 같은 함수를 호출한다. 불리언을 복제하면 두 곳이 갈라진다.
- **`useInbox()`는 provider 부재 시 throw하지 않고 기본값을 반환한다.** `useUser()`의 throw 패턴을 복사하면 CR 상세 테스트 19개가 전부 깨진다.
- **신규 i18n 키는 en·ko를 같은 태스크에서 함께 추가한다.** `messages.test.ts`가 정렬된 키 목록을 `toEqual`로 비교하므로 한쪽만 넣으면 반드시 실패한다.
- **테스트 파일에서 `describe`/`it`/`expect`/`vi`를 `vitest`에서 명시 import한다.** CI가 테스트 파일까지 `tsc --noEmit`한다.
- **api 스펙의 Prisma mock은 손으로 만든 것이고 `findMany`가 `orderBy`를 무시한다.** 정렬·윈도우 조건은 **호출 인자를 단언**해야 한다. 결과 배열의 순서를 단언하면 픽스처를 검사하는 공허한 테스트가 된다.
- **`git add`는 자기가 바�ान 파일만.** `git add -A`·`git commit -a` 금지 — 다른 작업자의 진행 중 문서가 트리에 있을 수 있다.
- 각 태스크는 자체 TDD 사이클을 완결하고 커밋 시점에 초록이어야 한다.

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `apps/web/lib/duration.ts` | 대기 기간 포맷 헬퍼 (일/시간/분 한 단위) |
| `apps/web/lib/duration.test.ts` | 경계값 단위 테스트 |
| `apps/web/components/inbox-context.tsx` | `InboxProvider` + `useInbox()` (비-throw 기본값) |
| `apps/web/components/inbox-context.test.tsx` | 기본값·refresh·조회 실패 degrade |
| `apps/web/components/sidebar.test.tsx` | 배지 렌더·접힘 aria·역할별 부재 |
| `apps/web/app/(app)/dashboard/page.test.tsx` | 인박스 섹션·빈 상태·위임 표시·개발자 막힌 지점 |

**수정**

| 파일 | 변경 |
|---|---|
| `apps/api/src/change-request/change-request.controller.ts` | `@Get('inbox')` — **`@Get(':id')`보다 위에** |
| `apps/api/src/change-request/change-request.service.ts` | `inbox()`, `alreadyActed()` 헬퍼, `SUMMARY_SELECT`에 `decidedById`, `toSummary`에 `delegatedFrom`, `findOne`+`toDetail`에 `delegatedTo` |
| `apps/api/src/change-request/change-request.service.spec.ts` | 신규 describe 블록 |
| `apps/web/lib/api.ts` | `listInbox()`, Summary에 `delegatedFrom`, Detail `Omit`에 추가, approver에 `delegatedTo` |
| `apps/web/components/app-shell.tsx` | `InboxProvider`로 감싸기 |
| `apps/web/components/sidebar.tsx` | 배지, 접힘 `relative`, 합성 `aria-label` |
| `apps/web/app/(app)/dashboard/page.tsx` | 인박스 섹션, 개발자 막힌 지점 줄 |
| `apps/web/app/(app)/change-requests/[id]/page.tsx` | 결재자 칩 "위임 중" 배지, `load` 후 `refresh()` |
| `apps/web/messages/en.json`, `ko.json` | 신규 키 (§10) |
| `docs/feature-checklist.md`, `docs/ROADMAP.md` | QA 항목, 1단계 완료 |

---

## Task 1: API 인박스 엔드포인트 + `alreadyActed` 헬퍼

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Modify: `apps/api/src/change-request/change-request.controller.ts`
- Test: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:**
- Produces:
  - `ChangeRequestService.inbox(user: AuthUser): Promise<Summary[]>` — `updatedAt` 오름차순
  - `private alreadyActed(approvers, currentUserId): boolean` — Task 2·3과 `toDetail`이 공유
  - `GET /change-requests/inbox`
  - `SUMMARY_SELECT.approvers.select`에 `decidedById: true` 추가 (응답에는 나가지 않음)

- [ ] **Step 1: 실패하는 테스트 작성**

`change-request.service.spec.ts` 끝에 추가한다. 기존 위임 통합 테스트(`describe('delegation…')`)와 SoD 테스트 사이 스타일을 따른다.

```ts
describe('inbox — 내가 지금 결정할 수 있는 것만', () => {
  const submitted = {
    id: 'cr-s', status: ChangeRequestStatus.SUBMITTED, authorId: 'u-dev',
    reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date('2026-07-01'),
    author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
  };
  const reviewApproved = {
    id: 'cr-a', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
    reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date('2026-07-02'),
    author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' },
    approvers: [{ userId: 'u-appr', decision: null, decidedById: null, user: { name: '결재자' } }],
  };

  it('REVIEWER에게 SUBMITTED만 준다 — 다른 상태 행을 섞어도 걸러진다', async () => {
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([submitted, reviewApproved]);
    const rows = await service.inbox({ userId: 'u-rev', role: Role.REVIEWER } as any);
    expect(rows.map((r) => r.id)).toEqual(['cr-s']);
  });

  it('updatedAt 오름차순을 쿼리 인자로 요구한다', async () => {
    // 이 스위트의 findMany mock은 orderBy를 무시하므로 결과 순서를 단언하면 픽스처를 검사하는 셈이다.
    const { service, findManyMock } = makeService();
    await service.inbox({ userId: 'u-rev', role: Role.REVIEWER } as any);
    expect(findManyMock.mock.calls[0][0].orderBy).toEqual({ updatedAt: 'asc' });
  });

  it('APPROVER에게 myApprovalPending 항목을 준다', async () => {
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([submitted, reviewApproved]);
    const rows = await service.inbox({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows.map((r) => r.id)).toEqual(['cr-a']);
  });

  it('SoD로 막힐 항목은 인박스에 없다 — 내가 다른 슬롯을 이미 결재한 경우', async () => {
    // myApprovalPending은 true이지만 approve()가 409로 거부하므로 인박스에 떠서는 안 된다.
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([
      {
        ...reviewApproved,
        approvers: [
          { userId: 'u-appr', decision: 'APPROVE', decidedById: null, user: { name: '결재자' } },
          { userId: 'u-other', decision: null, decidedById: null, user: { name: '위임자' } },
        ],
      },
    ]);
    delegationMock.activeDelegatorIds.mockResolvedValue(['u-other']);
    const rows = await service.inbox({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows).toEqual([]);
  });

  it('SoD로 막힐 항목은 인박스에 없다 — 내가 다른 슬롯을 대리 결재한 경우', async () => {
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([
      {
        ...reviewApproved,
        approvers: [
          { userId: 'u-x', decision: 'APPROVE', decidedById: 'u-appr', user: { name: '타인' } },
          { userId: 'u-appr', decision: null, decidedById: null, user: { name: '결재자' } },
        ],
      },
    ]);
    const rows = await service.inbox({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows).toEqual([]);
  });

  it('DEVELOPER·ADMIN에게는 빈 배열이고 Prisma를 호출하지 않는다', async () => {
    for (const role of [Role.DEVELOPER, Role.ADMIN]) {
      const { service, findManyMock } = makeService();
      const rows = await service.inbox({ userId: 'u-x', role } as any);
      expect(rows).toEqual([]);
      expect(findManyMock).not.toHaveBeenCalled();
    }
  });
});
```

`makeService`가 `findManyMock`을 반환하지 않으면 반환값에 추가한다(기존 테스트가 `findManyMock`을 쓰는 곳이 있으니 이미 노출돼 있을 수 있다 — 먼저 확인).

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @dbflow/api test change-request.service`
Expected: `service.inbox is not a function`으로 6개 실패.

- [ ] **Step 3: `SUMMARY_SELECT`에 `decidedById` 추가**

`change-request.service.ts`의 `SUMMARY_SELECT`:

```ts
  approvers: {
    orderBy: { order: 'asc' },
    // decidedById는 alreadyActed 판정에만 쓰이고 toSummary가 응답에 내보내지 않는다.
    select: { userId: true, decision: true, decidedById: true, user: { select: { name: true } } },
  },
```

- [ ] **Step 4: `alreadyActed` 헬퍼 추출**

`toDetail` 바로 위에 추가한다.

```ts
  /**
   * 이 사용자가 이 CR에서 이미 결정했는지(직접 또는 대리).
   * approve()의 SoD 게이트가 두 번째 결재를 409로 거부하므로, 인박스는 이 술어로 걸러야 한다.
   * toDetail의 iAlreadyActed와 동일 판정 — 두 곳이 갈라지지 않게 여기 하나만 둔다.
   */
  private alreadyActed(
    approvers: { userId: string; decision: unknown; decidedById: string | null }[],
    // string | undefined여야 한다. toDetail의 currentUserId는 optional이고 create()·
    // applyTransition()이 actor 없이 호출하므로, required로 바꾸거나 `!`·`?? ''`로 우회하면
    // 그 두 경로의 iAlreadyActed가 뒤집힌다(기존 단언 2건이 이를 잡는다).
    currentUserId?: string,
  ): boolean {
    return (
      approvers.some((a) => a.userId === currentUserId && a.decision !== null) ||
      approvers.some((a) => a.decidedById === currentUserId)
    );
  }
```

`toDetail`의 기존 인라인 계산을 이 헬퍼 호출로 교체한다:

```ts
    const actorAlreadyActed = this.alreadyActed(approvers, currentUserId);
```

- [ ] **Step 5: `inbox()` 구현**

`list()` 바로 아래에 추가한다.

```ts
  /**
   * "내가 지금 결정할 수 있는 것" 목록. 오래 기다린 순.
   * 필터를 toSummary 뒤에 두는 이유: myApprovalPending을 재구현하지 않고 그대로 써야
   * KPI 카드가 세는 집합과 갈라지지 않는다. SQL로 옮기면 두 판정이 분기한다.
   */
  async inbox(user: AuthUser) {
    // DEVELOPER·ADMIN은 결정할 것이 없다. visibilityWhere의 기본 분기는 실제 쿼리이므로 왕복을 아낀다.
    if (user.role !== Role.REVIEWER && user.role !== Role.APPROVER) return [];
    const delegatorIds = await this.delegatorIdsFor(user);
    const rows = await this.prisma.changeRequest.findMany({
      where: this.visibilityWhere(user, delegatorIds),
      orderBy: { updatedAt: 'asc' },
      select: SUMMARY_SELECT,
    });
    return rows
      .map((row) => ({ row, summary: this.toSummary(row, user.userId, delegatorIds) }))
      .filter(({ row, summary }) =>
        user.role === Role.REVIEWER
          ? summary.status === ChangeRequestStatus.SUBMITTED
          : summary.myApprovalPending && !this.alreadyActed(row.approvers, user.userId),
      )
      .map(({ summary }) => summary);
  }
```

- [ ] **Step 6: 컨트롤러에 라우트 추가**

`change-request.controller.ts`의 `@Get()` 바로 아래, **`@Get(':id')`보다 위에** 넣는다.

```ts
  // 주의: @Get(':id')보다 위에 있어야 한다. 아래에 두면 'inbox'가 :id로 캡처돼 404가 된다.
  @Get('inbox')
  inbox(@CurrentUser() user: CurrentUserPayload) {
    return this.service.inbox(user);
  }
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test`
Expected: 221 + 6 = 227개 통과. **기존 221개 중 하나도 수정하지 않았어야 한다.**
(Step 8의 supertest 1건을 더하면 228개가 된다.)

- [ ] **Step 8: 라우팅 순서를 잡는 supertest 1건 추가**

api 스위트에 컨트롤러 테스트가 0개라, `@Get('inbox')`를 `@Get(':id')` 아래에 두는 실수는
**다른 검출 수단이 없다** — 런타임 404가 되고 수동 QA만 발견한다. 기존 패턴을 따른다:
`apps/api/src/audit/audit-exception.filter.e2e-spec.ts`가 `@nestjs/testing` + `supertest`로
실제 HTTP 앱을 띄운다(둘 다 이미 설치돼 있다).

`apps/api/src/change-request/change-request.controller.e2e-spec.ts`를 만들고, JWT 가드와
`ChangeRequestService`를 오버라이드해 `inbox()`가 배열을 반환하도록 한 뒤 단언한다:

```ts
await request(app.getHttpServer())
  .get('/change-requests/inbox')
  .expect(200)
  .expect((res) => expect(Array.isArray(res.body)).toBe(true));
```

라우트가 `:id`에 잡히면 `detail()`이 호출돼 404 또는 다른 형태가 오므로 이 단언이 실패한다.

- [ ] **Step 9: 커밋**

```bash
git commit -m "feat(api): add an inbox endpoint that excludes SoD-blocked items" -- \
  apps/api/src/change-request/change-request.service.ts \
  apps/api/src/change-request/change-request.controller.ts \
  apps/api/src/change-request/change-request.service.spec.ts \
  apps/api/src/change-request/change-request.controller.e2e-spec.ts
```

---

## Task 2: API `delegatedFrom` (요약 응답)

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Test: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `SUMMARY_SELECT`(이미 `decidedById` 포함)
- Produces: `ChangeRequestSummary.delegatedFrom: string | null`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe('delegatedFrom — 위임으로 넘어온 항목만 표시', () => {
  it('개발자 자신의 목록에서는 항상 null이다', async () => {
    // delegatorIds가 []이므로 구조적으로 null. 역할별 규칙으로 쓰면 여기서 오염된다.
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([
      {
        id: 'cr-1', status: ChangeRequestStatus.SUBMITTED, authorId: 'u-dev',
        reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
        author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
      },
    ]);
    const rows = await service.list({ userId: 'u-dev', role: Role.DEVELOPER } as any);
    expect(rows[0].delegatedFrom).toBeNull();
  });

  it('SUBMITTED에서 검토자가 내 위임자면 그 이름을 준다', async () => {
    const { service, findManyMock } = makeService();
    delegationMock.activeDelegatorIds.mockResolvedValue(['u-rev']);
    findManyMock.mockResolvedValue([
      {
        id: 'cr-1', status: ChangeRequestStatus.SUBMITTED, authorId: 'u-dev',
        reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
        author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
      },
    ]);
    const rows = await service.list({ userId: 'u-other', role: Role.REVIEWER } as any);
    expect(rows[0].delegatedFrom).toBe('검토자');
  });

  it('SUBMITTED에서 검토자가 나 자신이면 null이다', async () => {
    const { service, findManyMock } = makeService();
    delegationMock.activeDelegatorIds.mockResolvedValue([]);
    findManyMock.mockResolvedValue([
      {
        id: 'cr-1', status: ChangeRequestStatus.SUBMITTED, authorId: 'u-dev',
        reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
        author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
      },
    ]);
    const rows = await service.list({ userId: 'u-rev', role: Role.REVIEWER } as any);
    expect(rows[0].delegatedFrom).toBeNull();
  });

  it('REVIEW_APPROVED에서 내 미결정 슬롯이 있으면 null(자기 슬롯 우선)', async () => {
    const { service, findManyMock } = makeService();
    delegationMock.activeDelegatorIds.mockResolvedValue(['u-deleg']);
    findManyMock.mockResolvedValue([
      {
        id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
        reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
        author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' },
        approvers: [
          { userId: 'u-appr', decision: null, decidedById: null, user: { name: '나' } },
          { userId: 'u-deleg', decision: null, decidedById: null, user: { name: '위임자' } },
        ],
      },
    ]);
    const rows = await service.list({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows[0].delegatedFrom).toBeNull();
  });

  it('REVIEW_APPROVED에서 내 슬롯이 없으면 위임자 슬롯(order 오름차순 첫) 이름', async () => {
    const { service, findManyMock } = makeService();
    delegationMock.activeDelegatorIds.mockResolvedValue(['u-d1', 'u-d2']);
    findManyMock.mockResolvedValue([
      {
        id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
        reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
        author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' },
        // SUMMARY_SELECT가 order asc로 정렬해 주므로 배열 순서가 곧 order다.
        approvers: [
          { userId: 'u-d1', decision: null, decidedById: null, user: { name: '위임자1' } },
          { userId: 'u-d2', decision: null, decidedById: null, user: { name: '위임자2' } },
        ],
      },
    ]);
    const rows = await service.list({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows[0].delegatedFrom).toBe('위임자1');
  });

  it('그 외 상태에서는 null이다', async () => {
    const { service, findManyMock } = makeService();
    delegationMock.activeDelegatorIds.mockResolvedValue(['u-rev']);
    findManyMock.mockResolvedValue([
      {
        id: 'cr-1', status: ChangeRequestStatus.APPLIED, authorId: 'u-dev',
        reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
        author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
      },
    ]);
    const rows = await service.list({ userId: 'u-other', role: Role.REVIEWER } as any);
    expect(rows[0].delegatedFrom).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @dbflow/api test change-request.service`
Expected: `delegatedFrom`이 `undefined`라 6개 중 "이름을 준다" 2건이 실패(null 기대 4건은 `undefined`가 `toBeNull()`에 걸려 함께 실패).

- [ ] **Step 3: 헬퍼 추가**

`toSummary` 바로 위에 넣는다.

```ts
  /**
   * 위임을 통해서만 내 범위에 든 항목의 위임자 이름. 내 것이면 null.
   * 역할이 아니라 delegatorIds로 판정하는 이유: 이 필드는 모든 역할이 같은 코드 경로로 받는
   * 요약 타입에 붙는다. 역할별 규칙으로 쓰면 개발자 자신의 CR이 전부 "위임"으로 표시된다.
   * delegatorIds는 REVIEWER·APPROVER가 아닌 역할에 []이므로 구조적으로 null이 된다.
   */
  private delegatedFromFor(
    row: SummaryPayload,
    currentUserId: string,
    delegatorIds: string[],
  ): string | null {
    if (!delegatorIds.length) return null;
    if (row.status === ChangeRequestStatus.SUBMITTED) {
      return delegatorIds.includes(row.reviewerId ?? '') ? row.reviewer?.name ?? null : null;
    }
    if (row.status === ChangeRequestStatus.REVIEW_APPROVED) {
      // approve()와 같은 우선순위: 자기 미결정 슬롯이 있으면 그것으로 결재하므로 위임이 아니다.
      if (row.approvers.some((a) => a.userId === currentUserId && a.decision === null)) return null;
      const viaDelegation = row.approvers.find(
        (a) => delegatorIds.includes(a.userId) && a.decision === null,
      );
      return viaDelegation?.user?.name ?? null;
    }
    return null;
  }
```

- [ ] **Step 4: `toSummary`에 필드 추가**

기존 반환 객체의 `myApprovalPending` 아래에 한 줄 추가한다. 다른 필드는 건드리지 않는다.

```ts
      delegatedFrom: this.delegatedFromFor(row, currentUserId, delegatorIds),
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test`
Expected: 233 + 6 = 239개 통과, 기존 테스트 무수정.

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(api): mark delegated items on the change-request summary" -- \
  apps/api/src/change-request/change-request.service.ts \
  apps/api/src/change-request/change-request.service.spec.ts
```

---

## Task 3: API `delegatedTo` (상세 응답의 결재자)

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Test: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:**
- Produces: 상세 응답 `approvers[].delegatedTo: string | null`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe('delegatedTo — 결재자가 현재 위임 중인지', () => {
  it('활성 위임 윈도우를 쿼리 인자로 요구한다', async () => {
    // mock이 빈 배열을 주면 만료 위임도 null이 되므로, 결과가 아니라 where를 단언해야 한다.
    const { service, prisma } = makeService({
      id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
    });
    prisma.changeRequest.findFirst.mockResolvedValue({
      id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
      reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
      author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, files: [],
      statusHistory: [],
      approvers: [
        { userId: 'u-a1', order: 0, decision: null, comment: null, decidedAt: null,
          decidedById: null, decidedBy: null, user: { name: '결재자1', department: 'IT' } },
      ],
    });
    prisma.delegation = { findMany: jest.fn().mockResolvedValue([]) };

    await service.findOne({ userId: 'u-a1', role: Role.APPROVER } as any, 'cr-1');

    const where = prisma.delegation.findMany.mock.calls[0][0].where;
    expect(where.delegatorId).toEqual({ in: ['u-a1'] });
    expect(where.startsAt).toHaveProperty('lte');
    expect(where.endsAt).toHaveProperty('gt');
  });

  it('결재자별로 대결자 이름을 붙인다', async () => {
    const { service, prisma } = makeService({
      id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
    });
    prisma.changeRequest.findFirst.mockResolvedValue({
      id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
      reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
      author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, files: [],
      statusHistory: [],
      approvers: [
        { userId: 'u-a1', order: 0, decision: null, comment: null, decidedAt: null,
          decidedById: null, decidedBy: null, user: { name: '결재자1', department: 'IT' } },
        { userId: 'u-a2', order: 1, decision: null, comment: null, decidedAt: null,
          decidedById: null, decidedBy: null, user: { name: '결재자2', department: 'IT' } },
      ],
    });
    prisma.delegation = {
      findMany: jest.fn().mockResolvedValue([
        { delegatorId: 'u-a1', delegate: { name: '대결자' } },
      ]),
    };

    const detail = await service.findOne({ userId: 'u-a1', role: Role.APPROVER } as any, 'cr-1');
    expect(detail.approvers.map((a: any) => a.delegatedTo)).toEqual(['대결자', null]);
  });

  it('겹치는 위임은 결정적으로 하나를 고른다(startsAt 내림차순 우선)', async () => {
    const { service, prisma } = makeService({
      id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
    });
    prisma.changeRequest.findFirst.mockResolvedValue({
      id: 'cr-1', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
      reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
      author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, files: [],
      statusHistory: [],
      approvers: [
        { userId: 'u-a1', order: 0, decision: null, comment: null, decidedAt: null,
          decidedById: null, decidedBy: null, user: { name: '결재자1', department: 'IT' } },
      ],
    });
    // Delegation에 유니크 제약이 없어 겹침이 가능하다. orderBy가 첫 행을 결정한다.
    prisma.delegation = {
      findMany: jest.fn().mockResolvedValue([
        { delegatorId: 'u-a1', delegate: { name: '최근' } },
        { delegatorId: 'u-a1', delegate: { name: '이전' } },
      ]),
    };

    const detail = await service.findOne({ userId: 'u-a1', role: Role.APPROVER } as any, 'cr-1');
    expect(detail.approvers[0].delegatedTo).toBe('최근');
    expect(prisma.delegation.findMany.mock.calls[0][0].orderBy).toEqual([
      { startsAt: 'desc' },
      { id: 'asc' },
    ]);
  });
});
```

`makeService`가 `prisma`를 반환하지 않으면 반환값에 추가한다.

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @dbflow/api test change-request.service`
Expected: `prisma.delegation.findMany`가 호출되지 않아 3개 실패.

- [ ] **Step 3: `toDetail` 시그니처에 옵셔널 파라미터 추가**

기존 호출부(create·submit·review·approve·setAssignees)를 깨지 않으려면 **옵셔널이어야 한다.**

```ts
  private toDetail(
    changeRequest: DetailPayload,
    currentUserId?: string,
    delegatorIds: string[] = [],
    delegateNameByDelegatorId: Map<string, string> = new Map(),
  ) {
```

approver 매핑에 한 줄 추가한다.

```ts
        decidedBy: a.decidedBy?.name ?? null,
        // 결정 전 위임 표시. 결정 후의 대리 표시는 위 decidedBy가 담당한다.
        delegatedTo: delegateNameByDelegatorId.get(a.userId) ?? null,
```

- [ ] **Step 4: `findOne`에서 활성 위임을 한 번에 조회**

`findOne`의 `if (!changeRequest) throw …` 뒤, `return this.toDetail(...)` 앞에 넣는다.

```ts
    // 결재자별 루프가 아니라 단일 쿼리. 겹치는 위임이 가능하므로 orderBy로 결정적으로 고른다.
    const approverIds = changeRequest.approvers.map((a) => a.userId);
    const now = new Date();
    const activeDelegations = approverIds.length
      ? await this.prisma.delegation.findMany({
          where: { delegatorId: { in: approverIds }, startsAt: { lte: now }, endsAt: { gt: now } },
          orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
          select: { delegatorId: true, delegate: { select: { name: true } } },
        })
      : [];
    const delegateNameByDelegatorId = new Map<string, string>();
    for (const d of activeDelegations) {
      if (!delegateNameByDelegatorId.has(d.delegatorId) && d.delegate?.name) {
        delegateNameByDelegatorId.set(d.delegatorId, d.delegate.name);
      }
    }
    return this.toDetail(changeRequest, user.userId, delegatorIds, delegateNameByDelegatorId);
```

**다른 `toDetail` 호출부는 그대로 둔다.** 액션 응답에서는 `delegatedTo`가 항상 null이지만, 상세 페이지는 액션 성공 후 `load()`로 `findOne`을 다시 호출하므로 화면에는 채워진 값이 온다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test`
Expected: 239 + 3 = 242개 통과, 기존 무수정.

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(api): annotate approvers with their current delegate" -- \
  apps/api/src/change-request/change-request.service.ts \
  apps/api/src/change-request/change-request.service.spec.ts
```

---

## Task 4: Web API 클라이언트

**Files:**
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Consumes: Task 1~3의 응답 필드
- Produces:
  - `listInbox(): Promise<ChangeRequestSummary[]>`
  - `ChangeRequestSummary.delegatedFrom: string | null`
  - `ChangeRequestApprover.delegatedTo: string | null`
  - `ChangeRequestDetail`의 `Omit`에 `delegatedFrom` 추가

- [ ] **Step 1: `ChangeRequestSummary`에 필드 추가**

```ts
  /** 위임을 통해서만 내 범위에 든 항목의 위임자 이름. 내 것이면 null. */
  delegatedFrom: string | null;
```

- [ ] **Step 2: `ChangeRequestDetail`의 `Omit`에 `delegatedFrom` 추가 — 같은 커밋에서**

`toDetail`은 이 필드를 만들지 않으므로, 빼지 않으면 타입이 응답에 없는 필드를 약속한다.

```ts
export type ChangeRequestDetail = Omit<
  ChangeRequestSummary,
  'approverNames' | 'approvalProgress' | 'myApprovalPending' | 'delegatedFrom'
> & {
```

⚠️ **이 스텝을 빠뜨리면 `tsc`가 `test/fixtures.ts`에서 실패한다** — 검수 중 실제로 실행해
확인된 사항이다. `makeCr()`이 `ChangeRequestDetail`로 타입되어 있고 web tsconfig가 `**/*.ts`를
포함하므로 픽스처도 타입 검사를 받는다.

**그때 픽스처를 고치거나 필드를 옵셔널로 만들지 말 것.** `delegatedFrom?: string | null`로
바꾸면 상세 페이지에서 `cr.delegatedFrom`이 항상 `undefined`인데도 타입이 통과한다.
**올바른 수정은 이 `Omit` 목록이며, 그러면 픽스처는 한 줄도 고칠 필요가 없다.**
`test/fixtures.ts`를 편집하고 싶어지는 순간이 곧 이 스텝을 놓쳤다는 신호다.

- [ ] **Step 3: `ChangeRequestApprover`에 `delegatedTo` 추가**

```ts
  /** 이 결재자가 현재 위임 중이면 대결자 이름(결정 전 표시). 결정 후는 decidedBy를 본다. */
  delegatedTo: string | null;
```

- [ ] **Step 4: `listInbox` 추가**

`listChangeRequests` 바로 아래에 넣는다.

```ts
/** 내가 지금 결정할 수 있는 변경요청만, 오래 기다린 순. */
export function listInbox() {
  return apiFetch<ChangeRequestSummary[]>('/change-requests/inbox');
}
```

- [ ] **Step 5: 타입 검사·빌드 확인**

Run:
```bash
pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web test
```
Expected: tsc 0, web 27개 통과(변경 없음).

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(web): add the inbox client call and delegation fields" -- apps/web/lib/api.ts
```

---

## Task 5: i18n 문자열 + 대기 기간 헬퍼

**Files:**
- Create: `apps/web/lib/duration.ts`
- Create: `apps/web/lib/duration.test.ts`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/ko.json`

**Interfaces:**
- Produces: `formatWaitDuration(sinceIso: string, now: Date, t): string`

**en·ko를 반드시 같은 커밋에 넣는다** — `messages.test.ts`가 정렬된 키 목록을 비교하므로 한쪽만 넣으면 실패한다.

- [ ] **Step 1: 실패하는 테스트 작성 — `apps/web/lib/duration.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { waitUnit } from '@/lib/duration';

describe('waitUnit', () => {
  const base = new Date('2026-07-30T12:00:00Z');
  const ago = (ms: number) => new Date(base.getTime() - ms).toISOString();
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it('24시간 이상은 일 단위', () => {
    expect(waitUnit(ago(3 * DAY), base)).toEqual({ unit: 'days', count: 3 });
  });
  it('정확히 24시간은 1일', () => {
    expect(waitUnit(ago(DAY), base)).toEqual({ unit: 'days', count: 1 });
  });
  it('1시간 이상 24시간 미만은 시간 단위', () => {
    expect(waitUnit(ago(5 * HOUR), base)).toEqual({ unit: 'hours', count: 5 });
  });
  it('1시간 미만은 분 단위', () => {
    expect(waitUnit(ago(7 * MIN), base)).toEqual({ unit: 'minutes', count: 7 });
  });
  it('1분 미만도 0이 아니라 1분으로 보여준다', () => {
    expect(waitUnit(ago(3_000), base)).toEqual({ unit: 'minutes', count: 1 });
  });
  it('미래 시각(시계 오차)도 1분으로 클램프한다', () => {
    expect(waitUnit(new Date(base.getTime() + 5 * MIN).toISOString(), base)).toEqual({
      unit: 'minutes', count: 1,
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @dbflow/web test duration`
Expected: `Failed to resolve import "@/lib/duration"`.

- [ ] **Step 3: `apps/web/lib/duration.ts` 작성**

```ts
export type WaitUnit = { unit: 'days' | 'hours' | 'minutes'; count: number };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * 인박스 행의 대기 기간을 한 단위로만 환산한다("3일 5시간"처럼 합성하지 않는다 — 행이 좁다).
 * 전역 상대시간 도입(로드맵 G6)이 아니라 인박스 전용 최소 헬퍼다.
 */
export function waitUnit(sinceIso: string, now: Date = new Date()): WaitUnit {
  const elapsed = now.getTime() - new Date(sinceIso).getTime();
  // 서버·클라이언트 시계 오차로 음수가 될 수 있다. "0분 대기"보다 "1분 대기"가 정직하다.
  const ms = Math.max(elapsed, MIN);
  if (ms >= DAY) return { unit: 'days', count: Math.floor(ms / DAY) };
  if (ms >= HOUR) return { unit: 'hours', count: Math.floor(ms / HOUR) };
  return { unit: 'minutes', count: Math.max(1, Math.floor(ms / MIN)) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/web test duration`
Expected: 6개 통과.

- [ ] **Step 4b: ko 카탈로그를 실제로 렌더하는 테스트 1건 추가**

⚠️ **현재 어떤 테스트도 ko를 렌더하지 않는다.** `renderWithIntl`은 en 카탈로그를 하드코딩하고,
카탈로그 대칭 테스트는 키 *이름*만 비교한다. 따라서 ko의 ICU 본문이 깨져도 초록으로 배포된다.
그리고 §10의 ko plural이 이 프로젝트의 **첫 plural**이다 — 선례가 없어 문법 오류를 잡아줄 것이
아무것도 없다.

`apps/web/lib/duration.test.ts`에 추가한다:

```ts
import { createTranslator } from 'next-intl';
import ko from '@/messages/ko.json';
import en from '@/messages/en.json';

describe('duration strings render in both locales', () => {
  it('ko renders the plural bodies', () => {
    const t = createTranslator({ locale: 'ko', messages: ko, namespace: 'common' });
    expect(t('duration.days', { count: 3 })).toBe('3일');
    expect(t('duration.hours', { count: 5 })).toBe('5시간');
    expect(t('duration.minutes', { count: 7 })).toBe('7분');
  });

  it('en pluralizes one vs other', () => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'common' });
    expect(t('duration.days', { count: 1 })).toBe('1 day');
    expect(t('duration.days', { count: 3 })).toBe('3 days');
  });
});
```

이 테스트는 Step 5·6에서 카탈로그에 키를 넣은 뒤 통과한다.

- [ ] **Step 5: `en.json`에 키 추가**

`dashboard` 네임스페이스에:
```json
"inbox": {
  "title": "Waiting on you",
  "empty": "No change requests are waiting on your decision.",
  "waitingFor": "waiting {duration}",
  "delegatedFrom": "Delegated from {name}"
},
"blocked": {
  "draft": "Waiting to be submitted — your turn",
  "review": "Waiting for review by {name}",
  "approval": "Awaiting approval {approved}/{required}",
  "rejected": "Rejected",
  "apply": "Waiting to be applied"
}
```

`common` 네임스페이스에:
```json
"duration": {
  "days": "{count, plural, one {# day} other {# days}}",
  "hours": "{count, plural, one {# hour} other {# hours}}",
  "minutes": "{count, plural, one {# minute} other {# minutes}}"
}
```

`nav` 네임스페이스에:
```json
"inboxBadgeAria": "{count} awaiting your decision"
```

`changeRequestDetail` 네임스페이스에:
```json
"delegatingNow": "Delegating"
```

- [ ] **Step 6: `ko.json`에 같은 키 추가**

`dashboard`:
```json
"inbox": {
  "title": "내 결정 대기",
  "empty": "결정 대기 중인 변경요청이 없습니다.",
  "waitingFor": "{duration} 대기",
  "delegatedFrom": "위임: {name} 대리"
},
"blocked": {
  "draft": "제출 대기 — 당신 차례입니다",
  "review": "검토 대기: {name}",
  "approval": "결재 대기 {approved}/{required}",
  "rejected": "반려됨",
  "apply": "적용 대기"
}
```

`common`:
```json
"duration": {
  "days": "{count, plural, other {#일}}",
  "hours": "{count, plural, other {#시간}}",
  "minutes": "{count, plural, other {#분}}"
}
```

`nav`: `"inboxBadgeAria": "결재 대기 {count}건"`
`changeRequestDetail`: `"delegatingNow": "위임 중"`

- [ ] **Step 7: 전체 확인**

Run: `pnpm --filter @dbflow/web test && pnpm --filter @dbflow/web exec tsc --noEmit`
Expected: 27 + 8 = 35개 통과. **카탈로그 대칭 테스트가 통과해야 한다** — 실패하면 한쪽 카탈로그에 키가 빠졌다.

- [ ] **Step 8: 커밋**

```bash
git commit -m "feat(web): add inbox strings and a wait-duration helper" -- \
  apps/web/lib/duration.ts apps/web/lib/duration.test.ts \
  apps/web/messages/en.json apps/web/messages/ko.json
```

---

## Task 6: `InboxProvider` 컨텍스트

**Files:**
- Create: `apps/web/components/inbox-context.tsx`
- Create: `apps/web/components/inbox-context.test.tsx`
- Modify: `apps/web/components/app-shell.tsx`
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx`

**Interfaces:**
- Consumes: `listInbox()` (Task 4)
- Produces: `useInbox(): { items, count, loading, refresh }` — **provider 없으면 throw하지 않고 기본값**

- [ ] **Step 0: `makeSummary()` 픽스처 추가 — `apps/web/test/fixtures.ts`**

인박스 항목은 `ChangeRequestSummary`이고 기존 `makeCr()`은 `ChangeRequestDetail`을 반환한다.
두 타입은 서로의 부분집합이 아니므로 **`makeCr()`을 인박스 항목으로 쓸 수 없다.**
`makeCr()`은 **건드리지 않고** 새 팩토리를 추가한다.

```ts
export function makeSummary(over: Partial<ChangeRequestSummary> = {}): ChangeRequestSummary {
  return {
    id: 'cr1',
    title: 'Add index on orders',
    targetEnv: 'DEV',
    status: 'SUBMITTED',
    authorId: 'u-dev',
    authorName: 'Dev',
    reviewerId: 'u-rev',
    reviewerName: 'Rev',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    approverNames: [],
    approvalProgress: { approved: 0, required: 0 },
    myApprovalPending: false,
    delegatedFrom: null,
    ...over,
  };
}
```

`ChangeRequestSummary`를 `import type`에 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성 — `apps/web/components/inbox-context.test.tsx`**

```tsx
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
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @dbflow/web test inbox-context`
Expected: `Failed to resolve import "@/components/inbox-context"`.

- [ ] **Step 3: `apps/web/components/inbox-context.tsx` 작성**

```tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { listInbox, type ChangeRequestSummary } from '@/lib/api';
import type { User } from '@/lib/auth';

type InboxCtx = {
  items: ChangeRequestSummary[];
  count: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * provider가 없을 때 throw하지 않는다 — useUser()와 의도적으로 다르다.
 * CR 상세 페이지의 기존 테스트들은 컴포넌트를 단독 렌더하므로 provider가 없고,
 * throw하면 그 테스트 전부가 깨진다.
 */
const DEFAULT: InboxCtx = { items: [], count: 0, loading: false, refresh: async () => {} };

const InboxContext = createContext<InboxCtx>(DEFAULT);

/** 결정 권한이 없는 역할은 조회 자체를 하지 않는다(빈 배열이 확정). */
function canDecide(role: User['role']) {
  return role === 'REVIEWER' || role === 'APPROVER';
}

export function InboxProvider({ user, children }: { user: User; children: ReactNode }) {
  const [items, setItems] = useState<ChangeRequestSummary[]>([]);
  const [loading, setLoading] = useState(canDecide(user.role));

  const refresh = useCallback(async () => {
    if (!canDecide(user.role)) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await listInbox());
    } catch {
      // 사이드바는 모든 페이지에 있다. 여기서 에러를 띄우면 사용자가 하려는 일과
      // 무관한 배너가 전 화면에 붙는다. 잘못된 숫자보다 없는 숫자가 안전하다.
      // 이 컨텍스트는 error 필드를 의도적으로 노출하지 않는다 — 대시보드에는 error 상태가
      // 하나뿐이고 items가 null인 동안 그것이 세면 본문 전체가 빈 화면이 된다.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user.role]);

  useEffect(() => {
    // reactStrictMode에서 effect가 두 번 돈다. 대시보드·목록 화면과 같은 active 가드.
    let active = true;
    void (async () => {
      if (!canDecide(user.role)) {
        if (active) setLoading(false);
        return;
      }
      try {
        const next = await listInbox();
        if (active) setItems(next);
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user.role]);

  return (
    <InboxContext.Provider value={{ items, count: items.length, loading, refresh }}>
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox(): InboxCtx {
  return useContext(InboxContext);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/web test inbox-context`
Expected: 5개 통과.

- [ ] **Step 5: `AppShell`에 provider 마운트 — 반환 트리 전체를 감싼다**

⚠️ **`{children}`만 감싸면 안 된다.** `AppShell`은 루트 div 안에 세 형제를 렌더한다:
데스크톱 `<aside>`(Sidebar), 모바일 드로어(두 번째 Sidebar), `<main>{children}</main>`.
`{children}`만 감싸면 **두 Sidebar가 provider 밖에 남아** 배지가 비-throw 기본값 0을 영구히
읽는다. 그리고 Step 3의 기본값 때문에 **에러도 나지 않고 어떤 테스트도 실패하지 않는다.**

`if (!ready || !user) return …` **아래**의 `return (`을 통째로 감싼다(사용자가 확정된 뒤에만
조회하게 하려면 조기 반환 아래여야 한다).

```tsx
  return (
    <InboxProvider user={user}>
      <div className="min-h-screen lg:flex">
        {/* …기존 내용 그대로… */}
      </div>
    </InboxProvider>
  );
```

import를 추가한다: `import { InboxProvider } from '@/components/inbox-context';`

- [ ] **Step 6: CR 상세에서 액션 성공 후 `refresh()` 호출**

`page.tsx`의 `load` 콜백을 감싼다. 이미 `onDone`으로 모든 액션에 전달되고 있으므로 한 곳만 고치면 된다.

```tsx
  const { refresh: refreshInbox } = useInbox();

  const afterAction = useCallback(async () => {
    await load();
    // 방금 처리한 항목이 배지에 남으면 사용자가 카운트를 신뢰하지 않게 된다.
    await refreshInbox();
  }, [load, refreshInbox]);
```

`AssigneePanel`·`ActionPanel`의 `onDone={load}`를 `onDone={afterAction}`으로 바꾼다.
`ApplyPanel`의 `onApplied`와 `ExecutionHistory`의 `onRolledBack`은 이미 `load()`를 포함한 별도 콜백이므로 거기에도 `refreshInbox()`를 추가한다.

- [ ] **Step 7: provider 배선을 증명하는 테스트 추가**

Step 5의 실수(=`{children}`만 감싸기)는 조용히 실패하므로, **`AppShell`을 렌더하는 테스트가
유일한 검출 수단이다.** `Sidebar`만 렌더하는 테스트로는 잡히지 않는다.

`apps/web/components/app-shell.test.tsx`:

```tsx
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
    renderWithIntl(<AppShell><p>body</p></AppShell>);
    expect(await screen.findByText('2')).toBeInTheDocument();
  });
});
```

이 테스트는 Task 7(배지 렌더)이 끝난 뒤에야 통과한다. Task 6에서 작성해 **red로 두고**,
Task 7의 검증 스텝에서 초록이 되는 것을 확인한다 — 두 태스크를 잇는 유일한 배선 증명이다.

- [ ] **Step 8: 전체 확인**

Run:
```bash
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web build
```
Expected: `app-shell.test.tsx`의 1건은 Task 7까지 red. 나머지 35 + 5 = 40개 통과.
**CR 상세의 기존 19개가 무수정 통과해야 한다** — 깨지면 `useInbox`가 throw하고 있다.

- [ ] **Step 9: 커밋**

`app-shell.test.tsx`가 아직 red이므로 **이 태스크는 Task 7과 한 커밋으로 묶는다.** Task 6의
변경을 스테이징만 해두고 커밋하지 않은 채 Task 7로 진행한 뒤, Task 7의 검증이 초록이 되면
함께 커밋한다. (커밋 시점에 초록이어야 한다는 규율을 지키는 방법이다.)

```bash
# Task 7 검증이 초록이 된 뒤 실행
git commit -m "feat(web): share the inbox through a context and badge it in the sidebar" -- \
  apps/web/components/inbox-context.tsx apps/web/components/inbox-context.test.tsx \
  apps/web/components/app-shell.tsx apps/web/components/app-shell.test.tsx \
  apps/web/components/sidebar.tsx apps/web/components/sidebar.test.tsx \
  apps/web/test/fixtures.ts "apps/web/app/(app)/change-requests/[id]/page.tsx"
```

---

## Task 7: 사이드바 배지 + 탭 타이틀

**Files:**
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/inbox-context.tsx` (탭 타이틀 effect)
- Create: `apps/web/components/sidebar.test.tsx`

**Interfaces:**
- Consumes: `useInbox()` (Task 6), `nav.inboxBadgeAria` (Task 5)

- [ ] **Step 1: 실패하는 테스트 작성 — `apps/web/components/sidebar.test.tsx`**

```tsx
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
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @dbflow/web test sidebar`
Expected: 4개 중 3개 실패(배지가 없음). "0이 아니다"는 이미 통과 — 회귀 가드다.

- [ ] **Step 3: 사이드바에 배지 추가**

`sidebar.tsx` 상단에 import를 추가한다: `import { useInbox } from '@/components/inbox-context';`

컴포넌트 본문에:

```tsx
  const { count: inboxCount } = useInbox();
  const canDecide = user.role === 'REVIEWER' || user.role === 'APPROVER';
```

nav 매핑을 아래로 바꾼다. **접힌 모드에서 `relative`를 추가**하고 **`aria-label`을 합성**한다.

```tsx
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
          const showBadge = canDecide && inboxCount > 0 && it.href === '/change-requests';
          const badgeText = showBadge ? t('inboxBadgeAria', { count: inboxCount }) : '';
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? t(it.labelKey) : undefined}
              // 접힘 모드: Link의 aria-label이 하위 트리의 접근 가능한 이름을 대체하므로
              // 배지에 라벨을 붙이면 절대 읽히지 않는다. 여기서 합성한다.
              aria-label={
                collapsed
                  ? showBadge
                    ? `${t(it.labelKey)}, ${badgeText}`
                    : t(it.labelKey)
                  : undefined
              }
              className={`focusable flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? 'relative justify-center' : ''
              } ${active ? 'bg-primary text-white' : 'text-muted hover:bg-subtle hover:text-ink'}`}
            >
              <it.Icon className="shrink-0" />
              {!collapsed && <span>{t(it.labelKey)}</span>}
              {showBadge && (
                <span
                  // 펼침 모드에서는 배지가 접근 가능한 이름에 기여해야 하므로 라벨을 준다.
                  aria-label={collapsed ? undefined : badgeText}
                  className={
                    collapsed
                      ? 'absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-card'
                      : 'ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-white'
                  }
                >
                  {inboxCount}
                </span>
              )}
            </Link>
          );
        })}
```

접힘 모드에서 `active`일 때 배지 링(`ring-card`)이 파란 배경과 겹치는데, 아이콘 레일이 좁아 실용상 문제되지 않는다.

- [ ] **Step 4: 탭 타이틀 미러링을 provider에 추가**

`inbox-context.tsx`에 추가한다. `usePathname()`이 deps에 있어야 한다 — Next가 내비게이션마다 metadata를 다시 내보내므로 `count`만 의존하면 첫 이동에서 타이틀이 되돌아가고 provider는 계속 마운트돼 있어 다시 실행되지 않는다.

```tsx
import { usePathname } from 'next/navigation';
// …
  const pathname = usePathname();
  useEffect(() => {
    document.title = items.length > 0 ? `(${items.length}) DBFlow` : 'DBFlow';
    return () => {
      document.title = 'DBFlow';
    };
  }, [items.length, pathname]);
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/web test`
Expected: 40 + 1(app-shell 초록 전환) + 4 = 45개 통과.

- [ ] **Step 6: 전체 확인 후 Task 6과 함께 커밋**

```bash
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web build
```
Expected: **`app-shell.test.tsx`가 이제 초록이 된다** — Task 6의 provider 배선이 옳았다는 증명이다.
red로 남으면 provider가 `{children}`만 감싸고 있다.

그 뒤 Task 6 Step 9의 커밋 명령을 실행한다.

---

## Task 8: 대시보드 인박스 섹션

**Files:**
- Modify: `apps/web/app/(app)/dashboard/page.tsx`
- Create: `apps/web/app/(app)/dashboard/page.test.tsx`

**Interfaces:**
- Consumes: `useInbox()`(Task 6), `waitUnit`(Task 5), `dashboard.inbox.*`·`dashboard.blocked.*`(Task 5)

- [ ] **Step 1: 실패하는 테스트 작성 — `apps/web/app/(app)/dashboard/page.test.tsx`**

Task 3(0단계)에서 만든 스캐폴딩 패턴을 그대로 쓴다: `vi.hoisted` 라우터 mock, `@/lib/api`는 `importOriginal` 스프레드, auth는 mock하지 않고 `localStorage` 시딩.

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
    renderWithIntl(<Dashboard />);
    const section = (await screen.findByRole('heading', { name: 'Waiting on you' })).closest('section') as HTMLElement;
    const link = within(section).getByRole('link', { name: /Old one/ });
    expect(link).toHaveAttribute('href', '/change-requests/cr-old');
    expect(within(section).getByText(/waiting/)).toBeInTheDocument();
  });

  it('keeps the section and shows an empty state when nothing is waiting', async () => {
    renderWithIntl(<Dashboard />);
    const section = (await screen.findByRole('heading', { name: 'Waiting on you' })).closest('section') as HTMLElement;
    expect(within(section).getByText('No change requests are waiting on your decision.')).toBeInTheDocument();
  });

  it('marks a delegated item with the delegator name', async () => {
    inbox.value = {
      ...inbox.value,
      items: [makeSummary({ id: 'cr-d', title: 'Routed', delegatedFrom: '김검토' })],
    };
    renderWithIntl(<Dashboard />);
    expect(await screen.findByText(/Delegated from 김검토/)).toBeInTheDocument();
  });

  it('shows no inbox section for a developer', async () => {
    signIn(makeUser({ role: 'DEVELOPER' }));
    renderWithIntl(<Dashboard />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { name: 'Waiting on you' })).toBeNull();
  });

  it("labels a developer's own requests with what blocks them", async () => {
    signIn(makeUser({ role: 'DEVELOPER' }));
    vi.mocked(api.listChangeRequests).mockResolvedValue([
      makeSummary({ id: 'cr-1', title: 'Mine', status: 'SUBMITTED', reviewerName: '김검토' }),
    ]);
    renderWithIntl(<Dashboard />);
    expect(await screen.findByText('Waiting for review by 김검토')).toBeInTheDocument();
  });
});
```

인박스 항목은 Task 6에서 만든 `makeSummary()`를 쓴다 — `makeCr()`은 `ChangeRequestDetail`을
반환하므로 인박스 항목으로 쓸 수 없다. **`makeCr()`에 `delegatedFrom`을 추가하지 말 것**:
Task 4가 `Omit`에 넣었으므로 `ChangeRequestDetail`에는 그 필드가 없고, 추가하면 초과 속성으로
`tsc`가 깨진다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @dbflow/web test dashboard`
Expected: 인박스 섹션이 없어 4개 실패, 개발자 인박스 부재는 통과(회귀 가드).

- [ ] **Step 3: 대시보드에 인박스 섹션 추가**

`dashboard/page.tsx`의 KPI 카드 그리드 **위**, 요약 문장 아래에 넣는다. 개발자·관리자에게는 렌더하지 않는다.

⚠️ **`items !== null && (…)` 분기 안에 넣지 말 것.** 카드와 최근 목록은 그 조건 안에 있는데,
인박스를 거기 넣으면 **전체 목록이 도착할 때까지 인박스가 안 보인다** — 인박스 응답이 더 작은데도.
"로그인하면 일이 화면에 있다"는 목표가 무너진다. 그 분기 **밖에서** 자체 상태로 렌더한다.

```tsx
  const { items: inboxItems } = useInbox();
  const canDecide = user?.role === 'REVIEWER' || user?.role === 'APPROVER';
```

```tsx
      {canDecide && (
        <section className="mt-6">
          <h2 className="text-base font-semibold text-ink">{t('inbox.title')}</h2>
          {inboxItems.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('inbox.empty')}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {inboxItems.map((cr) => {
                const w = waitUnit(cr.updatedAt);
                return (
                  <li key={cr.id}>
                    <Link
                      href={`/change-requests/${cr.id}`}
                      className="focusable flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-card px-4 py-3 ring-1 ring-border transition-colors hover:bg-subtle"
                    >
                      <span className="font-medium text-ink">{cr.title}</span>
                      <EnvBadge env={cr.targetEnv} />
                      <time dateTime={cr.updatedAt} className="text-xs text-muted">
                        {t('inbox.waitingFor', { duration: tCommon(`duration.${w.unit}`, { count: w.count }) })}
                      </time>
                      {cr.delegatedFrom && (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                          {t('inbox.delegatedFrom', { name: cr.delegatedFrom })}
                        </span>
                      )}
                      <StatusBadge status={cr.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
```

필요한 import: `useInbox`, `waitUnit`, `useTranslations('common')`을 `tCommon`으로.

- [ ] **Step 4: 개발자용 "막힌 지점" 줄 추가**

기존 "최근" 목록의 각 행에, 개발자일 때만 한 줄을 덧붙인다.

```tsx
/** §4 표 — 요약 필드만으로 파생. APPLIED는 막힌 것이 아니므로 표시하지 않는다. */
function blockedLabel(
  cr: ChangeRequestSummary,
  t: ReturnType<typeof useTranslations<'dashboard'>>,
  unassigned: string,
): string | null {
  switch (cr.status) {
    case 'DRAFT':
      return t('blocked.draft');
    case 'SUBMITTED':
      return t('blocked.review', { name: cr.reviewerName ?? unassigned });
    case 'REVIEW_APPROVED':
      return t('blocked.approval', {
        approved: cr.approvalProgress.approved,
        required: cr.approvalProgress.required,
      });
    case 'REVIEW_REJECTED':
    case 'FINAL_REJECTED':
      return t('blocked.rejected');
    case 'FINAL_APPROVED':
      return t('blocked.apply');
    default:
      return null;
  }
}
```

최근 목록 행 안에서:
```tsx
{user.role === 'DEVELOPER' && blockedLabel(cr, t, tEnum('unassigned')) && (
  <p className="text-xs text-muted">{blockedLabel(cr, t, tEnum('unassigned'))}</p>
)}
```
`unassigned` 문자열은 기존 카탈로그에 있는 키를 재사용한다 — 없으면 `dashboard.blocked` 아래에 추가하고 en·ko 양쪽에 넣는다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/web test`
Expected: 45 + 5 = 50개 통과.

- [ ] **Step 6: 전체 확인**

```bash
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web build && \
pnpm --filter @dbflow/api test
```
Expected: tsc 0, build 성공, api 242개 통과.

- [ ] **Step 7: 커밋**

`test/fixtures.ts`가 스테이징 목록에 **없다** — 이 태스크는 픽스처를 건드리지 않는다.

```bash
git commit -m "feat(web): surface the pending-decision inbox on the dashboard" -- \
  "apps/web/app/(app)/dashboard/page.tsx" "apps/web/app/(app)/dashboard/page.test.tsx"
```

---

## Task 9: 문서 갱신

**Files:**
- Modify: `docs/feature-checklist.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: QA 항목 추가 — `docs/feature-checklist.md`**

`## 3. 대시보드` 절에 추가한다(파일의 기존 체크박스 스타일을 따를 것):

```markdown
- [ ] 검토자/결재자 대시보드 상단에 "내 결정 대기" 섹션이 있고, 오래 기다린 항목이 위에 온다
- [ ] 각 행에 대기 기간(예: "3일 대기")이 표시되고 클릭하면 해당 CR 상세로 이동한다
- [ ] 대기 항목이 없으면 섹션은 유지되고 빈 상태 문구가 보인다
- [ ] 위임으로 넘어온 항목에 "위임: {이름} 대리"가 표시된다
- [ ] 개발자 대시보드에는 인박스 섹션이 없고, 최근 목록 각 행에 막힌 지점이 표시된다
- [ ] 사이드바 "변경요청"에 대기 건수 배지가 뜨고, 0이면 아무것도 표시되지 않는다
- [ ] 사이드바를 접어도 배지가 보이고, 스크린리더가 "변경요청, 결재 대기 N건"을 읽는다
- [ ] 브라우저 탭 타이틀에 "(N) DBFlow"가 표시되고, 다른 메뉴로 이동해도 유지된다
- [ ] 결재를 완료하면 배지 숫자가 즉시 줄어든다
- [ ] 한 CR에서 이미 결재한 사람에게는 그 CR이 인박스에 보이지 않는다(SoD)
- [ ] CR 상세에서 현재 위임 중인 결재자 칩에 "위임 중"이 표시된다
```

- [ ] **Step 2: `docs/ROADMAP.md`의 1단계 완료 처리**

`### 1단계 — 결재 인박스 슬라이스` 아래 E1·E2·E8을 `[x]`로 바꾸고, **E3는 체크하지 않고** 2단계 F1로 이월했음을 한 줄로 남긴다. 다른 절은 건드리지 않는다.

- [ ] **Step 3: 커밋**

```bash
git commit -m "docs: record stage-1 inbox completion and its QA items" -- \
  docs/feature-checklist.md docs/ROADMAP.md
```

---

## 최종 검증

```bash
pnpm --filter @dbflow/api test       # 242개 (221 기존 + 5 되찾은 e2e + 16 신규), 기존 무수정
pnpm --filter @dbflow/web test       # 50개 (27 기존 + 23 신규), 기존 무수정
pnpm --filter @dbflow/web exec tsc --noEmit
pnpm --filter @dbflow/web build
```

수동 QA: `./start.sh` 후 `docs/feature-checklist.md`에 추가한 11개 항목. seed 계정 3개
(`dev@` / `dba@` / `approver@`, 비번 `password1234`)로 역할별 확인.

## 스펙 대비 확인

| 스펙 | 태스크 |
|---|---|
| §2-1 SoD 제외 술어 | Task 1 (헬퍼 공유 + 테스트 2건) |
| §5 `updatedAt` 오름차순 | Task 1 (쿼리 인자 단언) |
| §5-1 `setAssignees` 한계 | 코드 변경 없음 — 스펙에 기록된 수용 사항 |
| §6-1 인박스 쿼리·조기 반환 | Task 1 |
| §6-2 `delegatedFrom` | Task 2 |
| §6-3 `delegatedTo` 단일 쿼리·tie-break | Task 3 |
| §7-1 비-throw 기본값·실패 degrade | Task 6 |
| §7-2 배지·접힘 aria·탭 타이틀 pathname | Task 7 |
| §7-3 인박스 상단 배치·카드 유지 | Task 8 |
| §8 접근성(`<time>`, 텍스트 위임 표시) | Task 8 |
| §9 무회귀 12조건 | 각 태스크의 검증 스텝 + 최종 검증 |
| §10 i18n en·ko 동시 | Task 5 |
| §11 공허하지 않은 단언 | Task 1·3 (인자 단언), Task 8 (containment) |
| §9-13 최근 목록 행이 사라지지 않음 | Task 8 Step 4 (줄만 덧붙이고 필터하지 않음) |
| §9-14 provider가 트리 전체를 감쌈 | Task 6 Step 5·7 (AppShell 테스트가 유일한 검출) |
| §9-15 헬퍼가 `string \| undefined` | Task 1 Step 4 |
| §9-16 라우팅 순서 supertest | Task 1 Step 8 |
| §9-17 타이틀 effect는 provider에 | Task 7 Step 4 |
| §9-18 StrictMode `active` 가드 | Task 6 Step 3 |
| §9-19 섹션이 `items !== null` 밖 · provider는 error 미노출 | Task 8 Step 3, Task 6 Step 3 |
| §11 ko 렌더 테스트 | Task 5 Step 4b |
