# CR 상세 페이지 에러 표면화 + 프론트엔드 테스트 인프라 설계

> 작성 2026-07-28. UX 로드맵 **0단계**([roadmap-ux-candidates.md](../../refactor/roadmap-ux-candidates.md) §0, [ROADMAP.md](../../ROADMAP.md) "UX 기능 개발 리스트").
> 규모: **M** (당초 S로 추정했으나 검수에서 fail-open 2건, 테스트 인프라 부재, 미번역 네트워크 에러 노출이 드러나 상향).
>
> 검수 이력 — 4개 에이전트를 거쳤다.
> ① 설계 비평(ACCEPT WITH CHANGES): fail-open 2건 발견 · ② 테스트 인프라 실측(red→green 확인)
> ③ 스펙 비평(ACCEPT WITH CHANGES): DEV 린트 비대칭 · containment 단언 미결합 · 403 근거 오류 발견
> ④ 스펙 UX/제품 검수(ACCEPT WITH CHANGES): 린트 재시도 부재(dead end) · 미번역 네트워크 에러 · 갱신 실패 모호성 발견
> **본 문서는 ③④ 반영 후 개정판이다.**

## 1. 배경 — 보고된 증상과 실제 범위

보고된 증상은 "빈 사유로 반려를 눌러도 아무 일도 일어나지 않는다"였다. 원인은
`apps/web/app/(app)/change-requests/[id]/page.tsx:89`의 렌더 조건 하나다.

```tsx
{error && !cr && ( ... 빨간 배너 ... )}
```

이 페이지의 액션 패널들은 모두 `onError={setError}`로 부모의 단일 `error` 문자열에 쓴다
(147·154·161·171행). 그런데 이 패널들은 **`cr`이 이미 로드된 뒤에만** 존재하므로,
`!cr` 조건 때문에 배너가 영원히 렌더되지 않는다. 즉 증상은 반려 검증 하나가 아니라
**제출·검토·승인·적용·dry-run·롤백·담당자 변경의 모든 실패가 무증상**이다.

이 조건부 게이팅은 이 페이지에만 있다. 다른 12개 화면은 모두 `{error && (...)}`로
조건 없이 렌더한다(`dashboard:151`, `change-requests:126`, `audit:133`, `target-databases:75`,
`users:67`, `delegations:70`, `apply-schedule:66`, `approval-policy:61`, `sql-review:78`,
`schema-diff:96`, `login:77`, `change-requests/new:322`). 따라서 수정 범위를 이 페이지로
한정하는 것이 정당하다.

**타입 검사를 통과하는 조건부 렌더 실수**였다는 점이 핵심이다. `apps/web`에는 테스트가
0개이고 `package.json`에 test 스크립트조차 없다. 검증 수단이 `tsc --noEmit`와
`next build`뿐이라 이 부류의 결함을 구조적으로 잡을 수 없다. 앞으로 UX 로드맵 1~7단계가
거의 전부 프론트엔드 작업이므로, 이번에 테스트 인프라를 함께 들인다.

## 2. 설계 원칙 — 에러를 3종으로 분류한다

당초 "로드 에러 / 액션 에러" 2종으로 잡았으나, 검수에서 **어느 쪽도 아닌 세 번째 종류**가
드러났다. 사용자 액션이 아닌 배경 조회가 실패했고, 그 데이터의 부재가 조용히 게이트를
약화시키거나 기능을 숨기는 경우다.

| 종류 | state 소유자 | 렌더 위치 | 톤 |
|---|---|---|---|
| **로드 에러** | 부모 페이지 | 상단 배너 | error (빨강, `role="alert"`) |
| **액션 에러** | 각 액션 컴포넌트 | 자기 컨트롤 바로 옆 | error (빨강, `role="alert"`) |
| **약화된 통제 알림** | 조회를 수행하는 쪽 | 데이터가 있었어야 할 자리 | notice (앰버, `role="status"`) |

세 번째 종류는 **state 소유자와 렌더 위치가 다를 수 있다**. state는 조회를 수행하는 쪽이
갖고(린트는 `ApplyPanel`이 직접 조회하므로 로컬, 백업·실행 이력은 부모가 조회하므로 부모),
렌더는 그 데이터를 쓰는 자리에서 한다. 부모가 가진 알림은 prop으로 내려보낸다.

세 번째 종류의 배치 규칙이 "데이터가 있었어야 할 자리"인 이유: 이 알림의 목적은 사용자를
꾸짖는 것이 아니라 **화면이 지금 진실을 다 말하고 있지 않다**는 사실을 그 자리에서 알리는
것이다. 상단 배너로 올리면 어느 정보가 빠졌는지 알 수 없다.

액션 에러를 인라인으로 두는 이유는 두 가지다. 첫째, 1069줄짜리 페이지에서 오른쪽 컬럼
하단의 버튼을 누른 사용자에게 페이지 최상단 배너는 사실상 보이지 않는다. `lg` 미만에서는
2단 그리드가 무너져 오른쪽 컬럼이 SQL 파일 목록 **전체 아래로** 내려가므로 거리가 더 벌어진다.
둘째, `rejectReasonRequired`는 입력 필드 옆에 남아야 하는 폼 검증이지 페이지 수준 에러가 아니다.

**성공 피드백은 이 스펙의 범위가 아니다.** 이 페이지에는 액션 성공을 확인해주는 수단이 없다
(결재는 상태 배지가 바뀌어 암묵적 피드백이 있으나, 담당자 변경은 저장돼도 화면이 동일하다).
토스트(로드맵 3단계 G4)의 몫이며, **누락이 아니라 기록된 유예**임을 여기 남긴다.

## 3. 액션 에러 — 소유자 재배치

부모의 `error`는 **로드 에러 전용**이 되고, `onError` prop은 전 컴포넌트에서 제거된다.

