# 부재 위임 (Approval Delegation) 설계

> 2026-07-20. Tier-2 A1의 첫 슬라이스. 브레인스토밍 확정판.
> 근거: docs/roadmap-tier2-candidates.md A1 — ITIL 결재 위임/OOO. 에스컬레이션·SLA 리마인더·실제 알림 발송은 A1 후속(스케줄러·알림 채널 인프라가 없어 별도 슬라이스).

## 1. 목표와 원칙

검토자/결재자가 **부재 기간** 동안 **대리인**에게 권한을 위임해, 부재로 승인 절차가 멈추지 않게 한다.

- **기간형 부재 위임**: `delegator`가 `[startsAt, endsAt)` 동안 `delegate`에게 위임. 그 기간에 대리인은 위임자가 지정된 CR을 대신 검토/결재.
- **행위 시점 판정, 스케줄러 없음** — 작업창/동결과 동일 패턴. 기간은 **KST 벽시계**(`+09:00` 변환), 활성 조건 `startsAt <= now < endsAt`.
- **책임 추적 보존(비전 핵심)**: 대리 행위는 **실제 행위자(대리인)와 위임자** 모두 추적된다 — (a) 감사 로그 metadata(`onBehalfOf`/`delegatedFrom`), (b) 결재 슬롯의 `decidedById`(실제 클릭한 대리인), (c) StatusHistory.comment에 "(위임: {위임자명} 대리)" 주석. **StatusHistory 스키마 컬럼은 추가하지 않는다**(comment 주석으로 CR 타임라인에 표기 — critic I1). 위임은 승인 단계를 건너뛰지 않는다 — 지정 인원 수(만장일치)·역할 게이트 그대로.
- **역할 동일 강제 + 행위 시점 재검증**: 대리인은 위임자와 **같은 역할**(REVIEWER↔REVIEWER, APPROVER↔APPROVER)이어야 한다(생성 시 검증). 행위 시점엔 컨트롤러 `@Roles` 가드 + JWT 전략의 매 요청 DB 역할 재조회로 **대리인의 현재 역할이 재검증**되므로, 위임자가 나중에 강등돼도 이미 생성된 슬롯 기반 판정엔 영향 없음(critic 4b clear). 위임이 role 자격을 우회하지 않는다.
- 사용자 확정 사항: 기간형 / 결재자+검토자 both / 본인+ADMIN 등록 / 재위임(위임의 위임) 금지.

## 2. 데이터 모델 (Prisma)

```prisma
model Delegation {
  id          String   @id @default(cuid())
  delegatorId String   // 부재자(REVIEWER 또는 APPROVER)
  delegateId  String   // 대리인(같은 역할)
  startsAt    DateTime
  endsAt      DateTime
  reason      String?
  createdById String   // 등록자(본인 또는 ADMIN)
  createdAt   DateTime @default(now())

  delegator User @relation("delegator", fields: [delegatorId], references: [id])
  delegate  User @relation("delegate", fields: [delegateId], references: [id])
  createdBy User @relation("delegationCreator", fields: [createdById], references: [id])

  @@index([delegatorId])
  @@index([delegateId])
  @@map("delegation")
}
```

- `User`에 역관계 3개 추가: `delegationsGiven Delegation[] @relation("delegator")`, `delegationsReceived Delegation[] @relation("delegate")`, `delegationsCreated Delegation[] @relation("delegationCreator")`.
- `ChangeRequestApprover`에 `decidedById String?` 추가 + `decidedBy User? @relation("approverDecider", fields:[decidedById], references:[id])`(역관계 `User.approverDecisions ChangeRequestApprover[] @relation("approverDecider")`). **직접 결재면 null, 대리 결재면 실제 행위자 id.** 진행률 계산엔 무영향(decision 기준 그대로).
- `StatusHistory`는 **변경 없음**(comment 주석으로 위임 표기 — critic I1).
- 데이터 마이그레이션 불필요(신규 테이블 1 + nullable 컬럼 1, 기본값으로 무회귀).

