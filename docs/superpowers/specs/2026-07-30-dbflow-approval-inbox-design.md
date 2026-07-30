# 결재 인박스 설계 (E1 · E2 · E8)

> 작성 2026-07-30. UX 로드맵 **1단계**([roadmap-ux-candidates.md](../../refactor/roadmap-ux-candidates.md) §E, [ROADMAP.md](../../ROADMAP.md) "UX 기능 개발 리스트").
> 규모: **M** (로드맵은 S로 추정했으나 백엔드 전수 탐색 결과 상향 — §2 참조).
> 검수 이력: 스펙 비평(ACCEPT WITH CHANGES) — myApprovalPending이 SoD로 막힌 항목을 포함한다는
> 치명적 오류, setAssignees가 대기 시계를 리셋한다는 반증, delegatedFrom 규칙이 개발자 목록을
> 오염시킨다는 지적, useInbox가 기존 테스트 19개를 깬다는 예측을 반영한 개정판이다.
> 선행: 0단계 완료(main 40c763b) — 프론트엔드 테스트 인프라(Vitest+RTL)와 `InlineError`가 이미 있다.

## 1. 문제 — 승인 도구가 실패하는 방식

승인 워크플로우 도구의 실질적 실패는 기능 부재가 아니라 **요청이 방치되는 것**이다. 담당자가
지정되어 있고 상태 머신이 정확해도, 아무도 자기 차례임을 모르면 CR은 며칠씩 묵는다.

현재 DBFlow의 대시보드는 역할별 KPI 카드 4개로 **숫자**를 보여준다. "결재 대기 3건"은
알려주지만, 그 3건이 무엇인지, 어느 것이 가장 오래 기다렸는지, 왜 막혀 있는지는 목록
화면으로 이동해 필터를 걸어야 알 수 있다. 즉 사용자가 **일을 찾아 들어가야** 한다.

1단계는 그 방향을 뒤집는다 — 로그인하면 일이 화면에 있다.

- **E1**: 대시보드에 "내가 결정해야 할 CR" 목록(오래 기다린 순) + "내 요청이 무엇에 막혀 있는지"
- **E2**: 사이드바에 결재 대기 배지 + 브라우저 탭 타이틀 미러링
- **E8**: 위임 표면화 — 위임으로 넘어온 항목 구별, 결재자 칩에 "위임 중" 표시

## 2. 탐색 결과 — 로드맵의 전제가 부분적으로 틀렸다

로드맵은 1단계를 "전부 S, 기존 테이블 쿼리만으로 가능"으로 기록했다. 백엔드 전수 탐색 결과:

| 항목 | 로드맵 전제 | 실제 |
|---|---|---|
| E1 | 백엔드 변경 없음 | ✅ 맞음 — 판정 데이터가 이미 요약 응답에 있다 |
| E2 | 백엔드 변경 없음 | ✅ 맞음 — 같은 데이터 |
| E8 | 백엔드 변경 없음 | ❌ **틀림** — 위임 표식이 요약 응답에 없다 |
| E3 | S | ❌ **구현 불가** — §3 참조 |

**E1·E2가 가능한 이유**: 서버가 이미 사용자별 판정을 대부분 해준다.
- `ChangeRequestSummary.myApprovalPending`은 `status === REVIEW_APPROVED`이고 미결정 슬롯이
  나 **또는 내 위임자**의 것일 때 true다.
- 역할별 가시성 필터가 REVIEWER의 목록을 `reviewerId = 나 OR 내 위임자`, `status != DRAFT`로
  이미 좁힌다. 따라서 반환된 배열에서 `status === 'SUBMITTED'`가 곧 "내 검토 대기" 집합이다.

### 2-1. 그러나 `myApprovalPending`은 "내가 지금 결재할 수 있는 것"이 아니다 ⚠️

초판은 이걸 인박스 술어로 그대로 쓰려 했다. **틀렸다.** `myApprovalPending`은 내가 **다른
슬롯에서 이미 결정했는지**를 보지 않는다. 그런데 `approve()`는 SoD 게이트에서
`changeRequestId` 같고 `id`가 다른 슬롯 중 내가 직접 결정했거나 내가 `decidedById`인 것이
있으면 409(`changeRequest.sodViolation`)로 거부한다.

즉 다음 상태에서 `myApprovalPending === true`이지만 클릭하면 409다.
- 내가 슬롯 1을 이미 승인했고, 슬롯 2의 대결자이기도 한 경우
- 내가 슬롯 1을 대리 결재했고, 슬롯 2가 내 것인 경우

`change-request.service.spec.ts`의 SoD 테스트 3건이 정확히 이 상태들을 이미 다룬다.

이대로 만들면 **인박스에 클릭하면 실패하는 행이 뜨고 배지가 과다 계수**한다. 배지가 한 번
거짓말하면 사용자는 그 숫자를 다시 신뢰하지 않으므로, E2의 가치가 0이 된다. 이건 E8의 주
대상인 대결자에게 정확히 발생한다.

**인박스 술어는 `myApprovalPending && !alreadyActed`다.** `alreadyActed`는 `toDetail`이
이미 `iAlreadyActed`로 계산하는 술어와 같다(내가 결정한 슬롯이 있거나, 내가 어떤 슬롯의
`decidedById`인 경우).

- **`myApprovalPending` 자체는 절대 바꾸지 않는다.** 그것을 조이면 APPROVER의 KPI 카드
  카운트가 변해 §9-1(기존 기능 무회귀)을 위반한다.
- `alreadyActed`를 **private 헬퍼 하나로 추출**해 `toDetail`과 `inbox()`가 함께 호출한다.
  불리언을 복제하면 두 곳이 갈라진다.
- 이를 위해 `SUMMARY_SELECT`의 approvers select에 `decidedById: true`를 추가한다.
  `toSummary`가 이 필드를 응답에 내보내지 않으므로 **와이어 계약은 그대로다**(가산적이지도 않다).

