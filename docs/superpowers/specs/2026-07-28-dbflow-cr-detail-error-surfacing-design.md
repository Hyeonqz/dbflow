# CR 상세 페이지 에러 표면화 + 프론트엔드 테스트 인프라 설계

> 작성 2026-07-28. UX 로드맵 **0단계**([roadmap-ux-candidates.md](../../roadmap-ux-candidates.md) §0, [ROADMAP.md](../../ROADMAP.md) "UX 기능 개발 리스트").
> 검수 완료: 설계 비평(ACCEPT WITH CHANGES) + 테스트 인프라 실측 프로토타이핑(red→green 확인).
> 규모: **M** (당초 S로 추정했으나 검수에서 fail-open 2건과 테스트 인프라 부재가 드러나 상향).

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

| 종류 | 소유자 | 렌더 위치 | 역할 |
|---|---|---|---|
| **로드 에러** | 부모 페이지 | 상단 배너 | CR 본문을 못 불러옴 |
| **액션 에러** | 각 액션 컴포넌트 | 자기 버튼 바로 아래 | 사용자가 누른 것이 실패함 |
| **약화된 통제 알림** | 조회를 수행하는 쪽 | 데이터가 있었어야 할 자리 | 배경 조회 실패로 통제가 느슨해졌음을 알림 |

세 번째 종류는 **state 소유자와 렌더 위치가 다를 수 있다**. state는 조회를 수행하는 쪽이
갖고(린트는 `ApplyPanel`이 직접 조회하므로 로컬, 백업·실행 이력은 부모가 조회하므로 부모),
렌더는 그 데이터를 쓰는 자리에서 한다. 부모가 가진 알림은 prop으로 내려보낸다.

세 번째 종류의 배치 규칙이 "데이터가 있었어야 할 자리"인 이유: 이 알림의 목적은 사용자를
꾸짖는 것이 아니라 **화면이 지금 진실을 다 말하고 있지 않다**는 사실을 그 자리에서 알리는
것이다. 상단 배너로 올리면 어느 정보가 빠졌는지 알 수 없다.

액션 에러를 인라인으로 두는 이유는 두 가지다. 첫째, 1069줄짜리 페이지에서 오른쪽 컬럼
하단의 버튼을 누른 사용자에게 페이지 최상단 배너는 사실상 보이지 않는다. 둘째,
`rejectReasonRequired`는 textarea 옆에 남아야 하는 폼 검증이지 페이지 수준 에러가 아니다.

## 3. 액션 에러 — 소유자 재배치

부모의 `error`는 **로드 에러 전용**이 되고, `onError` prop은 전 컴포넌트에서 제거된다.
결과적으로 부모 코드는 짧아진다.

각 액션 컴포넌트가 자기 `const [error, setError] = useState('')`를 갖고, 자기 컨트롤 아래에
렌더한다. 아래가 **완전한** 소유자 목록이다(현재 파일의 `onError` 호출 13곳 전부 커버).

| 컴포넌트 | 현재 `onError` 호출 라인 | 담당 |
|---|---|---|
| `AssigneePanel` | 395, 403 | 담당자 저장 실패 |
| `SubmitAction` | 469, 474 | 제출 실패 |
| `DecisionAction` | 507, 509, 518 | 반려 사유 검증, 검토·결재 실패 |
| `ApplyPanel` | 670, 674, 683, 690 | dry-run 실패, 적용 실패 |
| `ExecutionCard` | 980, 985 | 롤백 실패 |

**주의 1 — `ExecutionHistory`가 아니라 `ExecutionCard`다.** `ExecutionHistory`(917행)는
`onError`를 받아 자식에게 전달만 하고(945행) 직접 호출하지 않는다. 실제 호출자는
`ExecutionCard`(980·985행)다. state를 `ExecutionHistory`에 두면 하나의 에러 문자열이
**모든 실행 카드 밑에** 렌더되거나 엉뚱한 카드에 붙는다. `ExecutionHistory`는 `onError`
prop을 잃기만 한다.

**주의 2 — `DecisionAction`은 인스턴스별 독립 state다.** 검토용과 결재용 두 인스턴스가
동시에 마운트될 수 있다(243·252행). 각자 자기 state를 가지므로 자연히 분리된다.
현재의 공유 문자열보다 개선이다.

**주의 3 — `ApplyPanel`은 에러 state를 둘로 나눈다.** `runDryRun`(670·674행)과
`apply`(683·690행)는 독립 액션이고, dry-run 버튼은 `DryRunSection`(845~906행) 안에 있어
적용 버튼과 60줄 떨어져 있다. 하나의 state를 쓰면 dry-run 실패가 적용 버튼 밑에 뜬다.
`dryRunError`와 `applyError`로 분리한다.