## 3. 판정 & 통합

`DelegationService`(주입) 헬퍼(모두 `this.prisma`, `now = new Date()`):
- `activeDelegatorIds(delegateId: string): Promise<string[]>` — 지금 이 사람이 대리 가능한 위임자 id 목록. `where: { delegateId, startsAt: {lte: now}, endsAt: {gt: now} }` → `delegatorId[]`.
- `isActiveDelegateFor(delegateId, delegatorId): Promise<boolean>` — 특정 위임자에 대한 활성 대리 여부.

> **트랜잭션 주의**: `approve()`는 CR 행에 `FOR UPDATE`를 건다. Delegation 행은 이 임계구역에서 변경되지 않으므로, 위 헬퍼가 `this.prisma`(비-tx)로 읽어도 정확성 문제 없음(위임 행은 CR 락과 무관한 독립 데이터). 슬롯 재조회·기록은 모두 tx 안. 락 범위를 넓히지 않기 위해 delegatorIds 읽기만 tx 밖 허용.

### (critic C1) 가시성 확장 — 대리인이 CR을 볼 수 있어야 함
현재 `visibilityWhere`는 APPROVER=`{approvers:{some:{userId:me}}}`, REVIEWER=`{reviewerId:me}` — 대리인은 **둘 다 아님**이라 `list()`·`findOne()`에서 CR이 안 보인다(§5 UI 불가능). 따라서:
- `list(user)`·`findOne(user, id)`는 **먼저 `activeDelegatorIds(user.userId)`를 resolve**하고, 그 결과를 `visibilityWhere`에 OR로 합친다. **`status:{not:DRAFT}`는 최상위에서 AND**(각 OR 가지 안이 아님 — 안 그러면 대리인이 위임자의 DRAFT를 봄, critic Minor1):
  - REVIEWER 뷰: `{ OR: [{ reviewerId: me }, { reviewerId: { in: delegatorIds } }], status: { not: DRAFT } }`
  - APPROVER 뷰: `{ OR: [{ approvers: { some: { userId: me } } }, { approvers: { some: { userId: { in: delegatorIds } } } }], status: { not: DRAFT } }`
- `visibilityWhere`가 현재 동기 함수이므로, **비동기 resolve한 delegatorIds를 인자로 넘기는 형태로 변경**(`visibilityWhere(user, delegatorIds)`). 호출부(`list`/`findOne`) 2곳이 `await activeDelegatorIds` 후 전달.
- **역할 가드(critic Minor4)**: 대리인은 항상 REVIEWER/APPROVER이므로, `user.role`이 그 둘이 아니면 `activeDelegatorIds` 쿼리를 건너뛰고 `[]` 사용(DEVELOPER/ADMIN 목록 호출마다 무의미 쿼리 방지).
- **무회귀**: 위임 0건 → `delegatorIds = []` → OR의 `{ in: [] }` 가지는 매칭 0이므로 기존 쿼리와 동일 결과.