**E8이 막히는 이유**: 위임 라우팅된 CR은 목록에 *나타나지만*, 요약 응답에 위임 표식이 없어
**내 것과 위임받은 것을 구별할 수 없다**. `canActAsDelegate`는 상세 응답에만 있다. 표식 없이
인박스를 만들면 대결자의 인박스에 두 종류가 섞여 누구 일인지 알 수 없다.

## 3. E3(재검토 요청)를 2단계 F1로 이월한다

E3는 "반려 후 작성자가 수정 → 검토자 decision 리셋 + 재알림"이다. 세 요소가 모두 없다.

1. **CR 수정 경로가 아예 없다.** 컨트롤러의 유일한 PATCH는 `:id/assignees`(검토자·결재자만
   변경)이고, `ChangeRequestFile` 행은 `create` 안의 nested create 단 한 곳에서만 쓰인다.
2. **`REVIEW_REJECTED`에서 나가는 전이가 없다.** 전이 테이블 6개 항목 중 반려 상태를 `from`으로
   갖는 것이 없어, 모든 액션이 409로 거부된다. `DRAFT`를 `to`로 갖는 전이도 없다.
3. **"재알림"은 동작 자체가 없다.** API에 알림 코드가 0줄이고, `telegramChatId`는 저장·조회만
   되며 발송 코드가 없다. HTTP 클라이언트 의존성(axios/node-fetch)조차 없다.

또한 **검토자에게는 리셋할 decision 컬럼이 없다** — 검토 판정은 `ChangeRequest.status`와
`StatusHistory`에만 존재한다. 결재자만 `ChangeRequestApprover.decision`을 갖는다.

지금 임시로 `REVIEW_REJECTED → SUBMITTED` 전이와 파일 수정 경로를 만들면, 2단계 F1(리비전
diff + 승인 무효화)이 요구하는 리비전 모델을 **두 번 설계**하게 되고 두 번째 설계가 첫 번째를
되돌려야 한다. 리비전 이력 없이 재제출을 허용하면 결재자가 "지적된 한 줄만 고쳤는지, 절반을
다시 썼는지" 알 수 없는 **새 정합성 구멍**도 생긴다.

결정적으로, E3의 가치("작업자가 이틀 전에 고쳤는데 검토자가 모른다")는 알림 인프라가 없는
현재 상태에서는 **인박스(E1·E2)가 그대로 해소한다** — 검토자가 로그인하면 재제출된 항목이
목록에 보인다. E3의 남은 가치는 리비전 추적이며 그것이 F1의 본체다.

## 4. 역할별 인박스 의미

`User.role`은 단일값(DEVELOPER | REVIEWER | APPROVER | ADMIN)이므로 분기가 배타적이다.

| 역할 | 인박스 (내가 지금 결정할 수 있는 것) | 내 요청 |
|---|---|---|
| REVIEWER | `status === 'SUBMITTED'` | 없음 (작성 권한 없음) |
| APPROVER | `myApprovalPending && !alreadyActed` (§2-1) | 없음 |
| DEVELOPER | 없음 — 결정할 것이 없다 | 기존 "최근" 목록에 막힌 지점 표시 |
| ADMIN | 없음 | 없음 (현행대로 `/users` 리다이렉트) |

- 개발자에게 빈 인박스를 보여주지 않는다. 결정 권한이 없는 사람에게 "대기 0건"은 소음이다.
- ADMIN은 `POST /change-requests`·review·approve 모두 role guard에서 막히고, 목록 가시성
  필터의 기본 분기가 `[]`를 반환한다. 인박스도 자연히 비며 배지도 없다. 관리자 대시보드는
  로드맵 G9의 몫이다.

**"내 요청이 무엇에 막혀 있는지" — 별도 섹션을 만들지 않는다.** 초판은 개발자 전용 섹션을
제안했으나, 그 데이터가 대시보드의 기존 "최근" 목록(6건, `createdAt` 내림차순)과 거의 완전히
겹친다. 섹션·제목·빈 상태·테스트를 하나씩 더 만들면서 개발자가 이미 볼 수 있는 것을 반복하는
셈이다. 대신 **개발자에게는 기존 "최근" 목록의 각 행에 "막힌 지점" 한 줄을 덧붙인다.**
아래 표는 그 문구 규칙이며, 요약 필드만으로 파생하므로 신규 데이터가 필요 없다.

| 상태 | 표시 |
|---|---|
| `DRAFT` | 제출 대기 (당신 차례) |
| `SUBMITTED` | 검토 대기: `{reviewerName}` |
| `REVIEW_APPROVED` | 결재 대기 `{approved}/{required}` |
| `REVIEW_REJECTED` · `FINAL_REJECTED` | 반려됨 |
| `FINAL_APPROVED` | 적용 대기 |
| `APPLIED` | (막힌 지점 줄을 표시하지 않음 — 막힌 것이 아니다. **행 자체는 목록에 그대로 둔다**) |

## 5. 정렬 — `createdAt`이 아니라 `updatedAt` 오름차순

"오래된 순"의 의미는 **"내게 넘어온 지 오래된 순"**이지 "요청이 만들어진 지 오래된 순"이
아니다. 후자는 급하게 만든 최신 CR을 뒤로 밀어버린다.

`ChangeRequest.updatedAt`은 `@updatedAt`이므로 CR 행이 갱신될 때만 움직인다. 그리고 탐색으로
확인된 사실: **부분 결재는 approver 행만 갱신하고 CR 행을 건드리지 않는다**(상태 변화가
없으므로 `StatusHistory` 행도 남지 않는다). 이 성질이 정확히 우리에게 필요한 것을 준다.