각 액션 컴포넌트가 자기 `const [error, setError] = useState('')`를 갖고, 자기 컨트롤 옆에
렌더한다. 아래가 **완전한** 소유자 목록이다(현재 파일의 `onError` 호출 13곳 전부 커버.
독립 재열거로 검증됨: 395·403·469·474·507·509·518·670·674·683·690·980·985).

| 컴포넌트 | 현재 `onError` 호출 라인 | 담당 | 렌더 위치 |
|---|---|---|---|
| `AssigneePanel` | 395, 403 | 담당자 저장 실패 | 저장 버튼 아래 (**편집 분기에만**) |
| `SubmitAction` | 469, 474 | 제출 실패 | 제출 행 아래 |
| `DecisionAction` | 507, 509, 518 | 반려 사유 검증, 검토·결재 실패 | **textarea와 버튼 행 사이** |
| `ApplyPanel` | 670, 674, 683, 690 | dry-run 실패 / 적용 실패 (**2분할**) | 각 버튼 아래 |
| `ExecutionCard` | 980, 985 | 롤백 실패 | 롤백 버튼 아래 |

### 3-1. `ExecutionHistory`가 아니라 `ExecutionCard`다

`ExecutionHistory`(917행)는 `onError`를 받아 자식에게 전달만 하고(945행) 직접 호출하지
않는다. 실제 호출자는 `ExecutionCard`(980·985행)다. state를 `ExecutionHistory`에 두면
하나의 에러 문자열이 **모든 실행 카드 밑에** 렌더된다.

**`ExecutionHistory`의 최종 prop 목록** (§4-2·§4-3과 종합한 확정본 — 여기만 보고 구현할 것):
- 제거: `onError`
- 추가: `backupsNotice: string`, `executionsNotice: string`
- 유지: `executions`, `backups`, `canRollback`, `onRolledBack`

### 3-2. `DecisionAction`은 인스턴스별 독립 state이고, 루트가 `<section>`이어야 한다

검토용과 결재용 두 인스턴스가 동시에 마운트될 수 있다(243·252행. `cr.canActAsDelegate`가
참이면 REVIEWER도 두 개를 동시에 볼 수 있다). 각자 자기 state를 가지므로 자연히 분리된다.

**루트 `<div>`(525행)를 `<section>`으로 바꾼다.** 현재 구조에서 버튼의 가장 가까운
`<section>` 조상은 `ActionPanel`의 것(239행)이고, 거기엔 `SubmitAction`과 **다른 쪽
`DecisionAction`까지** 들어 있다. 이대로 두면 §9의 containment 단언이 "에러가 어느
인스턴스 밑에 있든" 통과해 아무것도 증명하지 못한다. 한 단어 수정으로 단언이 의도대로 결합한다.

### 3-3. `DecisionAction` 에러의 정확한 위치와 접근성

**렌더 위치는 textarea(530~536행)와 버튼 행(537행) 사이 한 곳이다.** state는 하나이므로
렌더 지점도 하나여야 한다. 이 위치가 "필드 옆"과 "버튼 근처"를 동시에 만족하고, 모바일에서
버튼이 화면 하단에 있을 때 버튼 아래 렌더가 화면 밖으로 나가는 문제도 함께 피한다.

**검증 에러(`rejectReasonRequired`)에 한해** 추가로:
- textarea에 `aria-invalid={true}`와 `aria-describedby={<에러 요소 id>}`를 건다.
- textarea로 포커스를 이동한다.
  WCAG 3.3.1은 검증 실패 시 문제가 된 필드를 식별할 것을 요구한다. 문장만 읽어주고
  어느 필드가 문제인지 표시하지 않으면 스크린리더 사용자는 알 수 없다.
- **textarea `onChange`에서 로컬 에러를 지운다.** 사용자가 사유를 입력하는 중에도
  "사유를 입력해 주세요"가 남아 필드와 모순되기 때문이다.

**API 실패 에러는 입력 변경으로 지우지 않는다.** 실제 서버 결과를 서술하므로 재시도할
때까지 남아야 한다(현행대로 `act()` 시작 시 클리어).