### review() 통합 (+ critic I2: FOR UPDATE 하드닝)
현재 `review()`는 락 없이 `getOrThrow`→`applyTransition`. 대리로 **서로 다른 두 사람**(직접 검토자 + 활성 대리인)이 동시에 review 가능해지면 이중 전이 레이스가 실질화된다. 따라서 `approve()`와 동일하게 **인터랙티브 tx + `FOR UPDATE` + 상태·권한 재확인**으로 전환. **권한(reviewerId)·위임자 이름 조회는 모두 tx 안**(critic Minor2 TOCTOU 방지, Major2 이름 소스):
```ts
async review(actor, id, dto) {
  const action = dto.decision === Decision.APPROVE ? 'REVIEW_APPROVE' : 'REVIEW_REJECT';
  await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ChangeRequest WHERE id = ${id} FOR UPDATE`;
    const cr = await tx.changeRequest.findUnique({ where: { id }, select: { id: true, status: true, reviewerId: true } });
    if (!cr) throw new NotFoundException('변경요청을 찾을 수 없습니다.');
    const rid = cr.reviewerId;
    const isDirect = rid === actor.userId;
    const isDelegate = !isDirect && !!rid && (await this.delegation.isActiveDelegateFor(actor.userId, rid)); // 비-tx 읽기 OK(위임 행은 락 무관)
    if (!isDirect && !isDelegate) throw new ForbiddenException('지정된 검토자 또는 활성 대리인만 검토할 수 있습니다.');
    const toStatus = getNextStatus(cr.status, action); // 이미 전이됨(SUBMITTED 아님)이면 throw → 이중 검토 차단
    const delegatorName = isDelegate ? (await tx.user.findUnique({ where: { id: rid! }, select: { name: true } }))?.name ?? null : null;
    await tx.changeRequest.update({ where: { id }, data: { status: toStatus } });
    await tx.statusHistory.create({ data: { changeRequestId: id, fromStatus: cr.status, toStatus,
      actorId: actor.userId, comment: withDelegateNote(dto.comment, delegatorName) } });
    await tx.auditLog.create({ data: this.audit.buildData({ actor, action: AuditAction.CR_REVIEWED,
      targetType: AuditTargetType.CHANGE_REQUEST, targetId: id,
      summary: `검토 ${action==='REVIEW_APPROVE'?'승인':'반려'} (CR ${id})`,
      metadata: { fromStatus: cr.status, toStatus, comment: dto.comment ?? undefined,
                  onBehalfOf: isDelegate ? rid : undefined } }) }); // 기존 fromStatus/toStatus 키 보존(critic Minor3)
  });
  return this.findOne(actor, id);
}
```
- `withDelegateNote(comment, name)`: 대리면 `${comment ? comment + ' ' : ''}(위임: ${name} 대리)`, 아니면 `comment ?? null` — StatusHistory comment에 위임 표기(critic I1). `name`이 null이면 위임 주석 생략.
- 감사 metadata는 **기존 `{fromStatus,toStatus,comment}` 키를 보존**하고 `onBehalfOf`만 추가(consumer 무회귀).
- 기존 `applyTransition`은 `submit()` 전용으로 존치(변경 없음). review만 인터랙티브 tx로 분리.

### approve() 통합 (직접 슬롯 우선, 없으면 위임 슬롯 — FOR UPDATE 하에서)
기존 `approve()` tx 구조(FOR UPDATE → status 체크)를 **유지**하고, `mine` 판정만 확장:
```ts
const delegatorIds = await this.delegation.activeDelegatorIds(actor.userId); // tx 밖 읽기 허용(위임 행은 CR 락 무관)
const authorId = await this.prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM ChangeRequest WHERE id = ${id} FOR UPDATE`;
  const cr = await tx.changeRequest.findUnique({ where: { id }, select: { id: true, status: true, authorId: true } });
  if (!cr) throw new NotFoundException('변경요청을 찾을 수 없습니다.');
  if (cr.status !== ChangeRequestStatus.REVIEW_APPROVED) throw new ConflictException(`현재 상태(${cr.status})에서는 결재할 수 없습니다.`);

  const mine = await tx.changeRequestApprover.findUnique({
    where: { changeRequestId_userId: { changeRequestId: id, userId: actor.userId } } });
  let slot = mine && mine.decision === null ? mine : null;
  let onBehalfOf: string | null = null;
  let delegatorName: string | null = null;
  if (!slot && delegatorIds.length) {
    const del = await tx.changeRequestApprover.findFirst({    // tx 안 재조회 → 락 하에서 미결정 확인(레이스 없음)
      where: { changeRequestId: id, userId: { in: delegatorIds }, decision: null }, orderBy: { order: 'asc' },
      include: { user: { select: { name: true } } } });   // 위임자 이름 소스(critic Major2)
    if (del) { slot = del; onBehalfOf = del.userId; delegatorName = del.user?.name ?? null; }
  }
  if (!slot) {
    if (mine && mine.decision !== null) throw new ConflictException('이미 결재하셨습니다.');
    throw new ForbiddenException('지정된 결재자 또는 활성 대리인만 결재할 수 있습니다.');
  }
  await tx.changeRequestApprover.update({ where: { id: slot.id },
    data: { decision, comment: dto.comment ?? null, decidedAt: new Date(), decidedById: onBehalfOf ? actor.userId : null } });
  // …이하 진행률/전이/StatusHistory/audit는 기존과 동일. 전이 시 StatusHistory.comment=withDelegateNote(dto.comment, onBehalf명),
  //   audit metadata에 delegatedFrom: onBehalfOf(있을 때만) 추가.
  return cr.authorId;
});
return this.findOne({ userId: authorId, role: Role.DEVELOPER }, id);
```
- 진행률·전이(`approved === all.length`, REJECT→즉시 반려)는 기존 그대로(슬롯의 decision 기준).
- 전이 발생 시 StatusHistory.actorId = 실제 행위자(actor.userId), comment=`withDelegateNote(dto.comment, delegatorName)`. 감사 metadata에 기존 `{decision,progress,comment}` + `delegatedFrom: onBehalfOf`(있을 때만).
- **부분 승인(전이 없음)엔 StatusHistory가 안 남는다**(기존 동작) — 이 경우 대리 책임추적은 슬롯 `decidedById` + 감사 `delegatedFrom`으로만 보존(둘 다 durable). §1의 comment 주석은 전이 발생 행위(review/최종전이 approve)에만 적용됨을 명시.
- **엣지**: 대리인 Y가 자기 직접 슬롯도 갖고 위임 슬롯도 가진 경우 → 직접 슬롯 먼저(우선순위). 다음 approve 호출에서 위임 슬롯 처리. 각 호출 1슬롯이라 모호성 없음.