- REVIEWER 인박스: 항목은 `SUBMITTED`이고, 그 상태로 만든 전이가 CR 행을 갱신했다 →
  `updatedAt` = 제출 시점 = 내게 넘어온 시점. ✅
- APPROVER 인박스: 항목은 `REVIEW_APPROVED`이고, 그 전이가 CR 행을 갱신했다 →
  `updatedAt` = 검토 승인 시점 = 내게 넘어온 시점. **다른 결재자가 먼저 승인해도 움직이지
  않는다** — 나에게 넘어온 시점은 그대로이므로 이것이 옳다. ✅

### 5-1. 알려진 예외 — `setAssignees`가 시계를 리셋한다 ⚠️

초판은 CR 행 쓰기를 전수 조사했다고 적었으나 **한 곳을 놓쳤다.** `setAssignees`는
`reviewerId`가 주어지면 `changeRequest.update`를 실행하므로 `@updatedAt`이 갱신된다. 그리고
이 메서드는 **ADMIN에게 어느 상태에서든 허용**된다(작성자는 DRAFT에서만).

결과: 관리자가 `REVIEW_APPROVED` 상태 CR의 검토자를 교체하면, 그 CR을 기다리던 **모든
결재자의 표시 대기 시간이 "3일"에서 "5분"으로 리셋되고 오래된 순 큐의 맨 뒤로 밀린다.**

- 새로 지정된 REVIEWER에게는 이것이 **옳다** — 실제로 그때 그의 일이 되었다.
- 기존 APPROVER들에게는 **틀렸다** — 그들의 대기는 검토 승인 시점부터 계속되고 있다.

**이 한계를 수용하고 여기 기록한다.** 정확히 하려면 `routedAt` 같은 컬럼이 필요하고 그건
스키마 변경이라 이 슬라이스의 범위를 넘는다. 기록하는 이유는 QA 리포트가 올라올 때
"버그인가 설계인가"를 다시 조사하지 않게 하기 위함이다.

**비대칭 하나 더**: `approverIds` 교체는 approver 행만 지우고 다시 만들므로(`deleteMany` +
`createMany`) `updatedAt`을 움직이지 **않는다** — 결재자들의 기존 decision을 전부 날리면서도
대기 시계는 그대로다. 이쪽이 오히려 더 부정확하지만, 같은 이유로 범위 밖이다.

**대기 기간을 표시한다**(`3일 대기` / `5시간 대기`). 오래된 순 정렬은 기간이 보이지 않으면
의미를 갖지 못한다. 전역 상대시간 도입(로드맵 G6)은 3단계에 그대로 남기고, 여기서는 인박스
전용 최소 헬퍼만 만든다. `Intl.RelativeTimeFormat` 전면 도입이 아니다.

## 6. 백엔드 추가 3건

### 6-1. `GET /change-requests/inbox`

기존 `GET /change-requests`의 계약을 **건드리지 않는다**(§9 무회귀 조건). 별도 엔드포인트로
대기 목록만 반환한다.

- 응답: `ChangeRequestSummary[]`, `updatedAt` 오름차순.
- 역할별 필터는 §4 표대로. 가시성 규칙은 **기존 `visibilityWhere`를 재사용**한다 — 새로
  정의하면 두 곳이 갈라질 수 있다.
- ADMIN·DEVELOPER는 빈 배열.

**쿼리 형태를 명시한다** — 두 가지 합리적 해석이 갈라지기 때문이다.

```
DEVELOPER | ADMIN  → 즉시 [] 반환 (Prisma를 호출하지 않는다)
그 외:
  findMany({ where: visibilityWhere(actor, delegatorIds), orderBy: { updatedAt: 'asc' },
             select: SUMMARY_SELECT })
  → toSummary 매핑
  → JS에서 역할별 필터: REVIEWER는 status === 'SUBMITTED',
                        APPROVER는 myApprovalPending && !alreadyActed
```

**JS 필터여야 하는 이유**: `myApprovalPending`은 `toSummary`가 행마다 JS로 계산하는 값이라
SQL로 표현되지 않는다. 이것을 `where: { status: REVIEW_APPROVED, approvers: { some: {...} } }`로
"최적화"하면 KPI 카드가 쓰는 집합과 갈라진다 — 같은 판정을 두 곳에서 다르게 구현하는 것이
이 슬라이스가 피하려는 바로 그 실패다.

**DEVELOPER·ADMIN을 조기 반환하는 이유**: `visibilityWhere`의 기본 분기는 `{ id: { equals: '' } }`로,
빈 결과를 위한 **실제 쿼리**다. 어차피 빈 배열이 확정이므로 왕복을 아낀다.

**라우팅 순서 주의**: `@Get('inbox')`를 `@Get(':id')`보다 **먼저** 선언해야 한다. 나중에
선언하면 `inbox`가 `:id`로 캡처되어 404가 난다. NestJS는 선언 순서로 매칭한다.

### 6-2. 요약 응답에 `delegatedFrom: string | null`

위임을 통해서**만** 내 범위에 든 항목의 위임자 이름. 내 것이면 `null`.

**규칙을 역할이 아니라 `delegatorIds`로 표현한다.** 초판은 "REVIEWER: `reviewerId === 나`가
아니면 `reviewerName`"이라고 역할별로 적었는데, `delegatedFrom`은 `ChangeRequestSummary`에
붙고 `list()`는 **모든 역할에 같은 코드 경로**로 이 타입을 반환한다. 개발자 자신의 CR에
그 규칙을 적용하면 `reviewerId !== 나`가 항상 참이므로 **모든 행에 "위임: 김검토 대리"가
붙는다.** 게다가 `toSummary`는 `user.role`을 받지도 않아서 구현자가 게이팅을 발명해야 한다.