API 실패 시 **사용자가 입력한 코멘트는 보존된다**(현행 코드가 `setComment('')`를 성공
경로에만 두고 있음). 이 페이지에서 손실 비용이 가장 큰 데이터이므로 회귀 테스트로 못 박는다(§9 #11).

### 3-4. `ApplyPanel`은 에러 state를 둘로 나누고, dry-run 에러는 prop으로 내려보낸다

`runDryRun`(670·674행)과 `apply`(683·690행)는 독립 액션이다. `dryRunError`와 `applyError`로
분리한다.

**dry-run 버튼은 `ApplyPanel`이 아니라 `DryRunSection`(845~906행, 버튼 864~870행) 안에 있다.**
따라서 `dryRunError`를 `ApplyPanel`에서 렌더하면 실패한 버튼에서 40줄 넘게 떨어져 §2의
규칙을 정면으로 어긴다. `DryRunSection`에 `error?: string` prop을 추가하고 **실행 버튼 아래,
결과 목록 위**에 렌더한다. §10의 변경 목록에 이 컴포넌트가 포함된다.

**신규 state 3개(`lintNotice`·`dryRunError`·`applyError`)는 `if (!roleAllowed) return null`
(662행)보다 위, 기존 state 선언부(605~617행)에 둔다.** 훅은 조기 반환 뒤에 올 수 없다.

## 4. 약화된 통제 알림 — fail-open 수정

### 4-1. 린트 조회 실패 → 적용 게이트가 열린다 (환경별 fail-closed)

현재 `lintChangeRequest`가 실패하면 `setLint(null)`이고, `const lintBlocked =
lint?.maxSeverity === 'BLOCK'`(664행)에서 `null`은 `false`가 된다. `canApply`(696~702행)가
`!lintBlocked`를 포함하므로, **린트가 실패하면 BLOCK 판정을 받았어야 할 CR의 적용 버튼이
활성화되고** 위험 SQL 패널(710행~)은 아무것도 렌더하지 않는다. 운영자는 초록불 버튼과
무경고 화면을 본다. 이는 단순한 정보 누락이 아니라 **적극적인 거짓 안전 신호**다.

**그러나 DEV에는 같은 방식으로 걸지 않는다.** `apps/api/src/apply/lint.engine.ts:89`의
`if (env === TargetEnv.DEV && base === 'BLOCK') return 'WARN'`은 `sql-review.service.ts`의
`getPolicyMap`이 **정책 행이 없을 때 채우는 기본값에서만** 적용된다. 저장된 행이 있으면
그 값을 그대로 쓰고(`update()`에는 DEV를 막는 가드가 없다), `lintFiles`(`lint.engine.ts`)는
정책 맵을 그대로 읽으므로 관리자가 DEV 정책을 BLOCK으로 저장해 두면 DEV에서도
`maxSeverity: 'BLOCK'`이 나올 수 있다. 게다가 `apply.service.ts`의 적용 게이트(`hasBlock`
체크)는 환경과 무관하게 동작해 STAGING/PROD만이 아니라 DEV도 막는다. 즉 **DEV에서
`maxSeverity`가 BLOCK이 될 수 없다는 보장은 없다** — 이 화면의 DEV 예외
(`lintGateRequired = cr.targetEnv !== 'DEV'`)는 서버보다 의도적으로 느슨하게 둔 표시용
게이트일 뿐이고, 서버가 항상 최종 방어선이다. 여기서 fail-closed를 걸지 않는 이유는 DEV의
평소 흐름(정책 미저장)에서 안전 이득이 없기 때문이지, DEV가 절대 막히지 않아서가 아니다.
조회 실패로 이 클라이언트 게이트를 통과해 적용을 시도해도, 저장된 DEV+BLOCK 정책이 있다면
서버가 409로 거부하며 그 메시지는 이제 `applyError`로 인라인 렌더된다.

**변경 후 `canApply` 전문** (이대로 작성할 것):

```ts
const lintBlocked = lint?.maxSeverity === 'BLOCK';
// DEV는 정책이 없을 때만 서버가 BLOCK→WARN으로 강등한다(기본값, apps/api/src/apply/lint.engine.ts:89).
// DEV에 BLOCK 정책이 명시적으로 저장돼 있으면 서버 게이트(apply.service.ts의 hasBlock, 환경 무관)가
// DEV도 막는다 — 그 경우 이 클라이언트 게이트는 의도적으로 느슨하며, 조회 실패 시 서버가 최종 방어선이다.
const lintGateRequired = cr.targetEnv !== 'DEV';
const canApply =
  gate.allowed &&
  !!selectedId &&
  !busy &&
  matching.length > 0 &&
  !lintBlocked &&
  !(lintGateRequired && lint === null) &&
  (schedule === null || schedule.allowed);
```

**재시도 수단이 반드시 있어야 한다.** 현재 린트 effect의 deps는 `[roleAllowed, cr.id]`
(655행)이고 둘 다 세션 중 바뀌지 않는다(액션 성공 후 `load()`가 새 `cr` 객체를 만들어도
`cr.id`는 같다). 즉 **한 번의 일시적 500이 브라우저 새로고침 전까지 적용을 영구히 잠근다.**
이는 스펙이 대응하려는 바로 그 장애 상황에서 스스로 유발하는 장애다.

→ 린트 조회를 `useCallback`으로 추출하고, `lintUnavailable` 알림 안에 **재시도 버튼**을 둔다
(`lintRetry` 키). 탈출 사다리: 재시도 → 페이지 새로고침 → (결정적 실패라면) 긴급 변경 fast-path.

**결정적 실패 시의 방침을 명문화한다.** 특정 CR에서 린트가 재현성 있게 500이면(정책 행 손상,
특정 파일에서 파서 크래시 등) 재시도와 새로고침 모두 실패하고, 결재까지 끝난 정상 변경이
적용 불가 상태가 된다. **이 경우의 해법은 감사 추적을 갖춘 긴급 변경 fast-path**
([ROADMAP.md](../../ROADMAP.md) Tier-2 A3)이지 **UI 우회가 아니다.** "무시하고 적용"
체크박스를 추가하지 않는다 — 제품의 무우회 약속에 뚫리는 첫 구멍이 되고, 감사 기록도
남지 않아 차단보다 나쁘다.

**서버가 권위 있는 게이트임을 기록한다.** `apps/api/src/apply/apply.service.ts`가 적용
시점에 재린트하여 `hasBlock`이면 거부한다. 이 UI 게이트는 **표시 게이트**이며, 이번 변경이
새로운 강제력을 추가한 것이 아니다. 나중에 이 조건을 완화하려는 사람이 오해하지 않도록 남긴다.

**린트 403은 도달 불가하다.** `apply.controller.ts:40`이 `:id/lint`를
`@Roles(DEVELOPER, APPROVER)`로 막는데, 이는 `applyRoleAllowed`(569~573행)가 `ApplyPanel`에
들여보내는 역할 집합과 정확히 같다. 따라서 권한 문제로 특정 역할이 영구 차단되는 경우는 없다.

### 4-2. 백업 조회 실패 → 롤백 버튼이 사라진다 (403만 조용히)

현재 `listBackups(id).catch(() => setBackups([]))`(71~73행)이고, 빈 배열은 `backupsById`를
비워 `backup`을 `undefined`로 만들고(943행), `isBackupRestorable`이 `false`를 반환해
(912~915행) `showRollback`이 꺼진다(973행). **일시적 500 하나로 유일한 데이터 복구 수단이
아무 표시 없이 증발한다.**

**403 구분의 근거** — 초판에 사실과 반대로 적었던 부분을 바로잡는다.
`apply.controller.ts:72-73`이 `:id/backups`를 `@Roles(DEVELOPER, APPROVER)`로 막는다.
즉 **DEVELOPER는 권한이 있고**, 403을 받는 쪽은 **REVIEWER와 ADMIN**이다. `loadBackups()`는
역할과 무관하게 호출되므로(80행) 이 두 역할은 **모든 CR 상세 조회에서 매번 403**을 받는다.
따라서 조용한 403은 예외가 아니라 역할 절반의 정상 경로다. (이 두 역할은 `applyRoleAllowed`도
통과하지 못해 애초에 롤백 버튼을 볼 수 없으므로, 알림을 띄우면 순수한 소음이다.)

**수정**: 부모에 `backupsNotice` state 추가. 403이면 빈 문자열(조용), 그 외면
`backupsUnavailable`. `ExecutionHistory`에 prop으로 전달한다. 판별은 같은 파일 630~638행의
`err instanceof ApiError && err.status === 403` 패턴을 그대로 복제한다 — 새 추상화 없음.

### 4-3. 실행 이력 조회 실패 → "적용된 적 없음"으로 보인다

`listExecutions(id).catch(() => setExecutions([]))`(65~67행)이고, `ExecutionHistory`는
`executions === null || executions.length === 0`이면 `null`을 반환한다(931행). 즉 조회 실패가
"이력 없음"과 구별되지 않고 섹션 전체가 사라진다. 감사 목적 제품에서 "물어보지 못했다"를
"아무 일도 없었다"로 표시하는 것은 최악의 실패 양식이다.
(`:id/executions`는 `@Roles`가 없어 전 역할이 조회 가능하므로 403 구분이 불필요하다.)

**수정**: 부모에 `executionsNotice` state 추가 → `ExecutionHistory`에 prop 전달.

`ExecutionHistory`의 렌더 규칙을 다음과 같이 확정한다.

1. `executions`가 비어 있어도 **두 알림 중 하나라도 있으면 섹션을 렌더**한다
   (그래야 알림이 표시될 자리가 생긴다).
2. `executionsNotice`가 있으면 제목을 개수 없는 `applyHistoryTitle`로 렌더한다.
   실패 시 `executions`가 `[]`이므로 기존 `t('applyHistory', { count })`는
   **"적용 이력 (0)"**을 출력하는데, 이는 §4-3이 없애려는 바로 그 거짓 음성이다.
3. `executionsNotice`가 있으면 `backupsNotice`는 **표시하지 않는다**. 이력을 못 불러온
   상황에서 백업 알림은 중복이고(대개 함께 실패한다), 롤백할 이력 자체가 없으므로 무의미하다.

### 4-4. 의도적으로 유보하는 것

**작업창 조회(`getScheduleStatus`, 619행)** — `canApply`가 `(schedule === null ||
schedule.allowed)`로 미상을 허용으로 취급한다. 그러나 616행 주석대로 실제 강제는 서버
게이트이며(`apply.service.ts`의 `assertApplyAllowed`), 이 배너는 보조 표시다. §4-1의 린트와
결정적으로 다른 점: 린트는 **초록 버튼 + 침묵하는 위험 패널**이라는 적극적 거짓 안전 신호를
만들지만, 작업창 배너는 부재해도 아무것도 주장하지 않는다.

**검토자/결재자 드롭다운 조회 실패(363~364행)** — 조회 실패 시에도 `reviewerId` state는
`cr.reviewerId`를 유지하므로 그냥 저장하면 기존 지정이 보존된다. 실질 위험은 사용자가 빈
드롭다운을 열어 "미지정"을 고르는 경우뿐이고, 그것은 감사에 남고 되돌릴 수 있다.

## 5. 같은 함수의 기존 버그 동시 수정 — `rollingBack` 미해제

`ExecutionCard.rollback`(975~988행)은 `setRollingBack(true)`(979행) 후 `catch`에서만
플래그를 되돌린다(986행). **성공 경로에 리셋이 없다.** 롤백이 성공해도 같은 `ExecutionCard`가
`exec.id` 키로 그대로 마운트된 채 남고(941행) `showRollback`도 참이므로, 버튼이 "롤백 중…"
라벨로 **영구 비활성** 상태가 된다.

어차피 이 함수의 에러 처리를 다시 쓰므로 같은 diff에서 `finally`로 옮겨 고친다. 이것이 이
스펙에서 가치가 가장 높은 회귀 수정이므로 **테스트를 반드시 붙인다**(§9 #10).

## 6. 네트워크 에러 지역화 (`apiFetch`)

**이 스펙이 만들어내는 회귀이므로 여기서 함께 처리한다.** `apiFetch`(`lib/api.ts:35`)는
`await fetch(...)`를 try/catch로 감싸지 않는다. 네트워크 끊김·DNS 실패·CORS 오류는 원시
`TypeError`로 거부되고 `(err as Error).message`가 `"Failed to fetch"`(Safari는 `"Load failed"`)가
된다. 지금은 §1의 버그가 이걸 전부 가리고 있지만, 수정 후에는 **VPN이 끊긴 한국어 결재자가
빨간 상자에 "Failed to fetch"라고 적힌 화면**을 보게 된다.

수정: `fetch` 호출을 try/catch로 감싸고 `new ApiError(0, ct('networkError'))`를 던진다.
`lib/i18n-client.ts`의 `STRINGS`에 `networkError`를 추가한다 — 이 파일은 정확히 이
"React 밖에서 쓰는 문자열" 용도로 이미 존재한다. 한 곳 수정으로 13개 화면 전부가 혜택을 본다.

## 7. 로드 에러 처리 정정

```tsx
{error && ( ...배너... )}          // `&& !cr` 제거
{!error && !cr && ...loading...}    // 현행 유지 (정상 동작)
```

- 초기 로드 실패: 배너만 보인다(`cr`이 없으므로 본문 없음).
- **성공 시 클리어**: 현재 `load()`는 성공해도 `error`를 비우지 않아 한 번 실패하면 이후
  성공해도 배너가 남는다. `.then()`에서 `setError('')`를 함께 호출한다.
- **액션 후 갱신 실패 시 `staleContent` 접두 문구를 붙인다.** `cr`이 있는 상태에서 뜨는
  배너는 원시 갱신 에러("요청에 실패했습니다 (500)")만 보여주면 **"내 승인이 실패했다"로
  읽힌다**. 실제로는 승인은 성공했고 화면 갱신만 실패한 것일 수 있다. 승인 도구에서 이
  모호성은 최악이다 — 사용자가 다시 누르면 중복 감사 기록이나 "이미 결재함" 오류가 난다.
  `cr !== null`일 때 배너를 `${t('staleContent')} ${error}` 형태로 렌더한다.

## 8. 테스트 인프라 — Vitest

### 8-1. Jest가 아닌 이유

**next-intl 4.13.4는 ESM 전용**이다 — `"type": "module"`이고 `exports["."]`의 모든 경로가
`dist/esm/...`을 가리키며 `"."` 서브패스에서 도달 가능한 CJS 빌드가 없다. Jest의 CJS
리졸버는 ESM 빌드에 착지해 "Cannot use import statement outside a module"로 죽는다.

우회로는 둘 다 나쁘다. `transformIgnorePatterns`에 pnpm의 실제 경로
(`node_modules/.pnpm/next-intl@4.13.4_@swc+helpers@...+long-hash.../node_modules/next-intl`)를
정규식으로 거는 방법은 의존성 갱신마다 깨진다. `next/jest`의 지원 경로인
`transpilePackages: ['next-intl']`는 **프로덕션 `next.config.js`를 테스트 때문에 수정**하는
것이라 커플링이 나쁘다. Vitest는 ESM 네이티브라 이 문제에 설정이 0줄 필요했다.

두 러너가 공존하지만 서로 설정·코드·런타임을 공유하지 않고(NestJS/CJS/서버 vs Next/ESM/브라우저),
둘 다 pnpm 필터로 동일하게 호출되므로 개발자 표면은 균일하다.

### 8-2. 의존성 (실측 검증된 조합)

`apps/web/package.json` devDependencies에 추가:

```json
"@testing-library/dom": "^10.4.0",
"@testing-library/jest-dom": "^6.6.3",
"@testing-library/react": "^16.1.0",
"@testing-library/user-event": "^14.5.2",
"@types/react-dom": "^18.3.0",
"jsdom": "^25.0.1",
"vitest": "^2.1.8"
```

scripts에 `"test": "vitest run"` 추가.

- **`@vitejs/plugin-react`는 넣지 않는다.** Fast Refresh/Babel용이고 esbuild가 TSX를
  처리하므로 없어도 통과한다(제거 후 실측 확인). 넣으면 vite 메이저 버전 매트릭스에 묶인다.
- **`vitest@4` + `@vitejs/plugin-react@6` 조합을 택하지 않는다.** plugin-react 6은
  `vite: ^8`을 요구해 vitest 4가 끌어오는 vite와 어긋난다.
- **`@testing-library/dom`을 직접 선언해야 한다.** RTL 16에서 peer로 바뀌었고 pnpm의
  엄격한 `node_modules`는 대신 호이스트해주지 않는다.

### 8-3. `apps/web/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // tsconfig의 jsx:"preserve"(Next 전용)를 esbuild가 물려받으므로 자동 런타임을 명시해야 한다.
  esbuild: { jsx: 'automatic' },
  // tsconfig.json의 paths("@/*": ["./*"])와 이중 원천이다. 한쪽을 바꾸면 다른 쪽도 바꿔야 한다.
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['{app,components,lib}/**/*.test.{ts,tsx}'],
  },
});
```

- `esbuild: { jsx: 'automatic' }`는 **장식이 아니라 필수**다. 빼면 JSX가 변환되지 않아
  전 테스트가 실패한다(제거 실측 확인).
- `__dirname`이 유효한 이유: `apps/web/package.json`에 `"type": "module"`이 없어 Vite가
  설정을 CJS로 번들한다.

### 8-4. `apps/web/vitest.setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
```

이게 전부다. `matchMedia`·`fetch` 폴리필·`ResizeObserver` 모두 불필요.

### 8-5. 테스트에서 이 페이지를 렌더하기 위한 요구사항

**(a) `useRouter` mock은 안정된 참조여야 한다 — 가장 위험한 함정.**

```ts
const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/change-requests/cr1',
  useSearchParams: () => new URLSearchParams(),
}));
```

매 렌더 새 객체를 반환하는 흔한 형태(`useRouter: () => ({ replace: vi.fn() })`)를 쓰면
`lib/auth.ts`의 `useCurrentUser`가 가진 `useEffect(..., [router])`가
effect → setState → 리렌더 → 새 router → effect … 로 무한 루프를 돈다. 증상이
**힙 OOM(`Reached heap limit`) + `Worker exited unexpectedly` + "tests 0ms"**여서
import 실패처럼 보이고 원인 추적이 매우 어렵다. `vi.hoisted`를 쓰는 이유는 `vi.mock`이
호이스팅되어 평범한 `const`보다 먼저 평가되기 때문이다.

`next/navigation` mock 자체는 필수다 — App Router 컨텍스트 밖에서 `useRouter`는 invariant로 throw한다.

**(b) `@/lib/auth`는 mock하지 않는다.** `localStorage`에 `user`와 `accessToken`을
`beforeEach`에서 심어 실제 훅을 태운다. 심지 않으면 훅이 `router.replace('/login')`을
호출하고 `ready`가 false로 남아 페이지가 로딩 문구만 렌더한다(83~85행).

**(c) `@/lib/api`는 `importOriginal`로 스프레드하고, import된 API 함수를 전부 mock한다.**

```ts
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getChangeRequest: vi.fn(), listExecutions: vi.fn(), listBackups: vi.fn(),
  listTargetDatabases: vi.fn(), lintChangeRequest: vi.fn(),
  getScheduleStatus: vi.fn(), listUsersByRole: vi.fn(),
  submitChangeRequest: vi.fn(), reviewChangeRequest: vi.fn(), approveChangeRequest: vi.fn(),
  applyChangeRequest: vi.fn(), dryRunChangeRequest: vi.fn(),
  rollbackExecution: vi.fn(), setAssignees: vi.fn(),
}));
```

이유: `ApplyPanel`이 `err instanceof ApiError`(634행)를 하므로 합성 mock에서 `ApiError`가
`undefined`가 되면 "Right-hand side of 'instanceof' is not callable"로 죽는다. 또한 mock된
함수는 **반드시 프로미스를 반환**해야 한다 — 호출부가 반환값에 곧바로 `.then()`을 건다
(59·65·71·363·364·619·628·649행). `beforeEach`에서 전부 `mockResolvedValue` 기본값을 준다.
안 그러면 미처리 거부가 테스트 간에 샌다.

**(d) `NextIntlClientProvider`에 `locale` · `messages` · `timeZone`을 모두 준다.**
실제 카탈로그를 쓴다(`import messages from '@/messages/en.json'`). 스텁을 쓰면
`t('rejectReasonRequired')` 단언이 자기 픽스처를 검사하는 꼴이 된다. `useTimeZone()`은
미설정 시 throw하지 않고 `undefined`를 반환하는데 602행이 `useTimeZone()!`로 단언하므로
`undefined`가 조용히 `Intl.DateTimeFormat`에 들어간다. `timeZone="Asia/Seoul"`을 준다.

**(e) `params`는 동기 프롭이다** — `<Page params={{ id: 'cr1' }} />`. Promise는 Next 15다.

**(f) 비동기 규율**: 마운트 시 프로미스 3개 + `ApplyPanel`에서 3개가 더 뜬다. 모든 단언은
`await screen.findBy*` / `waitFor`를 거친다.

**(g) `window.confirm`은 jsdom에 미구현**이라 `undefined`(falsy)를 반환한다 — 롤백(976행)이
아예 실행되지 않는다. 롤백 테스트(§9 #10)는 반드시 스텁한다.

**(h) 테스트 파일에서 `describe/it/expect/vi`를 `vitest`에서 명시 import한다.**
설정에 `globals: true`가 있어도 그렇게 한다. CI의 `tsc --noEmit`이 테스트 파일까지
검사하는데(`tsconfig.json:31-35`가 `**/*.ts(x)`를 포함), 전역 심볼은 타입 해석이 안 된다.
**`"types": ["vitest/globals"]`를 추가하는 우회는 함정이다** — `types` 배열을 설정하는
순간 `@types` 자동 포함이 꺼져 `@types/node`가 죽고 `lib/api.ts:4`의 `process.env`가 깨진다.

테스트 파일 위치는 대상 옆(`app/(app)/change-requests/[id]/page.test.tsx`)에 둔다.
`[id]` 디렉터리명이 글롭 매칭 문제를 일으키지 않음을 실측으로 확인했고, Next는
`page.tsx`만 라우트로 매칭하므로 `page.test.tsx`는 라우트가 되지 않는다.

## 9. 테스트 명세 (12개 + 카탈로그 대칭 1개)

| # | 시나리오 | 단언 |
|---|---|---|
| 1 | 빈 코멘트로 반려 클릭 | 사유 메시지가 **해당 `DecisionAction`의 `<section>` 안**(§3-2 수정 후)에 있고, textarea가 `aria-invalid`이며 포커스를 받음 |
| 2 | 승인 API 거부 | 에러가 해당 `DecisionAction` 섹션 안에 존재 |
| 3 | 초기 로드 실패 | 상단 배너 표시 (**positive control** — 현재도 통과) |
| 4 | 로드 성공 후 갱신 실패 | 배너에 `staleContent` 문구 포함 **그리고** `cr.title`이 여전히 존재 |
| 5 | 에러 발생 후 재시도 성공 | 이전 에러 메시지가 사라짐 |
| 6 | **PROD**에서 린트 조회 실패 | 적용 버튼 비활성 + `lintUnavailable` 알림 + 재시도 버튼 존재 |
| 7 | **DEV**에서 린트 조회 실패 | 적용 버튼이 **비활성이 아님** + 알림은 표시됨 (§4-1 DEV 예외 회귀) |
| 8 | 린트 재시도 클릭 → 성공 | 알림이 사라지고 적용 버튼이 활성화됨 |
| 9 | 백업 조회 500 / 403 | 500이면 `backupsUnavailable` 표시. 403 케이스는 **실행 이력 1건 이상을 픽스처로 두어 섹션이 렌더되게 한 뒤**, 섹션이 존재하면서 알림이 없음을 단언 |
| 10 | 롤백 성공 (`window.confirm` 스텁) | 버튼이 다시 활성화되고 라벨이 `rollingBack`이 아님 (§5 회귀) |
| 11 | 결재 실패 | 사용자가 입력한 코멘트가 보존됨 |
| 12 | dry-run 실패 | 에러가 `DryRunSection` 안에 있고 적용 버튼 인접이 **아님** |
| — | en/ko 카탈로그 대칭 | `flatKeys(en)`과 `flatKeys(ko)`가 동일 (별도 소형 테스트) |

**#1·#2의 containment 단언이 이 명세의 핵심이며, §3-2의 `<section>` 수정이 선행되어야
의미를 갖는다.** 단순히 `expect(screen.getByRole('alert')).toBeTruthy()`로 쓰면 89행 조건만
지우고 인라인 배치를 전혀 하지 않아도 통과한다. `within(...).getByRole('alert')` 형태로
포함 관계를 단언한다. `role="alert"` 개수 단언은 **섹션 범위로 한정**한다(페이지 전체로 잡으면
나중에 에러 톤 컴포넌트가 하나만 늘어도 깨진다).

**#3(positive control)을 빼지 않는다.** 이것이 없으면 초록 스위트가 "버그가 고쳐짐"과
"테스트가 애초에 아무것도 렌더하지 않음"을 구별하지 못한다.

**#9의 403 케이스는 픽스처에 실행 이력이 없으면 공허하다** — `ExecutionHistory`가 통째로
`null`을 반환하므로 "알림 없음"이 컴포넌트를 삭제해도 통과한다.

단언은 렌더된 텍스트/DOM에 대해서만 한다. `expect(approveChangeRequest).toHaveBeenCalled()`
류는 mock을 검사할 뿐 수정 사항을 검증하지 않으므로 쓰지 않는다.

**카탈로그 대칭 테스트를 넣는 이유**: 현재 en/ko 키 대칭을 강제하는 장치가 전혀 없고
(CI는 api 테스트 + `tsc` + `next build`만 실행), next-intl은 키 누락 시 throw하지 않고
`getMessageFallback`으로 **키 경로 문자열을 그대로 화면에 출력**한다. 즉 ko 키를 빠뜨리면
`changeRequestDetail.lintUnavailable`이 UI에 노출된 채 배포된다. 러너를 세우는 김에 넣는다.

## 10. 신규 i18n 문자열 (확정 문안)

전부 `changeRequestDetail` 네임스페이스. 기존 카탈로그 어조 `[사실 서술]. [행동 안내].`를 따른다.

```jsonc
// apps/web/messages/en.json → changeRequestDetail
"lintUnavailable": "Could not load the risky-SQL check result, so this change cannot be applied. Please retry; if it keeps failing, contact your administrator.",
"lintRetry": "Check again",
"backupsUnavailable": "Could not load the backup list, so the rollback option stays hidden even if a backup exists. Please reload the page.",
"executionsUnavailable": "Could not load the apply history. This does not mean the change was never applied. Please reload the page to check.",
"applyHistoryTitle": "Apply history",
"staleContent": "Could not refresh this page, so the content below may be out of date.",
```

```jsonc
// apps/web/messages/ko.json → changeRequestDetail
"lintUnavailable": "위험 SQL 검사 결과를 불러오지 못해 적용할 수 없습니다. 다시 시도해 주세요. 계속 실패하면 관리자에게 문의하세요.",
"lintRetry": "다시 확인",
"backupsUnavailable": "백업 목록을 불러오지 못했습니다. 백업이 있어도 롤백 버튼이 표시되지 않으니 페이지를 새로고침해 주세요.",
"executionsUnavailable": "적용 이력을 불러오지 못했습니다. 적용된 적이 없다는 뜻이 아닙니다. 페이지를 새로고침해 확인해 주세요.",
"applyHistoryTitle": "적용 이력",
"staleContent": "화면을 갱신하지 못했습니다. 아래 내용은 최신이 아닐 수 있습니다.",
```

```ts
// apps/web/lib/i18n-client.ts → STRINGS
networkError: {
  en: 'Cannot reach the server. Check your network connection and try again.',
  ko: '서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
},
```

각 문안은 실패 사실뿐 아니라 **결과**를 말한다. `backupsUnavailable`이 롤백 버튼이 숨겨진다고
명시하지 않으면 사용자는 앰버 상자와 사라진 버튼을 연결하지 못하고, `executionsUnavailable`의
"적용된 적이 없다는 뜻이 아닙니다"는 §4-3의 존재 이유 그 자체다.

**세 알림 모두 `notice`(앰버/`role="status"`)다.** `lintUnavailable`은 "위험을 발견했다"가
아니라 "확인하지 못했다"이고, 빨강은 이미 `lintBlockedMessage`(위험 발견)와 액션 실패가
쓰고 있다. 적용을 막는 앰버라는 선례도 이미 있다 — `gateNotFinalApproved`(746~750행).

## 11. 공용 컴포넌트 — `components/inline-error.tsx`

```tsx
export function InlineError({
  message,
  tone = 'error',
  className,
  id,
}: {
  message?: string;
  tone?: 'error' | 'notice';
  className?: string;
  id?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} role={tone === 'error' ? 'alert' : 'status'} className={cx(base[tone], className)}>
      {message}
    </p>
  );
}
```

- `tone='error'`: `rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300`
- `tone='notice'`: 기존 앰버 알림 클래스 (`dbNotice` 렌더에 쓰이는 것과 동일)
- **여백은 톤 클래스에 넣지 않고 `className`으로 호출부가 준다.** 기존 알림 렌더는 `mt-3`을
  포함하지만(747·753행) 상단 배너는 아니다(90행). 톤 클래스에 넣으면 배너에 원치 않는
  여백이 생긴다.
- `id`는 §3-3의 `aria-describedby` 연결용이다.

**기존 알림도 이 컴포넌트로 통합한다**: 상단 로드 배너(89~93행), `dbNotice`(752~756행).

**통합하지 않는 것**:
- **`gate.reasonKey`(746~750행)** — 정적 표시이지 갱신이 아니다. `role="status"`를 주면
  렌더마다 라이브 리전으로 읽히는 접근성 퇴행이 된다.
- **적용 결과 FAILED 블록(829~839행)** — 단문이 아니라 상태·단계·상세를 담은 리치 결과 표시다.
  (참고: `lib/api.ts:349` 주석대로 적용 실패는 HTTP 200으로 오므로 애초에 에러 경로가 아니다.)

**비활성 적용 버튼이 이유를 스스로 설명하지 않는 문제는 로드맵 4단계 E6(적용 준비 체크리스트
위젯)로 유예한다.** 유예 조건은 "그 이유로 비활성일 때 이유가 화면에 보일 것"이며 충족된다 —
`lintNotice`가 같은 `<section>` 안 버튼 위에 렌더된다. `disabled` 버튼은 탭 순서에서 빠져
스크린리더가 도달하지 못하므로 `aria-describedby`를 걸어도 소용이 없다. 올바른 해법은
`aria-disabled` + 무동작 핸들러를 **모든 비활성 사유에 일괄** 적용하는 것이고 그것이 E6의 몫이다.

## 12. 파일 변경 목록

**신규**
- `apps/web/components/inline-error.tsx`
- `apps/web/vitest.config.ts`
- `apps/web/vitest.setup.ts`
- `apps/web/app/(app)/change-requests/[id]/page.test.tsx`
- `apps/web/messages/messages.test.ts` (en/ko 대칭)

**수정**
- `apps/web/app/(app)/change-requests/[id]/page.tsx` — 89행 조건 + `staleContent`,
  `load()` 성공 시 클리어, `onError` prop 제거(147/154/161/171, `ActionPanel` 241/248/257,
  `ExecutionHistory` 945), 5개 컴포넌트 로컬 error state + `InlineError`,
  `DecisionAction` 루트 `<div>`→`<section>` 및 에러를 textarea·버튼 사이로 + aria,
  `ApplyPanel` 에러 2분할 + 린트 환경별 fail-closed + `useCallback` 재시도,
  `DryRunSection`에 `error` prop, `loadBackups`/`loadExecutions` 403 구분 및 알림 state,
  `ExecutionHistory` 렌더 규칙 3항, `ExecutionCard.rollback`의 `finally`
- `apps/web/lib/api.ts` — `apiFetch`의 `fetch` try/catch → `networkError`
- `apps/web/lib/i18n-client.ts` — `networkError` 문자열
- `apps/web/messages/en.json`, `apps/web/messages/ko.json` — 신규 키 6개
- `apps/web/package.json` — devDeps 7개, `"test": "vitest run"`
- `package.json`(루트) — `"web:test": "pnpm --filter @dbflow/web test"`
  (기존 `api:test`와 같은 `<app>:<task>` 규약. `"test": "pnpm -r test"` 같은 전역 스크립트는
  만들지 않는다 — 스크립트 없는 패키지를 조용히 건너뛰어 web 테스트가 사라져도 CI가 초록이 된다.)
- `.github/workflows/ci.yml` — `web 타입 검사`와 `web 빌드` 사이에 삽입:
  ```yaml
  - name: web 테스트
    run: pnpm --filter @dbflow/web test
  ```
- `pnpm-lock.yaml` — **반드시 같은 커밋에 포함**(ci.yml:34 `--frozen-lockfile`)
- `docs/feature-checklist.md`, `docs/ROADMAP.md`

## 13. 태스크 분해와 커밋 규율

**단일 커밋으로 랜딩한다.** red→green은 **로컬 검증 순서**이지 커밋 순서가 아니다.
인프라와 테스트만 먼저 커밋하면 실패하는 테스트와 CI 스텝이 main에 올라가 빌드가 깨진다.

권장 태스크 순서(모두 한 커밋으로 스쿼시):

1. **Vitest 인프라** — 설정 2개, devDeps, `test` 스크립트, 루트 `web:test`, lockfile,
   스모크 테스트 1개. 단독으로 초록.
2. **`InlineError` + 기존 알림 통합** + `DecisionAction` 루트 `<div>`→`<section>`.
   **③보다 먼저 와야 한다** — 안 그러면 ③의 containment 단언이 잘못된 조상에 대해 작성된다.
3. **테스트 12개 + 대칭 테스트를 미수정 코드에 대해 작성.** 리뷰어의 임무는
   1·2·4·6·7·8·9·10·12가 **올바른 이유로**(import 오류가 아니라 단언 실패로) red인지 확인하는 것.
4. **동작 변경** — §3·§4·§5·§6·§7 전부. 스위트가 green이 된다.
5. **CI 스텝 + 문서** — ③이 red인 동안 CI 스텝을 커밋하지 않는다.

## 14. 검증 방법

1. `pnpm --filter @dbflow/web test` — 태스크 3 시점에 red, 태스크 4 이후 전부 green.
2. `pnpm --filter @dbflow/web exec tsc --noEmit` — 0 종료 (테스트 파일 포함).
3. `pnpm --filter @dbflow/web build` — 성공.
4. `pnpm --filter @dbflow/api test` — 기존 회귀 없음.
5. 수동 QA: `./start.sh` 후 반려 사유 없이 반려 클릭 → textarea 아래 메시지와 포커스 확인.

## 15. 범위 밖 (의도적)

- **토스트/성공 확인** — 로드맵 3단계 G4. §2 말미에 기록된 유예.
- **다른 12개 화면의 `role="alert"` 스윕** — 그 화면들엔 이 게이팅 버그가 없다.
- **1069줄 파일 분해** — 후속 기능 작업에서. 지금 하면 diff가 리뷰 불가능해진다.
- **작업창 조회 알림, 담당자 드롭다운 조회 실패** — §4-4에 근거 기록.
- **상단 로드 배너의 재시도 버튼** — 있으면 좋으나(SHOULD) 여기서는 브라우저 새로고침이
  실제로 통하고 아무것도 비활성화되지 않으므로 §4-1의 린트 재시도(MUST)와 우선순위가 다르다.
- **PROD 승인/반려의 확인 단계** — 롤백에는 `window.confirm`이 있으나(976행) 결재에는 없다.
  통제 절차 제품에서 오클릭 PROD 승인은 거버넌스 사건이므로 `roadmap-ux-candidates.md`에
  후보로 기록한다.