## 4. 약화된 통제 알림 — fail-open 2건 수정

### 4-1. 린트 조회 실패 → 적용 게이트가 열린다 (fail-closed로 전환)

현재 `lintChangeRequest(cr.id).catch(() => setLint(null))`(649행, 주석 "린트 실패는 적용을
막지 않되 표시만 생략")이고, `const lintBlocked = lint?.maxSeverity === 'BLOCK'`(664행)에서
`null`은 `false`가 된다. 그리고 `canApply`(696행~)가 `!lintBlocked`를 포함한다.

결과: **린트 엔드포인트가 실패하면 BLOCK 판정을 받았어야 할 CR의 적용 버튼이 활성화되고**,
위험 SQL 패널(710행~)은 아무것도 렌더하지 않는다. 운영자는 초록불 버튼과 무경고 화면을 본다.
서버가 적용 시점에 재검사하더라도, 화면이 거짓 안전 신호를 주는 것 자체가
"통제된 절차"를 표방하는 제품에서 허용될 수 없다.

**수정**: `ApplyPanel`에 `lintNotice` state를 추가한다.
- `canApply`의 `!lintBlocked`를 `lint !== null && !lintBlocked`로 바꾼다 (fail-closed).
- 조회 실패 시 `lintNotice`를 설정하고, 위험 SQL 패널이 렌더됐어야 할 자리에 알림으로 표시한다.
- 신규 i18n 키 `lintUnavailable`: 위험도 검사를 확인할 수 없어 적용할 수 없다는 안내.

### 4-2. 백업 조회 실패 → 롤백 버튼이 사라진다 (403만 조용히)

현재 `listBackups(id).catch(() => setBackups([]))`(71~73행)이고, 빈 배열은
`backupsById`를 비워 `backup`을 `undefined`로 만들고(943행), `isBackupRestorable`이
`false`를 반환해(912~915행) `showRollback`이 꺼진다(973행).

결과: **일시적 500 하나로 유일한 데이터 복구 수단이 아무 표시 없이 증발한다.**

403은 정당한 경우다 — DEVELOPER는 백업 목록 조회 권한이 없을 수 있다. 따라서 403과
그 외를 구분한다. **같은 파일에 이미 이 패턴이 있다**: `dbNotice`(630~638행)가
`err instanceof ApiError && err.status === 403`으로 갈라 `dbNoticeForbidden`을 쓴다.
새 추상화 없이 이 모양을 그대로 복제한다.

**수정**: 부모에 `backupsNotice` state 추가. 403이면 빈 문자열(조용), 그 외면 메시지.
`ExecutionHistory`에 prop으로 전달해 적용 이력 섹션 제목 바로 아래에 알림으로 렌더한다.
신규 i18n 키 `backupsUnavailable`.

### 4-3. 실행 이력 조회 실패 → "적용된 적 없음"으로 보인다 (덤으로 수정)

`listExecutions(id).catch(() => setExecutions([]))`(65~67행)이고,
`ExecutionHistory`는 `executions === null || executions.length === 0`이면 `null`을
반환한다(931행). 즉 조회 실패가 "이력 없음"과 구별되지 않고 섹션 전체가 사라진다.

감사 목적 제품에서 "물어보지 못했다"를 "아무 일도 없었다"로 표시하는 것은 최악의 실패
양식이다. 부모에 `executionsNotice` state를 추가해 `ExecutionHistory`에 prop으로 내린다.

`ExecutionHistory`의 조기 반환 조건을 바꾼다: 현재 `executions === null || executions.length === 0`이면
`null`을 반환하는데(931행), **두 알림(`executionsNotice`·`backupsNotice`) 중 하나라도 있으면
목록이 비어 있어도 섹션을 렌더**하도록 한다. 그래야 "이력 조회 실패" 알림이 표시될 자리가 생긴다.
신규 i18n 키 `executionsUnavailable`.

### 4-4. 의도적으로 유보하는 것 — 작업창 조회

`getScheduleStatus(...).catch(() => setSchedule(null))`(619행)도 같은 부류이고,
`canApply`가 `(schedule === null || schedule.allowed)`로 미상을 허용으로 취급한다.
그러나 616행 주석이 명시하듯 **작업창/동결의 실제 강제는 서버 게이트**이며 이 배너는
보조 표시다. 4-1의 린트와 달리 화면 게이트가 유일한 방어선이 아니다. 이번 범위에서
제외하되, 그 근거를 여기 기록해 다음 사람이 "빠뜨린 것"으로 오해하지 않게 한다.

같은 이유로 `listUsersByRole` 실패 시 빈 드롭다운(363~364행)도 유보한다.

## 5. 같은 함수의 기존 버그 동시 수정 — `rollingBack` 미해제

`ExecutionCard.rollback`(975~988행)은 `setRollingBack(true)`(979행) 후, `catch`에서만
플래그를 되돌린다(986행). **성공 경로에 리셋이 없다.** 롤백이 성공하면 `onRolledBack()`이
갱신을 돌지만 같은 `ExecutionCard`가 `exec.id` 키로 그대로 마운트된 채 남아(941행),
`showRollback`이 여전히 참이므로 버튼이 "롤백 중…" 라벨로 **영구 비활성** 상태가 된다.

어차피 이 함수의 에러 처리를 다시 쓰므로 같은 diff에서 `finally`로 옮겨 고친다.
바로 윗줄을 건드리면서 버그를 남겨두지 않는다.

## 6. 공용 컴포넌트 — `components/inline-error.tsx`

```tsx
export function InlineError({
  message,
  tone = 'error',
  className,
}: {
  message?: string;
  tone?: 'error' | 'notice';
  className?: string;
}) {
  if (!message) return null;
  // error는 즉시 주의가 필요하므로 assertive(alert), notice는 polite(status).
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={...}>
      {message}
    </p>
  );
}
```

- `tone='error'`: 기존 빨간 배너 클래스
  (`rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300`)
- `tone='notice'`: 기존 앰버 알림 클래스 (`dbNotice` 렌더에 이미 쓰이는 스타일)

**기존 알림도 이 컴포넌트로 통합한다.** 그러지 않으면 한 파일 안에 빨강/앰버 처리가
5가지로 흩어져 오히려 일관성이 나빠진다. 통합 대상: 상단 로드 배너, 신규 액션 에러 5곳,
신규 알림 3곳, 기존 `dbNotice`(752~756행), 기존 `gate.reasonKey`(746~750행).

**통합하지 않는 것**: 적용 결과 FAILED 블록(829~839행)은 단문 메시지가 아니라 상태·단계·
상세를 담은 리치 결과 표시다. 그대로 둔다. (참고: `lib/api.ts:349` 주석대로 적용 실패는
HTTP 200으로 돌아오므로 애초에 `onError` 경로를 타지 않는다.)

## 7. 로드 에러 처리 정정

```tsx
{error && ( ...배너... )}          // `&& !cr` 제거
{!error && !cr && ...loading...}    // 현행 유지 (정상 동작)
```

- 초기 로드 실패: 배너만 보인다(`cr`이 없으므로 본문 없음).
- 액션 후 갱신 실패: 배너 + 기존(직전) 내용이 함께 보인다. 사용자는 화면 내용이
  최신이 아님을 알 수 있다.
- **성공 시 클리어**: 현재 `load()`는 성공해도 `error`를 비우지 않는다. 한 번 실패하면
  이후 성공해도 배너가 남는다. `.then()`에서 `setError('')`를 함께 호출한다.

## 8. 테스트 인프라 — Vitest

### 8-1. Jest가 아닌 이유 (양쪽 검수가 독립적으로 같은 결론)

`apps/api`가 Jest를 쓰므로 모노레포 일관성상 Jest가 자연스러워 보이지만, 실측 결과 막힌다.
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
  `vite: ^8`을 요구해 vitest 4가 끌어오는 vite와 어긋난다. 이득 없는 버전 매트릭스 고통이다.
- **`@testing-library/dom`을 직접 선언해야 한다.** RTL 16에서 peer로 바뀌었고 pnpm의
  엄격한 `node_modules`는 대신 호이스트해주지 않는다.

### 8-3. `apps/web/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // tsconfig의 jsx:"preserve"(Next 전용)를 esbuild가 물려받으므로 자동 런타임을 명시해야 한다.
  esbuild: { jsx: 'automatic' },
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
- `@` alias는 `tsconfig.json`의 `paths`(`"@/*": ["./*"]`)를 미러링한다. alias 하나뿐이라
  `vite-tsconfig-paths`는 불필요하다. 두 곳이 진실의 원천이 되므로 설정에 주석으로
  tsconfig를 가리킨다.

### 8-4. `apps/web/vitest.setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
```

이게 전부다. `matchMedia` mock 불필요(`components/theme.tsx`만 쓰는데 이 테스트는 루트
레이아웃을 렌더하지 않음), `fetch` 폴리필 불필요(`lib/api`를 mock함), `ResizeObserver` 불필요.

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

**(c) `@/lib/api`는 `importOriginal`로 스프레드한다.**

```ts
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getChangeRequest: vi.fn(), listExecutions: vi.fn(), listBackups: vi.fn(),
  submitChangeRequest: vi.fn(), approveChangeRequest: vi.fn(), reviewChangeRequest: vi.fn(),
  listTargetDatabases: vi.fn(), lintChangeRequest: vi.fn(),
  getScheduleStatus: vi.fn(), listUsersByRole: vi.fn(),
}));
```

이유: `ApplyPanel`이 `err instanceof ApiError`(634행)를 하므로 합성 mock에서 `ApiError`가
`undefined`가 되면 "Right-hand side of 'instanceof' is not callable"로 죽는다. 또한 mock된
함수는 **반드시 프로미스를 반환**해야 한다 — 호출부가 반환값에 곧바로 `.then()`을 건다
(59·65·71·363·619·649행). `beforeEach`에서 전부 기본값(`mockResolvedValue`)을 준다.
안 그러면 미처리 거부가 테스트 간에 샌다.

**(d) `NextIntlClientProvider`에 `locale` · `messages` · `timeZone`을 모두 준다.**
실제 카탈로그를 쓴다(`import messages from '@/messages/en.json'`; Vite가 JSON을 네이티브
처리하고 `resolveJsonModule`이 이미 켜져 있다). 스텁을 쓰면 `t('rejectReasonRequired')`
단언이 자기 픽스처를 검사하는 꼴이 된다. `useTimeZone()`은 미설정 시 throw하지 않고
`undefined`를 반환하는데 602행이 `useTimeZone()!`로 단언하므로 `undefined`가 조용히
`Intl.DateTimeFormat`에 들어간다. `i18n/request.ts`에 맞춰 `timeZone="Asia/Seoul"`을 준다.

**(e) `params`는 동기 프롭이다** — `<Page params={{ id: 'cr1' }} />`. Promise는 Next 15다.

**(f) 비동기 규율**: 마운트 시 프로미스 3개 + `ApplyPanel`에서 3개가 더 뜬다. 모든 단언은
`await screen.findBy*` / `waitFor`를 거친다. `getBy*`를 즉시 쓰면 `act()` 경고와
순서 의존 플레이크가 난다.

**(g) `window.confirm`은 jsdom에 미구현**이라 `undefined`(falsy)를 반환한다 —
롤백(976행)은 아예 실행되지 않는다. 롤백 관련 테스트를 쓸 때 반드시 스텁한다.

**(h) 테스트 파일에서 `describe/it/expect/vi`를 `vitest`에서 명시 import한다.**
설정에 `globals: true`가 있어도 그렇게 한다. CI의 `tsc --noEmit`이 테스트 파일까지
검사하는데(`tsconfig.json:31-35`가 `**/*.ts(x)`를 포함), 전역 심볼은 타입 해석이 안 된다.
**`"types": ["vitest/globals"]`를 추가하는 우회는 함정이다** — `types` 배열을 설정하는
순간 `@types` 자동 포함이 꺼져 `@types/node`가 죽고 `lib/api.ts:4`의 `process.env`가 깨진다.

테스트 파일 위치는 대상 옆(`app/(app)/change-requests/[id]/page.test.tsx`)에 둔다.
`[id]` 디렉터리명이 글롭 매칭 문제를 일으키지 않음을 실측으로 확인했고, Next는
`page.tsx`만 라우트로 매칭하므로 `page.test.tsx`는 라우트가 되지 않는다.

## 9. 테스트 명세 (7개)

| # | 시나리오 | 단언 |
|---|---|---|
| 1 | 빈 코멘트로 반려 클릭 | 사유 필수 메시지가 **승인/반려 버튼의 상위 `<section>` 안에** 존재하고, 페이지 전체 `role="alert"`가 정확히 1개 |
| 2 | 승인 API 거부 | 에러 메시지가 해당 버튼의 상위 섹션 안에 존재 |
| 3 | 초기 로드 실패 | 상단 배너 표시 (**positive control** — 현재도 통과) |
| 4 | 로드 성공 후 갱신 실패 | 배너 표시 **그리고** `cr.title`이 여전히 화면에 존재 |
| 5 | 에러 발생 후 재시도 성공 | 이전 에러 메시지가 사라짐 |
| 6 | 린트 조회 실패 | 적용 버튼이 비활성 **그리고** `lintUnavailable` 알림 표시 (fail-closed 회귀) |
| 7 | 백업 조회 500 / 403 | 500이면 `backupsUnavailable` 알림, 403이면 알림 없음 |

**#1·#2의 containment 단언이 이 명세의 핵심이다.** 단순히
`expect(screen.getByRole('alert')).toBeTruthy()`로 쓰면, 89행의 조건만 지우고 인라인
배치를 전혀 하지 않아도 통과한다 — 즉 설계의 주장을 아무것도 증명하지 못하는 공허한
테스트가 된다. `within(button.closest('section')!).getByRole('alert')` 형태로 포함 관계를
단언한다.

**#3(positive control)을 빼지 않는다.** 이것이 없으면 초록 스위트가 "버그가 고쳐짐"과
"테스트가 애초에 아무것도 렌더하지 않음"을 구별하지 못한다.

**#5가 가장 싼 회귀 그물이다.** `onError('')`(507행)의 클리어가 지금은 전역이고 개편 후에는
로컬이 된다. state 이관을 잘못하면 여기서 잡힌다.

단언은 렌더된 텍스트/DOM에 대해서만 한다. `expect(approveChangeRequest).toHaveBeenCalled()`
류는 mock을 검사할 뿐 수정 사항을 검증하지 않으므로 쓰지 않는다.

## 10. 파일 변경 목록

**신규**
- `apps/web/components/inline-error.tsx`
- `apps/web/vitest.config.ts`
- `apps/web/vitest.setup.ts`
- `apps/web/app/(app)/change-requests/[id]/page.test.tsx`

**수정**
- `apps/web/app/(app)/change-requests/[id]/page.tsx` — 89행 조건, `load()` 성공 시 클리어,
  `onError` prop 제거(부모 147/154/161/171, `ActionPanel` 241/248/257, `ExecutionHistory` 945),
  5개 컴포넌트에 로컬 error state + `InlineError` 렌더, `ApplyPanel` 에러 2분할 및 린트 fail-closed,
  `loadBackups`/`loadExecutions`의 403 구분 및 알림 state, `ExecutionCard.rollback`의 `finally`
- `apps/web/messages/en.json`, `apps/web/messages/ko.json` — 신규 키
  `lintUnavailable` · `backupsUnavailable` · `executionsUnavailable`
- `apps/web/package.json` — devDeps 7개, `"test": "vitest run"`
- `package.json`(루트) — `"web:test": "pnpm --filter @dbflow/web test"`
  (기존 `api:test`와 같은 `<app>:<task>` 규약. `"test": "pnpm -r test"` 같은 전역 스크립트는
  만들지 않는다 — 스크립트가 없는 패키지를 조용히 건너뛰어, web 테스트가 사라져도 CI가 초록이 된다.)
- `.github/workflows/ci.yml` — `web 타입 검사`와 `web 빌드` 사이에 삽입:
  ```yaml
  - name: web 테스트
    run: pnpm --filter @dbflow/web test
  ```
  Prisma 생성에 의존하지 않는다.
- `pnpm-lock.yaml` — **반드시 같은 커밋에 포함**. CI가 `pnpm install --frozen-lockfile`
  (ci.yml:34)이므로 lockfile을 갱신하지 않으면 테스트가 돌기도 전에 설치 단계에서 실패한다.
- `docs/feature-checklist.md` — 수동 QA 항목 추가
- `docs/ROADMAP.md` — 0단계 체크박스 완료 처리

## 11. 검증 방법

1. `pnpm --filter @dbflow/web test` — 7개 통과. **버그 코드 상태에서 먼저 돌려
   1·2·6·7이 실패하는 것을 확인**한 뒤 수정한다(red→green). 실측 프로토타입에서
   이 red→green 사이클이 이미 확인됐다.
2. `pnpm --filter @dbflow/web exec tsc --noEmit` — 0 종료 (테스트 파일 포함).
3. `pnpm --filter @dbflow/web build` — 성공.
4. `pnpm --filter @dbflow/api test` — 기존 27스위트 회귀 없음.
5. 수동 QA: `./start.sh` 후 반려 사유 없이 반려 클릭 → textarea 아래 메시지 확인.

## 12. 범위 밖 (의도적)

- **토스트 시스템** — UX 로드맵 3단계 G4. 사라지는 특성상 차단성 에러·검증 에러에 부적합하다.
- **다른 12개 화면의 `role="alert"` 스윕** — 그 화면들엔 이 게이팅 버그가 없다. 별도 소소한 후속.
- **1069줄 파일 분해** — 후속 기능 작업에서 자연스럽게. 지금 하면 diff가 리뷰 불가능해진다.
- **작업창 조회(`getScheduleStatus`) 알림** — §4-4에 근거 기록.
- **검토자/결재자 드롭다운 조회 실패 처리** — 같은 부류이나 위험도가 낮다.