`delegatorIds`는 `delegatorIdsFor`가 REVIEWER·APPROVER가 아닌 모든 역할에 `[]`를 반환하므로,
이 기준으로 쓰면 개발자·관리자 케이스가 **구조적으로 null**이 되고 역할을 넘길 필요도 없다.
상태로 분기를 좁혀 "어느 분기가 이기는가"의 모호성도 함께 제거한다.

| 상태 | `delegatedFrom` |
|---|---|
| `SUBMITTED` | `delegatorIds.includes(reviewerId) ? reviewerName : null` |
| `REVIEW_APPROVED` | 내 미결정 슬롯이 없고 위임자 미결정 슬롯이 있으면 → `order` 오름차순 첫 슬롯 소유자 이름, 아니면 `null` |
| 그 외 전부 | `null` |

**지켜야 할 불변식은 "슬롯 선택 일치"가 아니라 "`approve()`가 받아들이는 것과 일치"다.**
`approve()`는 슬롯을 고른 **뒤** SoD 게이트를 적용한다(§2-1). 인박스 술어가 이미
`!alreadyActed`를 포함하므로, SoD로 막히는 항목은 애초에 인박스에 없고 따라서
`delegatedFrom`을 계산할 일도 없다. 순서상 필터가 먼저다.

**위임이 fetch 사이에 만료되면** 문제가 되지 않는다. `delegatorIds`는 요청마다 다시 계산되고
만료되면 그 CR은 애초에 가시성에서 빠지므로, 낡은 이름이 남는 상태가 존재하지 않는다.

이 필드는 **가산적**이므로 기존 클라이언트는 무시한다. 다만 클라이언트 타입에서
`ChangeRequestDetail`이 `Omit<ChangeRequestSummary, ...>`로 파생되므로, `toDetail`이
`delegatedFrom`을 만들지 않는 한 **`Omit` 목록에 `delegatedFrom`을 추가해야 한다** —
그러지 않으면 타입이 응답에 없는 필드를 약속한다.

### 6-3. 상세 응답의 approver에 `delegatedTo: string | null`

그 결재자가 **현재** 위임 중이면 대결자 이름, 아니면 `null`. 활성 위임 판정은 기존
`Delegation` 윈도우 규칙(`startsAt <= now && endsAt > now`, 종료 배타)을 그대로 쓴다.

**단일 쿼리로 구현한다 — 결재자별 루프가 아니다.** 뻔한 구현은 approver마다 조회하는
N+1이 된다. 상세 응답 하나당 쿼리 하나로 끝난다:

```ts
delegation.findMany({
  where: { delegatorId: { in: approverUserIds }, startsAt: { lte: now }, endsAt: { gt: now } },
  orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],   // 결정적 tie-break (아래 참조)
  select: { delegatorId: true, delegate: { select: { name: true } } },
})
```
그 뒤 JS에서 `delegatorId`로 그룹화한다.

**겹치는 위임이 있을 수 있고, 단일 문자열로는 표현되지 않는다.** `Delegation`에는 유니크·배제
제약이 전혀 없어서 한 위임자가 여러 활성 위임을 동시에 가질 수 있고, `isActiveDelegateFor`는
그 **전부**를 인정한다. 따라서 `delegatedTo: string | null`은 겹칠 때 하나만 보여주게 된다.
위 `orderBy`로 **결정적으로** 최근 시작한 것을 고르고(동시 시작이면 `id` 오름차순),
겹침이 있을 때 칩이 과소 보고할 수 있음을 여기 명시한다. 근본 해법(제약 추가)은 §12 참조.

용도: CR 상세의 결재자 칩에 "위임 중" 배지. 다른 관계자가 "왜 이 사람이 아닌 다른 사람이
결재할 수 있는가"를 화면에서 이해하게 한다. 결정 **후**의 대리 표시는 `approvers[].decidedBy`로
이미 되어 있다 — 이건 결정 **전**의 공백을 메운다.

## 7. 프론트엔드 구조

### 7-1. `InboxProvider` 컨텍스트

배지는 모든 페이지의 사이드바에 있고, 인박스 목록은 대시보드에 있다. 두 곳이 각자 fetch하면
페이지 이동마다 중복 요청이 난다. `AppShell`에 컨텍스트를 두어 **한 번 fetch하고 공유**한다.

```
InboxProvider (AppShell 내부)
  ├─ items: ChangeRequestSummary[]   // 대시보드 인박스 섹션이 소비
  ├─ count: number                   // 사이드바 배지 + 탭 타이틀이 소비
  ├─ loading: boolean
  └─ refresh(): Promise<void>        // 결재 후 즉시 갱신
```

- 마운트 시 1회 fetch. 역할이 DEVELOPER·ADMIN이면 요청 자체를 보내지 않는다(빈 배열 확정).
- CR 상세에서 검토·결재가 성공하면 `refresh()`를 호출한다. 그러지 않으면 방금 처리한 항목이
  배지에 남아 사용자가 카운트를 신뢰하지 않게 된다. 연결 지점은 상세 페이지의 `load`이며,
  이미 `onDone`으로 각 액션에 전달되고 있다.

**`useInbox()`는 provider가 없을 때 throw하지 않고 기본값을 반환해야 한다.** ⚠️
`{ items: [], count: 0, loading: false, refresh: async () => {} }`.

이유: CR 상세 페이지의 기존 테스트 19개는 `renderWithIntl(<ChangeRequestDetailPage …/>)`로
컴포넌트를 **단독 렌더**한다 — `AppShell`도 `UserProvider`도 없다. `useUser()`처럼
throw-on-missing 패턴을 따르면 그 19개가 전부 깨지고, 이는 §9-5(기존 테스트 무수정 통과)를
정면으로 위반한다. 구현자가 `useUser`를 복사할 가능성이 높으므로 여기 못 박는다.