### (critic 미비점) 대시보드/목록 대기 표시
`toSummary(row, currentUserId)`의 `myApprovalPending`은 `status === REVIEW_APPROVED && approvers.some(a => a.userId === currentUserId && decision===null)`이라 대리 CR엔 안 켜진다. **가시성(C1)으로 목록에는 뜨지만 "결재 대기" 뱃지/카운터가 0**이면 대리인이 인지 못 함. → `toSummary(row, currentUserId, delegatorIds)`로 **현재 뷰어의 activeDelegatorIds를 전달**(list가 C1에서 이미 resolve하므로 재사용)해 확장. **status 게이트를 벗어나지 않게 그룹화(critic Major1)**:
```ts
myApprovalPending:
  rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
  approvers.some(a => (a.userId === currentUserId || delegatorIds.includes(a.userId)) && a.decision === null)
```
`(A && B) || X`가 아니라 `A && (B || X)` — 검토중(SUBMITTED) CR엔 대리 대기 뱃지가 안 켜진다. 대시보드 "결재 대기" 카드가 대리 대기 건도 반영.

## 4. 관리 API (`delegation` 모듈, approval-policy 패턴 준용)

| 라우트 | 권한 | 용도 |
|---|---|---|
| `GET /delegations` | 로그인 공통 | 본인이 위임자/대리인인 건 + **ADMIN은 전체**. `{ id, delegator{name,role}, delegate{name,role}, startsAt, endsAt, reason, createdBy{name} }[]` |
| `POST /delegations` | 로그인 공통 | 본인 위임(`delegatorId` 생략/무시 → 나) / **ADMIN은 `delegatorId` 지정해 타인 대리 등록** |
| `DELETE /delegations/:id` | 위임자 본인 또는 ADMIN | 해제(그 외 403) |

