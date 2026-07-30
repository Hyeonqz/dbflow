# 결재 인박스 설계 (E1 · E2 · E8)

> 작성 2026-07-30. UX 로드맵 **1단계**([roadmap-ux-candidates.md](../../refactor/roadmap-ux-candidates.md) §E, [ROADMAP.md](../../ROADMAP.md) "UX 기능 개발 리스트").
> 규모: **M** (로드맵은 S로 추정했으나 백엔드 전수 탐색 결과 상향 — §2 참조).
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

**E1·E2가 가능한 이유**: 서버가 이미 사용자별 판정을 해준다.
- `ChangeRequestSummary.myApprovalPending`은 `status === REVIEW_APPROVED`이고 미결정 슬롯이
  나 **또는 내 위임자**의 것일 때 정확히 true다.
- 역할별 가시성 필터가 REVIEWER의 목록을 `reviewerId = 나 OR 내 위임자`, `status != DRAFT`로
  이미 좁힌다. 따라서 반환된 배열에서 `status === 'SUBMITTED'`가 곧 "내 검토 대기" 집합이다.

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

| 역할 | 인박스 (내가 결정해야 할 것) | 내 요청 섹션 |
|---|---|---|
| REVIEWER | `status === 'SUBMITTED'` | 없음 (작성 권한 없음) |
| APPROVER | `myApprovalPending === true` | 없음 |
| DEVELOPER | 없음 — 결정할 것이 없다 | **주 표면** |
| ADMIN | 없음 | 없음 (현행대로 `/users` 리다이렉트) |

- 개발자에게 빈 인박스를 보여주지 않는다. 결정 권한이 없는 사람에게 "대기 0건"은 소음이다.
- ADMIN은 `POST /change-requests`·review·approve 모두 role guard에서 막히고, 목록 가시성
  필터의 기본 분기가 `[]`를 반환한다. 인박스도 자연히 비며 배지도 없다. 관리자 대시보드는
  로드맵 G9의 몫이다.

**"내 요청이 무엇에 막혀 있는지"** — 요약 필드만으로 파생한다. 신규 데이터가 필요 없다.

| 상태 | 표시 |
|---|---|
| `DRAFT` | 제출 대기 (당신 차례) |
| `SUBMITTED` | 검토 대기: `{reviewerName}` |
| `REVIEW_APPROVED` | 결재 대기 `{approved}/{required}` |
| `REVIEW_REJECTED` · `FINAL_REJECTED` | 반려됨 |
| `FINAL_APPROVED` | 적용 대기 |
| `APPLIED` | (목록에서 제외 — 막힌 것이 아니다) |

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

**라우팅 순서 주의**: `@Get('inbox')`를 `@Get(':id')`보다 **먼저** 선언해야 한다. 나중에
선언하면 `inbox`가 `:id`로 캡처되어 404가 난다. NestJS는 선언 순서로 매칭한다.

### 6-2. 요약 응답에 `delegatedFrom: string | null`

위임을 통해서**만** 내 범위에 든 항목의 위임자 이름. 내 것이면 `null`.

**계산 규칙은 `approve()`의 슬롯 해석과 반드시 일치해야 한다.** 어긋나면 UI가 "누가 결재하는
중인지"를 거짓으로 표시한다. `approve()`는 자기 슬롯을 우선하고, 없으면 위임자 슬롯을
`order` 오름차순으로 고른다. 따라서:

- REVIEWER: `reviewerId === 나` → `null`, 아니면 `reviewerName`.
- APPROVER: 내 미결정 슬롯이 있으면 → `null`. 없고 위임자 미결정 슬롯이 있으면 → `order`
  오름차순 첫 슬롯의 소유자 이름.

이 필드는 **가산적**이므로 기존 클라이언트는 무시한다. 목록·대시보드 등 기존 소비자에 영향 없다.

### 6-3. 상세 응답의 approver에 `delegatedTo: string | null`

그 결재자가 **현재** 위임 중이면 대결자 이름, 아니면 `null`. 활성 위임 판정은 기존
`Delegation` 윈도우 규칙(`startsAt <= now && endsAt > now`, 종료 배타)을 그대로 쓴다.

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
  배지에 남아 사용자가 카운트를 신뢰하지 않게 된다.

### 7-2. 배지 의미 — 개인 지정 알림만 센다