**조회 실패가 셸을 깨뜨리지 않아야 한다.** 인박스 조회가 실패하면 `count`를 0으로 두고
배지를 렌더하지 않는다. 에러 배너를 셸에 띄우지 않는다 — 사이드바는 모든 페이지에 있으므로
거기서 실패를 보고하면 사용자가 지금 하려는 일과 무관한 에러가 전 화면에 붙는다. 배지 부재는
"대기 0건"과 시각적으로 구별되지 않지만, 잘못된 숫자보다 없는 숫자가 안전하다.

### 7-2. 배지 의미 — 개인 지정 알림만 센다

Slack의 배지 철학을 따른다: **숫자는 나에게 온 결정만** 센다. FYI 성격 활동(내 CR이 승인됨,
누가 코멘트함)까지 세면 사용자는 배지를 무시하도록 학습하고, 그 순간 배지의 가치가 0이 된다.

- 위치: 사이드바 "변경요청" 항목. 접힌 사이드바(아이콘 레일)에서도 보여야 한다.
- 개발자·관리자는 배지가 없다(0이므로 렌더하지 않음 — "0"을 보여주지 않는다).

**접힌 상태에서 두 가지를 고쳐야 한다** ⚠️
1. 접힌 모드의 nav `Link`는 `justify-center`이고 `relative`가 없다. 절대 위치 배지를 붙이려면
   `relative`를 추가해야 한다.
2. 접힌 모드에서 그 `Link`는 이미 `aria-label`을 갖는다. **요소의 `aria-label`은 그 하위
   트리의 접근 가능한 이름을 대체하므로, 안에 중첩된 배지의 `aria-label`은 절대 읽히지
   않는다.** 즉 §8이 약속한 "결재 대기 3건"이 정확히 접힌 상태에서 도달 불가다.
   → 접힌 모드에서는 배지에 라벨을 붙이는 대신 **`Link` 자신의 `aria-label`을 합성**한다:
   `` `${t(labelKey)}, ${t('nav.inboxBadgeAria', { count })}` ``.

**탭 타이틀 미러링** — `document.title = count > 0 ? \`(${count}) DBFlow\` : 'DBFlow'`.
현재 타이틀은 `app/layout.tsx`의 정적 `metadata` 하나뿐이라 배경 탭에서 알 방법이 없다.

**effect의 deps에 `usePathname()`을 포함해야 한다** ⚠️ — Next는 내비게이션마다 metadata를
다시 내보내므로, `count`만 의존하는 effect는 사용자가 첫 페이지 이동을 하는 순간 타이틀이
"DBFlow"로 되돌아간다. 그런데 `InboxProvider`는 계속 마운트된 상태라 effect가 다시 실행되지
않아 카운트가 영구히 사라진다. 언마운트 시 `'DBFlow'`로 복원한다.
`(${count}) DBFlow`는 i18n을 거치지 않는데, 브랜드명이므로 의도된 것이다.

전체 페이지별 타이틀 도입(G6)은 3단계에 남긴다.

### 7-3. 대시보드 배치

인사말 → **인박스 섹션** → 기존 KPI 카드 4개 → 최근 목록. 카드의 `?filter=` 딥링크는 그대로
살린다. 보이는 순서가 학습되므로 기존 사용자의 지도를 깨지 않는다.

인박스 각 행: 제목 · 환경 배지 · 대기 기간 · (위임이면) "위임: {이름} 대리" · 상태 배지.
행 전체가 CR 상세로 가는 링크다.

비어 있을 때는 빈 상태 문구를 보여준다("결정 대기 중인 변경요청이 없습니다") — 섹션을
숨기지 않는다. 숨기면 사용자가 "인박스가 어디 갔지"를 묻게 된다.

개발자에게는 인박스 섹션을 렌더하지 않고, 기존 "최근" 목록의 각 행에 §4 표의 "막힌 지점"
한 줄을 덧붙인다(별도 섹션을 만들지 않는 이유는 §4 참조).

**대시보드가 데이터 소스 두 개를 갖게 된다.** 검토자·결재자 화면에서는 기존
`listChangeRequests()`(KPI 카드·최근 목록용)와 인박스 컨텍스트가 **서로 다른 시점의
스냅샷**이므로, KPI 카드의 "결재 대기 3건"과 인박스 행 개수가 일시적으로 다를 수 있다.
- 인박스 섹션은 **컨텍스트만** 읽는다(두 번째 fetch를 만들지 않는다).
- 그리고 두 숫자는 §2-1 때문에 **의도적으로 다를 수도 있다** — KPI 카드는
  `myApprovalPending`을 세고 인박스는 `&& !alreadyActed`를 추가로 요구한다. SoD로 막힌 항목이
  있으면 카드가 인박스보다 크다. 이것이 정상 동작임을 여기 기록한다. 카드를 조이면
  §9-1을 위반한다.

## 8. 접근성

- 배지는 숫자만으로는 스크린리더에서 의미가 없다. `aria-label`에 "결재 대기 3건" 형태로
  전체 문장을 넣는다.
- 인박스 섹션에 `<h2>` 제목을 둔다. 카드 섹션과 형제 관계로.
- 대기 기간은 `<time dateTime={updatedAt}>`으로 감싼다. 기계 판독 가능한 값이 남는다.
- 위임 표시는 색만으로 구분하지 않는다(텍스트 "위임" 포함).

## 9. 무회귀 조건 (필수)

사용자 요구: **"현재 기본 기능에 문제가 없는 선에서"**. 다음을 깨면 실패다.

1. **`GET /change-requests`의 계약을 변경하지 않는다.** 인박스는 별도 엔드포인트다.
   `delegatedFrom` 추가는 가산적이며 기존 소비자는 무시한다.