- 컨트롤러 레벨 `@Roles` 금지(GET·POST 로그인 공통). ADMIN 분기는 서비스 내부에서(`createdById`/권한 판정).
- DTO 검증: `delegateId` 필수, `delegatorId` optional(ADMIN만 의미), `startsAt`/`endsAt` KST 벽시계 문자열(`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/`, `+09:00` 변환), `reason` ≤200 optional.
- 서비스 검증(`createDelegation`):
  1. 비-ADMIN은 `delegatorId`를 항상 self로 강제(요청의 `delegatorId`는 무시). ADMIN만 타인 `delegatorId` 지정 가능.
  2. `delegateId === delegatorId` → 400 '자기 자신에게 위임할 수 없습니다.'
  3. `startsAt < endsAt` → 아니면 400.
  4. delegator·delegate 역할 로드: 둘 다 존재하고 `delegator.role === delegate.role` 且 role ∈ {REVIEWER, APPROVER} → 아니면 400 '위임자와 대리인은 같은 역할(검토자 또는 결재자)이어야 합니다.'
- 감사: 생성/해제 → `DELEGATION_UPDATED`(metadata: `op: CREATE|DELETE`, delegatorId, delegateId, startsAt, endsAt).

## 5. 프론트

- **`/delegations` 페이지**("부재 위임", 사이드바 — 전 역할 노출? 아니면 REVIEWER/APPROVER/ADMIN? → **REVIEWER·APPROVER·ADMIN 노출**, DEVELOPER 제외):
  - 로그인 사용자: 자기 위임 목록(등록/해제). 등록 폼 = 대리인 셀렉트(자기 역할과 **같은 역할 사용자만** 필터: `listUsersByRole(myRole)`, 자기 제외) + 기간(`datetime-local` 2개) + 사유.
  - ADMIN: 전체 목록 + 위임자 셀렉트(REVIEWER/APPROVER)와 대리인 셀렉트(선택된 위임자와 같은 역할)까지 지정.
  - sql-review/apply-schedule 페이지 패턴(에러 배너, 재조회, 토큰) 재사용.
- **CR 상세**:
  - 내가 활성 대리인이면 검토/결재 버튼 노출(직접 지정자와 동일 UI) + "위임 결재" 뱃지.
  - 결재자 리스트: 위임 결정 행은 "Y (X 대리)"로 표기(`decidedBy` 있을 때). **(critic M2)** `DETAIL_INCLUDE.approvers.select`에 `decidedById: true` + `decidedBy: { select: { name: true } }` 추가, `toDetail`의 `approvers.map`에 `decidedBy: a.decidedBy?.name ?? null` 평탄화 추가.
  - 프론트가 "내가 활성 대리인인지"를 알아야 버튼을 그린다 → 상세 응답에 `canActAsDelegate: boolean` 포함(서버 판정, UI 단순). **판정식(critic Minor5, findOne이 C1에서 이미 resolve한 delegatorIds 재사용, 추가 쿼리 없음)**:
    - 검토 대리: `status === SUBMITTED && reviewerId ∈ delegatorIds` (뷰어가 직접 검토자면 false — 직접 UI로 처리)
    - 결재 대리: `status === REVIEW_APPROVED && approvers.some(a => delegatorIds.includes(a.userId) && a.decision === null)`
    - `canActAsDelegate = (검토 대리) || (결재 대리)`. 뷰어가 직접 지정자인 슬롯은 기존 직접 버튼 로직이 처리하므로 이 플래그는 **순수 대리 케이스만** true(직접+대리 중복 시 직접 버튼 우선).

## 6. 감사 & 열거형

- `AuditAction` += `DELEGATION_UPDATED`. `AuditTargetType` += `DELEGATION`.
- 대리 검토/결재는 기존 `CR_REVIEWED`/`CR_APPROVED`에 metadata `onBehalfOf`/`delegatedFrom` 추가(별도 액션 아님).
- 감사 페이지 필터 옵션에 `DELEGATION_UPDATED`·`DELEGATION` 추가.

## 7. 테스트