Slack의 배지 철학을 따른다: **숫자는 나에게 온 결정만** 센다. FYI 성격 활동(내 CR이 승인됨,
누가 코멘트함)까지 세면 사용자는 배지를 무시하도록 학습하고, 그 순간 배지의 가치가 0이 된다.

- 위치: 사이드바 "변경요청" 항목. 접힌 사이드바(아이콘 레일)에서도 보여야 한다.
- 개발자·관리자는 배지가 없다(0이므로 렌더하지 않음 — "0"을 보여주지 않는다).
- 탭 타이틀 미러링: `document.title = count > 0 ? \`(${count}) DBFlow\` : 'DBFlow'`.
  현재 타이틀은 `app/layout.tsx`의 정적 `metadata` 하나뿐이라 배경 탭에서 알 방법이 없다.
  전체 페이지별 타이틀 도입(G6)은 3단계에 남긴다.

### 7-3. 대시보드 배치

인사말 → **인박스 섹션** → 기존 KPI 카드 4개 → 최근 목록. 카드의 `?filter=` 딥링크는 그대로
살린다. 보이는 순서가 학습되므로 기존 사용자의 지도를 깨지 않는다.

인박스 각 행: 제목 · 환경 배지 · 대기 기간 · (위임이면) "위임: {이름} 대리" · 상태 배지.
행 전체가 CR 상세로 가는 링크다.

비어 있을 때는 빈 상태 문구를 보여준다("결정 대기 중인 변경요청이 없습니다") — 섹션을
숨기지 않는다. 숨기면 사용자가 "인박스가 어디 갔지"를 묻게 된다.

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

## 10. 신규 i18n 문자열

전부 en/ko 양쪽에 추가한다. 카탈로그 대칭 테스트가 누락을 잡는다.

`dashboard` 네임스페이스:
- `inbox.title` — "내 결정 대기" / "Waiting on you"
- `inbox.empty` — "결정 대기 중인 변경요청이 없습니다." / "No change requests are waiting on your decision."
- `inbox.waitingFor` — "{duration} 대기" / "waiting {duration}"
- `inbox.delegatedFrom` — "위임: {name} 대리" / "Delegated from {name}"
- `myRequests.title` — "내 요청" / "My requests"
- `myRequests.empty` — "진행 중인 요청이 없습니다." / "No requests in progress."
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

## 11. 테스트

**백엔드** — `apps/api/src/change-request/change-request.service.spec.ts`(1121줄)에 이어 붙인다.
기존 위임 통합 테스트 바로 옆이 자연스러운 자리다.
- `inbox()`가 REVIEWER에게 `SUBMITTED`만, `updatedAt` 오름차순으로 반환
- `inbox()`가 APPROVER에게 `myApprovalPending` 항목만 반환
- `inbox()`가 DEVELOPER·ADMIN에게 빈 배열
- `delegatedFrom`이 내 슬롯이면 null, 위임자 슬롯이면 위임자 이름
- `delegatedFrom`이 `approve()`의 슬롯 우선순위와 일치(자기 슬롯 우선, 없으면 order 오름차순)
- `delegatedTo`가 활성 위임만 반영(종료된 위임은 null)

**프론트엔드** — 대시보드·사이드바 테스트가 현재 0개다. 이 슬라이스가 첫 테스트를 만든다.
0단계에서 세운 인프라(`renderWithIntl`, `test/fixtures.ts`, `vi.hoisted` 라우터 mock 패턴)를
그대로 쓴다.
- 인박스 섹션이 오래된 순으로 렌더되고 행이 상세로 링크
- 인박스가 비면 빈 상태 문구(섹션은 유지)
- 위임 항목에 "위임: {이름}" 표시
- 배지가 count > 0일 때만 렌더, `aria-label`에 전체 문장
- 개발자·관리자에게 배지가 없음
- 탭 타이틀에 카운트 미러링
- 결재 성공 후 `refresh()`가 호출되어 배지가 줄어듦
- 개발자의 "내 요청" 섹션이 상태별 "막힌 지점"을 정확히 표시

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
- **Delegation 중복 윈도우 검증** — 현재 `Delegation`에 유니크 제약이 없어 겹치는 위임이
  허용된다. `delegatedFrom`은 `order` 오름차순 첫 슬롯을 고르므로 결정적이지만, 근본 문제는
  별도 항목이다. 여기 기록해 다음 사람이 누락으로 오해하지 않게 한다.