2. **기존 KPI 카드 4개, `?filter=` 딥링크, 목록 화면의 클라이언트 필터가 그대로 동작한다.**
3. **ADMIN의 `/users` 리다이렉트를 유지한다.**
4. **기존 가시성·SoD·위임 규칙을 재정의하지 않는다.** 인박스는 `visibilityWhere`를 재사용한다.
5. **기존 테스트 248개가 전부 초록**(api 221 + web 27). 하나도 수정하지 않고 통과해야 한다 —
   기존 테스트를 고쳐야 한다면 그것은 계약을 깬 신호다.
6. `apps/api`의 상태 머신·전이 테이블을 건드리지 않는다(E3 이월로 그 필요가 없어졌다).
7. **CR 상세 페이지의 기존 테스트 19개가 무수정 통과한다.** `useInbox()`가 provider 없이
   throw하면 전부 깨진다(§7-1).
8. **`ChangeRequestDetail` 타입이 응답에 없는 필드를 약속하지 않는다.** `delegatedFrom`을
   `Omit` 목록에 추가한다(§6-2).
9. **접힌 사이드바의 레이아웃과 접근 가능한 이름이 깨지지 않는다.** 배지가 아이콘 레일을
   넘치지 않고, 합성된 `aria-label`이 실제로 읽힌다(§7-2).
10. **탭 타이틀이 라우트 이동 후에도 유지된다.** `count`만 의존하면 첫 이동에서 사라진다(§7-2).
11. **인박스 조회 실패가 셸을 깨뜨리지 않는다.** 배지 미표시로 degrade하고 에러 배너를
    사이드바에 띄우지 않는다(§7-1).
12. **KPI 카드와 인박스의 카운트 불일치는 정상**이다(§7-3). 이를 "맞추려고" 카드를 조이면
    §9-1 위반이다.

13. **개발자의 "최근" 목록에서 행이 사라지지 않는다.** §4 표의 `APPLIED` 행은 "막힌 지점 줄을
    표시하지 않음"을 뜻하며 행 제외가 아니다. 모든 역할에서 최근 목록의 행 집합과 `createdAt`
    내림차순 정렬이 그대로다. (지금 `card.developer.done`이 `FINAL_APPROVED || APPLIED`를 세므로,
    행을 빼면 "완료 3" 옆에 그 3건이 없는 목록이 나온다.)
14. **`InboxProvider`는 `AppShell` 반환 트리 전체를 감싼다** — 데스크톱 `<aside>`, 모바일 드로어,
    `<main>` 셋 다 안쪽이어야 한다. `{children}`만 감싸면 두 `Sidebar`가 provider 밖에 남아
    배지가 비-throw 기본값으로 **영구히 0을 읽고 아무 테스트도 실패하지 않는다**(§7-1의 비-throw
    기본값이 이 실패를 조용하게 만들었다). `AppShell`을 REVIEWER로 렌더해 배지가 뜨는지 단언하는
    테스트가 유일한 검출 수단이다.
15. **`alreadyActed` 헬퍼는 `string | undefined`를 받고 `toDetail`의 `currentUserId`는 optional로
    남는다.** `create()`와 `applyTransition()`(submit 경로)은 actor 없이 `toDetail`을 호출하므로
    `iAlreadyActed`가 계속 `false`여야 한다. 기존 단언 2건이 무수정 통과해야 한다.
    `currentUserId!`나 `?? ''`로 우회하지 않는다.
16. **`GET /change-requests/inbox`가 200과 배열을 반환함을 supertest로 단언한다.**
    api 스위트에 컨트롤러 테스트가 0개라 라우팅 순서 실수는 다른 검출 수단이 없다 — 틀리면
    `inbox`가 `:id`로 캡처돼 런타임 404가 되고 수동 QA만 발견한다. 패턴은
    `src/audit/audit-exception.filter.e2e-spec.ts`(`@nestjs/testing` + `supertest`, 둘 다 설치됨).
17. **탭 타이틀 effect는 `InboxProvider`에 둔다 — 배지 컴포넌트가 아니다.** 데스크톱 `<aside>`는
    CSS로만 숨겨져 항상 마운트돼 있으므로, 모바일 드로어를 열면 `Sidebar`가 **두 개 동시에** 산다.
    배지에 effect를 두면 두 인스턴스가 하나의 전역(`document.title`)을 두고 경쟁한다.
18. **provider의 fetch는 기존 `active` 플래그 패턴을 따른다.** `next.config.js`가
    `reactStrictMode: true`라 개발 중 effect가 두 번 실행된다. 이 패턴은 대시보드·목록 화면에
    이미 있으니 재사용이지 새 장치가 아니다.
19. **인박스 섹션은 `items !== null` 분기 밖에서 자체 loading 상태로 렌더된다.** 그리고
    **provider는 error 필드를 노출하지 않는다.** 대시보드에는 `error` 상태가 하나뿐이고
    `items === null && error`면 본문의 두 분기가 모두 false가 되어 화면이 빈다 — 인박스 실패가
    거기로 새면 목록이 아직 오는 중일 때 대시보드 본문 전체가 사라진다. provider가 error를
    노출하지 않는 것이 이 구멍을 구조적으로 막는 장치이므로, 나중에 "개선"으로 추가하지 않는다.

### 9-1. 실행으로 확인한 것

- **기준선은 248개**(api 221 + web 27). 실행해 확인.
- **api 스펙에 응답 shape 전체를 비교하는 단언이 없다.** `toStrictEqual`·`toMatchSnapshot`·
  `Object.keys` 검색 결과 0건이고, `toSummary` 결과를 통째로 비교하는 곳도 없다. 따라서
  요약에 `delegatedFrom`을 추가해도 기존 api 테스트를 깨지 않는다.
- **`messages.test.ts`는 `flatKeys(ko).sort()`와 `flatKeys(en).sort()`를 `toEqual`로 비교**한다.
  한쪽 카탈로그에만 키를 넣으면 반드시 실패한다 → §13 태스크 5는 en·ko를 한 태스크로 묶는다.