- **DelegationService 유닛**(`new Service(mockPrisma, mockAudit)`): 활성 기간 경계(startsAt==now 활성, endsAt==now 비활성), `activeDelegatorIds` 필터, 역할 불일치 400, 자기위임 400, `startsAt>=endsAt` 400, KST 변환, 비-ADMIN self 강제.
- **change-request 유닛**: review 대리 경로 통과(비지정·비대리 403)·review FOR UPDATE 하드닝, approve 직접 슬롯 우선→위임 슬롯, 대리 결재 시 `decidedById` 세팅·진행률 무영향·감사 `delegatedFrom`, 이미 결재+위임슬롯 없음 → 409, **가시성 OR(대리인이 위임 CR을 list/findOne에서 봄)**, `myApprovalPending` 대리 확장.
  - 생성자 **4번째 인자(delegation mock)** 추가 — 기존 `new ChangeRequestService(prisma, audit, policy)` 호출부 **전부** 갱신(spec.ts 8곳: 79,304,465,553,610,631,652,671,681행 부근). `ChangeRequestModule`에 **`DelegationModule` import**(exports `DelegationService`) 추가 — 현재 imports `[PassportModule, ApprovalPolicyModule]` (critic M1).
- **API**: ADMIN 타인 등록/비-ADMIN self 강제, DELETE 권한(위임자/ADMIN만), DTO 검증.
- 라이브 E2E + 체크리스트 §12.

## 8. 비범위 (명시)

- **에스컬레이션·SLA 리마인더·실제 알림 발송**(스케줄러/텔레그램/이메일) — A1 후속.
- **재위임**(대리인이 다시 위임) 금지 — approve/review 판정은 delegator 직접 지정자만 대상.
- **위임 중첩 우선순위** — 한 위임자에 복수 활성 대리인 허용, 슬롯은 order 순 첫 미결정건. 대리인 관점에선 아무 활성 위임이나 유효.
- **중복 위임행 제약 없음** — 동일 X→Y 겹침 행 여러 개 허용(`in` dedup으로 무해, critic M3). 의도적 무제약.
- **CR별 슬롯 위임** — 기간형만(특정 CR 지정 위임 아님).
- **역할 강등 시 잔여 위임행 정리** — 안 함(행위 시점 @Roles 가드가 차단하므로 무해).
- **직무분리(SoD) 강제 — 이번 슬라이스 비범위(수용된 시맨틱, 최종 리뷰 Minor#1)**: 결재자 P1이 같은 CR의 공동 결재자 P2의 활성 대리인이면, P1이 자기 슬롯(직접) + P2 슬롯(대리)을 각각 채워 2인 만장일치를 **한 사람**이 충족할 수 있다. 이는 OOO 위임의 의도된 동작이며 **완전히 감사됨**(P2 슬롯 `decidedById=P1` + 감사 `delegatedFrom`). 단, 규제 환경(금융·공공)에서 SoD가 규정 통제인 경우, "이미 직접 슬롯을 결정한 행위자는 같은 CR의 대리 슬롯을 채울 수 없다"는 옵션 가드가 필요할 수 있음 — **후속 결정 사항**(기본값은 감사 기반 허용).

## 9. 성공 기준

1. 결재자 X가 본인 부재 위임(D1~D2, 대리인 Y=APPROVER) 등록 → 기간 중 Y가 X 지정 CR을 결재하면 X 슬롯이 채워지고 `decidedBy=Y`로 기록, 진행률 정상.
2. 검토자 부재 위임 → 대리인이 검토 승인/반려 가능, 감사에 `onBehalfOf` 기록.
3. 역할 다른 대리인 지정 → 400. 자기 위임 → 400. 기간 밖에는 대리 결재 403.
4. ADMIN이 타인 부재 위임 등록 가능, 비-ADMIN은 self로만.
5. 위임 등록/해제가 감사(`DELEGATION_UPDATED`)에 남고 필터로 조회.
6. 위임이 지정 인원 수·역할 게이트를 우회하지 않음(만장일치 유지, 역할 강제).
7. 위임 0건이면 기존 검토/결재 동작 그대로(무회귀).