- **`useUser()`는 provider 부재 시 실제로 throw한다**(`user-context.tsx`). §7-1이 금지하는
  패턴이 바로 옆에 있으므로 구현자가 복사할 위험이 실재한다.
- **`AppShell`은 `!ready || !user`일 때 조기 반환**한다. `InboxProvider`는 그 아래에 두어
  사용자가 확정된 뒤에만 조회하게 한다.
- **접힌 사이드바의 nav `Link`는 `aria-label`을 직접 갖고 `justify-center`이며 `relative`가
  없다** — §7-2의 두 수정이 모두 필요함을 코드로 확인.

## 10. 신규 i18n 문자열

전부 en/ko 양쪽에 추가한다. 카탈로그 대칭 테스트가 누락을 잡는다.

`dashboard` 네임스페이스:
- `inbox.title` — "내 결정 대기" / "Waiting on you"
- `inbox.empty` — "결정 대기 중인 변경요청이 없습니다." / "No change requests are waiting on your decision."
- `inbox.waitingFor` — "{duration} 대기" / "waiting {duration}"
- `inbox.delegatedFrom` — "위임: {name} 대리" / "Delegated from {name}"
- `blocked.draft` — "제출 대기 — 당신 차례입니다" / "Waiting to be submitted — your turn"
- `blocked.review` — "검토 대기: {name}" / "Waiting for review by {name}"
- `blocked.approval` — "결재 대기 {approved}/{required}" / "Awaiting approval {approved}/{required}"
- `blocked.rejected` — "반려됨" / "Rejected"
- `blocked.apply` — "적용 대기" / "Waiting to be applied"

`nav` 네임스페이스:
- `inboxBadgeAria` — "결재 대기 {count}건" / "{count} awaiting your decision"

`changeRequestDetail` 네임스페이스:
- `delegatingNow` — "위임 중" / "Delegating"

`common` 네임스페이스(대기 기간 헬퍼용) — 단수/복수는 next-intl의 ICU plural로 처리한다:
- `duration.days` — "{count, plural, other {#일}}" / "{count, plural, one {# day} other {# days}}"
- `duration.hours` — "{count, plural, other {#시간}}" / "{count, plural, one {# hour} other {# hours}}"
- `duration.minutes` — "{count, plural, other {#분}}" / "{count, plural, one {# minute} other {# minutes}}"

대기 기간 헬퍼는 24시간 이상이면 일, 1시간 이상이면 시간, 그 미만이면 분으로 반올림해 한
단위만 쓴다("3일 5시간"처럼 합성하지 않는다 — 인박스 행은 좁다).

**네임스페이스가 갈리는 점을 호출부에서 유의한다**: `inbox.waitingFor`는 `dashboard`에,
`duration.*`은 `common`에 있다. 따라서 인박스 행은 `useTranslations` 훅을 두 개 쓰고,
duration을 먼저 포맷해 문자열로 만든 뒤 `waitingFor`에 보간한다.

ICU plural 문법이 이 프로젝트의 next-intl 버전에서 실제로 동작함은 검수 중 실행으로
확인했다(`{count, plural, other {#일}}` → "3일", `one {# day} other {# days}}` → "1 day"/"3 days").

## 11. 테스트

**백엔드** — `apps/api/src/change-request/change-request.service.spec.ts`(1121줄)에 이어 붙인다.
기존 위임 통합 테스트 바로 옆이 자연스러운 자리다.

⚠️ **이 스위트의 Prisma mock은 손으로 만든 것이고 `findMany`가 고정 배열을 반환하며 `orderBy`를
무시한다.** 따라서 "정렬되어 반환된다"류의 단언은 **픽스처의 순서를 검사하는 공허한 테스트**가
된다. 정렬·윈도우·필터 조건은 **호출 인자를 단언**해야 한다(이 스위트가 가시성 검증에 이미
쓰는 패턴이다).

| 대상 | 단언 방식 |
|---|---|
| `updatedAt` 오름차순 | `findMany` 호출 인자의 `orderBy`가 `{ updatedAt: 'asc' }` |
| REVIEWER는 `SUBMITTED`만 | 픽스처에 `REVIEW_APPROVED`·`FINAL_APPROVED` 행을 **섞어 넣고**, 결과에서 제외됨을 단언 (섞지 않으면 필터가 아무 일도 안 해도 통과) |
| `delegatedTo`가 활성 위임만 | `delegation.findMany` 인자의 `startsAt: { lte: now }`·`endsAt: { gt: now }`를 단언 (만료 위임이 null인 건 mock이 빈 배열을 준 결과일 뿐) |
| DEVELOPER·ADMIN 빈 배열 | Prisma가 **호출되지 않았음**까지 단언(§6-1 조기 반환) |
| **SoD로 막힌 항목이 인박스에 없다** | §2-1의 핵심. 이것이 가장 중요한 신규 테스트다 |
| `delegatedFrom`이 개발자 자신의 목록에서 null | §6-2가 되돌린 회귀 |
| `delegatedFrom` 상태별 분기 3종 | SUBMITTED / REVIEW_APPROVED / 그 외 |
| `alreadyActed` 헬퍼가 `toDetail`·`inbox()` 양쪽에서 동일 | 복제되지 않았음을 보장 |

**프론트엔드** — 대시보드·사이드바 테스트가 현재 0개다. 이 슬라이스가 첫 테스트를 만든다.
0단계에서 세운 인프라(`renderWithIntl`, `test/fixtures.ts`, `vi.hoisted` 라우터 mock 패턴)를
그대로 쓴다.
- 인박스 섹션이 오래된 순으로 렌더되고 행이 상세로 링크
- 인박스가 비면 빈 상태 문구(섹션은 유지)
- 위임 항목에 "위임: {이름}" 표시
- 배지가 count > 0일 때만 렌더 (0에서 "0"이 아니라 아무것도 없음)
- **접힌 사이드바**에서 배지가 보이고, `Link`의 합성 `aria-label`에 대기 건수가 포함됨(§7-2)
- 개발자·관리자에게 배지가 없음
- 탭 타이틀에 카운트 미러링, **그리고 라우트 이동 후에도 유지됨**(§7-2)
- 인박스 조회가 실패하면 배지가 없고 셸이 정상 렌더됨(§7-1)
- 개발자의 "최근" 목록 행에 상태별 "막힌 지점"이 정확히 표시
- 대기 기간 헬퍼 단위 테스트(일/시간/분 경계, ICU plural)
- **`locale="ko"` + `ko.json`으로도 렌더하는 테스트 1건.** 현재 `renderWithIntl`은 en 카탈로그를
  하드코딩하고 있어 **어떤 테스트도 ko를 렌더하지 않는다.** 카탈로그 대칭 테스트는 키 *이름*만
  비교하므로 ICU 본문이 깨져도 초록으로 배포된다. §10의 ko plural이 이 프로젝트의 첫 plural이다.

**`refresh()` 검증은 나누어 한다.** "결재 성공 후 배지가 줄어든다"를 상세 페이지에서 단언하려
하면 상세 페이지에 사이드바가 없어 **mock이 mock을 검사**하는 형태가 된다. 대신:
- `InboxProvider`를 직접 테스트해 `refresh()`가 재조회함을 확인
- 상세 페이지에서는 액션 성공이 `onDone` 체인을 타고 `load`에 도달함을 확인(기존 구조)

**무회귀 확인** — 기존 248개를 수정 없이 통과. `pnpm --filter @dbflow/api test`와
`pnpm --filter @dbflow/web test` 양쪽.

## 12. 의도적 범위 밖

- **E3 재검토 요청** — 2단계 F1로 이월(§3에 근거).
- **서버측 목록 페이징·필터**(G1, 3단계) — 인박스는 본질적으로 작다(내 결정 대기 항목).
  전체 목록 fetch 문제는 목록 화면의 몫이고 이 슬라이스가 악화시키지 않는다.
- **전역 상대시간·페이지별 타이틀**(G6, 3단계) — 인박스 전용 최소 헬퍼만.
- **관리자 대시보드**(G9, 5단계) — ADMIN은 현행대로 리다이렉트.
- **알림 발송**(D1) — API에 인프라가 0이다. 배지·인박스가 "알림"의 역할을 대신한다.
- **넛지·SLA 리마인더**(E4, 4단계) — 스케줄러와 발송 채널이 선행돼야 한다.
- **배지의 refetch-on-focus·폴링** — 마운트 시 1회 조회와 결재 후 `refresh()`만 한다. 탭을
  오후 내내 열어둔 검토자는 낡은 카운트를 보고, 그 사이 제출된 CR은 새로고침 전까지 안 보인다.
  이 슬라이스에서 수용하는 한계다. 요청량은 이미 작다 — 로그인 1회 + 내비게이션 5회 + 결재 3회
  세션이 4요청이고(개발자·관리자는 0), 그 5회 내비게이션이 이미 유발하는 전체 목록 조회보다 적다.
  기록하는 이유: 다음 사람이 모든 인증 페이지 뒤에 있는 엔드포인트에 `setInterval`을 걸지 않고
  **visibility 기반 refetch**를 택하게 하기 위함이다.
- **Delegation 중복 윈도우 제약** — 현재 `Delegation`에 유니크·배제 제약이 전혀 없어 한
  위임자가 겹치는 활성 위임을 여러 개 가질 수 있고, `isActiveDelegateFor`는 그 전부를
  인정한다. 이 슬라이스는 `delegatedFrom`(슬롯 `order` 오름차순)과 `delegatedTo`
  (`startsAt` 내림차순 → `id` 오름차순)를 **결정적으로** 고르는 것으로 대응하며,
  겹침 자체를 막지는 않는다. 근본 해법은 스키마 제약 또는 생성 시 검증이고 별도 항목이다.
  여기 기록해 다음 사람이 누락으로 오해하지 않게 한다.

## 13. 태스크 분해와 순서

스펙이 암시하지만 명시하지 않았던 순서를 기록한다. 구현 계획은 이 순서를 따른다.

1. **API `inbox()` + `GET /change-requests/inbox`** — `@Get(':id')`보다 먼저 선언.
   `alreadyActed` 공용 헬퍼 추출(§2-1), `SUMMARY_SELECT`에 `decidedById` 추가,
   라우팅 순서를 잡는 supertest 1건(§9-16).
2. **API `delegatedFrom`** — `delegatorIds` 기준, 상태별 분기(§6-2).
3. **API `delegatedTo`** — 단일 쿼리, 결정적 tie-break(§6-3).
4. **Web `lib/api.ts`** — `listInbox()`, Summary에 `delegatedFrom`, **Detail의 `Omit`에 추가**,
   approver에 `delegatedTo`.
5. **Web i18n + 대기 기간 헬퍼** — en·ko를 **한 태스크에서** 추가한다(나누면 대칭 테스트를
   절반만 만족시킬 수 있다). 헬퍼 단위 테스트 포함.
6. **Web `InboxProvider`** — `AppShell`에 마운트, **비-throw 기본값**(§7-1), 상세 페이지의
   `load`에 `refresh()` 연결.
7. **Web 사이드바 배지** — 펼침·접힘 양쪽, 합성 `aria-label`(§7-2), 탭 타이틀은 `pathname`
   의존(§7-2).
8. **Web 대시보드 인박스 섹션** — 개발자용 "막힌 지점" 줄 포함(§4).

의존: 1~3은 서로 독립이고 모두 4보다 먼저. 4와 5는 6~8보다 먼저. 6은 7보다 먼저.
5는 7·8보다 먼저(키가 없으면 둘 다 실패).
