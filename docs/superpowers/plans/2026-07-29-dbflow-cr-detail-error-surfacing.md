# CR 상세 에러 표면화 + 프론트엔드 테스트 인프라 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CR 상세 페이지에서 로드 후 발생하는 모든 에러가 보이지 않는 버그를 고치고, 그 과정에서 드러난 fail-open 2건을 닫으며, 이후 UX 로드맵 전체가 기댈 프론트엔드 테스트 인프라를 세운다.

**Architecture:** 부모의 단일 `error` 문자열을 세 종류로 분리한다 — 로드 에러(부모 소유, 상단 배너), 액션 에러(각 액션 컴포넌트 소유, 자기 컨트롤 옆), 약화된 통제 알림(조회 수행자 소유, 데이터가 있었어야 할 자리). `onError` prop 배선을 전부 제거하고 각 컴포넌트가 자기 에러를 소유한다. 검증 수단으로 Vitest + React Testing Library를 도입하고, 모든 동작 변경은 실패하는 테스트를 먼저 작성한 뒤 고친다.

**Tech Stack:** Next.js 14 App Router · React 18 · TypeScript 5.4 · next-intl 4.13 · Tailwind · Vitest 2 · jsdom 25 · @testing-library/react 16 · pnpm workspace

**설계 근거 문서:** [docs/superpowers/specs/2026-07-28-dbflow-cr-detail-error-surfacing-design.md](../specs/2026-07-28-dbflow-cr-detail-error-surfacing-design.md)

## Global Constraints

- 대상 파일은 `apps/web/app/(app)/change-requests/[id]/page.tsx` 하나로 한정한다. 다른 12개 화면에는 이 버그가 없으므로 건드리지 않는다. 예외: `apps/web/lib/api.ts`(Task 7), `apps/web/lib/i18n-client.ts`(Task 7).
- **`@vitejs/plugin-react`를 설치하지 않는다.** esbuild가 TSX를 처리하므로 불필요하고, 설치하면 vite 메이저 버전 매트릭스에 묶인다.
- **`vitest@2` 계열을 쓴다.** vitest 4는 plugin-react 6의 `vite: ^8` 요구와 충돌한다.
- **`@testing-library/dom`을 직접 devDependency로 선언한다.** RTL 16에서 peer로 바뀌었고 pnpm은 호이스트해주지 않는다.
- **`vitest.config.ts`에 `esbuild: { jsx: 'automatic' }`가 반드시 있어야 한다.** `tsconfig.json`의 `"jsx": "preserve"`(Next 전용)를 esbuild가 물려받아 JSX가 변환되지 않는다.
- **테스트 파일에서 `describe`/`it`/`expect`/`vi`를 `vitest`에서 명시 import한다.** CI의 `tsc --noEmit`이 테스트 파일까지 검사한다(`tsconfig.json`의 `include`가 `**/*.tsx`). **`"types": ["vitest/globals"]`를 tsconfig에 추가하지 않는다** — `types` 배열을 설정하는 순간 `@types` 자동 포함이 꺼져 `@types/node`가 죽고 `lib/api.ts`의 `process.env`가 깨진다.
- **`next/navigation`의 `useRouter` mock은 `vi.hoisted`로 만든 안정된 객체를 반환해야 한다.** 매 렌더 새 객체를 반환하면 `useCurrentUser`의 `useEffect(..., [router])`가 무한 루프를 돌아 힙 OOM으로 죽고, 증상이 "tests 0ms"라 import 실패로 오진하기 쉽다.
- **`@/lib/api` mock은 `importOriginal`로 스프레드한다.** `ApiError`가 `instanceof` 비교의 값으로 쓰이므로 합성 mock은 TypeError로 죽는다. mock된 함수는 전부 프로미스를 반환해야 한다(호출부가 반환값에 곧바로 `.then()`을 건다).
- **`pnpm-lock.yaml`을 devDeps 추가와 같은 커밋에 포함한다.** CI가 `pnpm install --frozen-lockfile`이다.
- **모든 신규 i18n 키는 `en.json`과 `ko.json` 양쪽에 동시에 추가한다.** Task 1의 대칭 테스트가 이를 강제한다. next-intl은 키 누락 시 throw하지 않고 키 경로를 화면에 그대로 출력한다.
- 신규 i18n 키는 전부 `changeRequestDetail` 네임스페이스에 넣는다.
- 단언은 렌더된 텍스트/DOM에 대해서만 한다. `expect(someApiFn).toHaveBeenCalled()` 류는 mock을 검사할 뿐이므로 쓰지 않는다.
- 모든 비동기 단언은 `await screen.findBy*` 또는 `waitFor`를 거친다. `getBy*`를 즉시 쓰면 `act()` 경고와 순서 의존 플레이크가 난다.

### 스펙 §13(단일 커밋)에 대한 의도적 편차

스펙 §13은 "인프라+테스트+수정을 한 커밋으로"를 요구했다. 그 이유는 **실패하는 테스트가 main에 올라가 CI가 빨개지는 것**을 막기 위함이었다. 이 계획은 각 태스크 안에서 TDD 사이클(실패 테스트 작성 → 확인 → 수정 → 통과 → 커밋)을 완결시키므로 **커밋 시점에는 항상 초록**이다. 따라서 태스크별 커밋이 안전하며, 스펙의 목적을 더 잘 달성한다. CI 스텝은 Task 1에서 인프라와 함께 추가해 이후 모든 태스크가 CI 검증을 받게 한다.

다만 "초록"만으로는 부족한 경우가 하나 있어 처리했다. `staleContent` 접두는 스펙 §7이
Task 3 몫으로 기술했지만, 그 시점에는 공유 `error`에 액션 실패가 여전히 흘러들어 **승인
실패에 "화면을 갱신하지 못했습니다"가 붙는 반대 문구**가 3커밋 동안 main에 남는다. CI는
초록이지만 사용자에게 거짓말을 하는 상태다. 그래서 접두와 그 테스트를 마지막 `onError`
작성자가 사라지는 **Task 6으로 옮겼다.**

### 스펙 §8-3(테스트 include 글롭)에 대한 편차

스펙 §8-3은 `include: ['{app,components,lib}/**/*.test.{ts,tsx}']`로 적었으나, 스펙 §12는
카탈로그 대칭 테스트를 `messages/messages.test.ts`에 두라고 한다. 그대로 두면 그 테스트가
**조용히 수집되지 않는다.** 이 계획은 글롭에 `messages`를 추가했다. 스펙과 계획을 대조하는
리뷰어가 이를 "되돌려야 할 실수"로 오해하지 않도록 여기 기록한다.

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `apps/web/vitest.config.ts` | 테스트 러너 설정 (jsdom, `@/` alias, JSX 변환) |
| `apps/web/vitest.setup.ts` | jest-dom 매처 등록 |
| `apps/web/test/render-with-intl.tsx` | `NextIntlClientProvider`로 감싸는 렌더 헬퍼 |
| `apps/web/test/fixtures.ts` | `ChangeRequestDetail` 등 테스트 픽스처 팩토리 |
| `apps/web/components/inline-error.tsx` | 에러/알림 단문 표시 공용 컴포넌트 |
| `apps/web/components/page-header.test.tsx` | 인프라 스모크 테스트 |
| `apps/web/messages/messages.test.ts` | en/ko 카탈로그 키 대칭 검사 |
| `apps/web/app/(app)/change-requests/[id]/page.test.tsx` | CR 상세 페이지 회귀 테스트 전부 |
| `apps/web/lib/api.test.ts` | `apiFetch` 네트워크 에러 지역화 테스트 |

**수정**

| 파일 | 변경 |
|---|---|
| `apps/web/app/(app)/change-requests/[id]/page.tsx` | 에러 3종 분리, `onError` 배선 제거, 린트 환경별 fail-closed + 재시도, 백업/이력 알림, `rollingBack` 수정 |
| `apps/web/lib/api.ts` | `apiFetch`의 `fetch`를 try/catch로 감싸 지역화된 네트워크 에러 |
| `apps/web/lib/i18n-client.ts` | `networkError` 문자열 |
| `apps/web/messages/en.json`, `ko.json` | 신규 키 7개 |
| `apps/web/package.json` | devDeps 7개, `test` 스크립트 |
| `package.json` (루트) | `web:test` 스크립트 |
| `.github/workflows/ci.yml` | `web 테스트` 스텝 |
| `pnpm-lock.yaml` | devDeps 반영 |
| `docs/feature-checklist.md`, `docs/ROADMAP.md` | QA 항목, 0단계 완료 표시 |

---

## Task 1: Vitest 인프라

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/vitest.setup.ts`
- Create: `apps/web/test/render-with-intl.tsx`
- Create: `apps/web/components/page-header.test.tsx`
- Create: `apps/web/messages/messages.test.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json` (루트)
- Modify: `.github/workflows/ci.yml`
- Modify: `pnpm-lock.yaml` (설치로 자동 생성)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `renderWithIntl(ui: ReactElement): RenderResult` — `apps/web/test/render-with-intl.tsx`. 이후 모든 컴포넌트 테스트가 `render` 대신 이걸 쓴다.
  - `pnpm --filter @dbflow/web test` 명령
  - `vitest.config.ts`의 `include` 글롭: `{app,components,lib,messages}/**/*.test.{ts,tsx}`

- [ ] **Step 1: 의존성 설치**

```bash
cd /Users/jinhyeongyu/toy-project/project-dbflow
pnpm --filter @dbflow/web add -D vitest@^2.1.8 jsdom@^25.0.1 \
  @testing-library/react@^16.1.0 @testing-library/dom@^10.4.0 \
  @testing-library/jest-dom@^6.6.3 @testing-library/user-event@^14.5.2 \
  @types/react-dom@^18.3.0
```

`@vitejs/plugin-react`는 설치하지 않는다(Global Constraints 참조).

- [ ] **Step 2: `apps/web/package.json`에 test 스크립트 추가**

`scripts`가 다음이 되도록 한다:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run"
}
```

- [ ] **Step 3: 루트 `package.json`에 `web:test` 추가**

기존 `api:test` 바로 아래에 추가한다. `<app>:<task>` 규약을 따른다.

```json
"scripts": {
  "api:dev": "pnpm --filter @dbflow/api start:dev",
  "web:dev": "pnpm --filter @dbflow/web dev",
  "api:test": "pnpm --filter @dbflow/api test",
  "web:test": "pnpm --filter @dbflow/web test"
}
```

`"test": "pnpm -r test"` 같은 전역 스크립트는 **만들지 않는다** — 스크립트가 없는 패키지를 조용히 건너뛰므로, web 테스트가 사라져도 CI가 초록이 된다.

- [ ] **Step 4: `apps/web/vitest.config.ts` 작성**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // tsconfig의 jsx:"preserve"(Next 전용)를 esbuild가 물려받으므로 자동 런타임을 명시해야 한다.
  // 이 줄이 없으면 JSX가 변환되지 않아 모든 테스트가 실패한다.
  esbuild: { jsx: 'automatic' },
  // tsconfig.json의 paths("@/*": ["./*"])와 이중 원천이다. 한쪽을 바꾸면 다른 쪽도 바꿔야 한다.
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['{app,components,lib,messages}/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 5: `apps/web/vitest.setup.ts` 작성**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: `apps/web/test/render-with-intl.tsx` 작성**

```tsx
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

/**
 * 실제 en 카탈로그로 감싸 렌더한다.
 * - 스텁 메시지를 쓰면 t() 단언이 자기 픽스처를 검사하는 꼴이 되므로 실제 카탈로그를 쓴다.
 * - timeZone은 명시해야 한다. useTimeZone()은 미설정 시 throw하지 않고 undefined를
 *   반환하는데, 호출부가 non-null 단언을 하고 있어 조용히 Intl에 undefined가 들어간다.
 */
export function renderWithIntl(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Seoul">
      {ui}
    </NextIntlClientProvider>,
  );
}
```

- [ ] **Step 7: 스모크 테스트 작성 — `apps/web/components/page-header.test.tsx`**

`PageHeader`는 훅이 없어 인프라(별칭 해석 · JSX 변환 · jsdom · jest-dom 매처)만 검증하기에 적합하다.

```tsx
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { PageHeader } from '@/components/page-header';
import { renderWithIntl } from '@/test/render-with-intl';

describe('test infrastructure', () => {
  it('renders a component through the @/ alias with the JSX transform', () => {
    renderWithIntl(<PageHeader title="Add index" description="ops-42" />);
    expect(screen.getByRole('heading', { name: 'Add index' })).toBeInTheDocument();
    expect(screen.getByText('ops-42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: 카탈로그 대칭 테스트 작성 — `apps/web/messages/messages.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ko from './ko.json';

/** 중첩 객체를 "a.b.c" 형태의 리프 키 목록으로 편다. */
function flatKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('message catalogs', () => {
  // next-intl은 키 누락 시 throw하지 않고 키 경로를 화면에 그대로 출력한다.
  // 대칭을 강제하는 다른 장치가 없으므로 이 테스트가 유일한 방어선이다.
  it('en and ko expose an identical key set', () => {
    expect(flatKeys(ko).sort()).toEqual(flatKeys(en).sort());
  });
});
```

- [ ] **Step 9: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @dbflow/web test`
Expected: PASS — 2개 파일, 2개 테스트 통과.

만약 `SyntaxError: Unexpected token '<'` 류가 나오면 `esbuild: { jsx: 'automatic' }`가 빠진 것이다.

- [ ] **Step 10: 타입 검사 — 통과 확인**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit`
Expected: 종료 코드 0, 출력 없음.

- [ ] **Step 11: CI 스텝 추가 — `.github/workflows/ci.yml`**

`web 타입 검사`와 `web 빌드` 사이에 삽입한다. Prisma 생성에 의존하지 않는다.

```yaml
      - name: web 타입 검사
        run: pnpm --filter @dbflow/web exec tsc --noEmit

      - name: web 테스트
        run: pnpm --filter @dbflow/web test

      - name: web 빌드
        run: pnpm --filter @dbflow/web build
```

- [ ] **Step 12: 커밋**

`pnpm-lock.yaml`을 반드시 포함한다 — CI가 `--frozen-lockfile`이라 빠지면 설치 단계에서 실패한다.

```bash
git add apps/web/vitest.config.ts apps/web/vitest.setup.ts \
  apps/web/test/render-with-intl.tsx apps/web/components/page-header.test.tsx \
  apps/web/messages/messages.test.ts apps/web/package.json \
  package.json pnpm-lock.yaml .github/workflows/ci.yml
git commit -m "test(web): add Vitest + RTL infrastructure and wire it into CI"
```

---

## Task 2: `InlineError` 컴포넌트와 기존 알림 통합

**Files:**
- Create: `apps/web/components/inline-error.tsx`
- Create: `apps/web/components/inline-error.test.tsx`
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx` (89~93행 상단 배너, 752~756행 `dbNotice`, 524~525행 `DecisionAction` 루트 태그)

**Interfaces:**
- Consumes: `renderWithIntl` (Task 1)
- Produces:
  - `InlineError({ message?, tone?, className?, id? })` — `tone`은 `'error' | 'notice'`, 기본 `'error'`. `message`가 falsy면 `null`을 반환한다. `tone='error'`는 `role="alert"`, `tone='notice'`는 `role="status"`.
  - `DecisionAction`의 루트가 `<section>`이 된다 (Task 4의 containment 단언이 여기에 의존).

**이 태스크는 동작을 바꾸지 않는 순수 리팩터다.** 상단 배너의 `&& !cr` 조건은 **그대로 둔다** — 그것을 고치는 것은 Task 3이다.

- [ ] **Step 1: 실패하는 테스트 작성 — `apps/web/components/inline-error.test.tsx`**

```tsx
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { InlineError } from '@/components/inline-error';
import { renderWithIntl } from '@/test/render-with-intl';

describe('InlineError', () => {
  it('renders nothing when there is no message', () => {
    const { container } = renderWithIntl(<InlineError message="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces an error assertively', () => {
    renderWithIntl(<InlineError message="Apply failed." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Apply failed.');
  });

  it('announces a notice politely', () => {
    renderWithIntl(<InlineError message="Backups unavailable." tone="notice" />);
    expect(screen.getByRole('status')).toHaveTextContent('Backups unavailable.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('exposes an id so a field can describe itself with it', () => {
    renderWithIntl(<InlineError message="Reason required." id="reject-error" />);
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'reject-error');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @dbflow/web test inline-error`
Expected: FAIL — `Failed to resolve import "@/components/inline-error"`.

- [ ] **Step 3: `apps/web/components/inline-error.tsx` 작성**

```tsx
const TONE_CLASS = {
  error: 'rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300',
  notice:
    'rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
} as const;

/**
 * 단문 에러/알림 표시.
 * - error: 사용자 액션이 실패했거나 본문을 못 불러옴 → assertive(alert)
 * - notice: 배경 조회가 실패해 화면이 진실을 다 말하지 못함 → polite(status)
 * 여백(mt-*)은 톤 클래스에 넣지 않고 호출부가 className으로 준다. 상단 배너는 여백이 없고
 * 패널 내부 알림은 mt-3을 쓰기 때문이다.
 */
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
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={className ? `${TONE_CLASS[tone]} ${className}` : TONE_CLASS[tone]}
    >
      {message}
    </p>
  );
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @dbflow/web test inline-error`
Expected: PASS — 4개 통과.

- [ ] **Step 5: 상단 배너를 `InlineError`로 교체**

`page.tsx` 상단에 import를 추가한다:

```tsx
import { InlineError } from '@/components/inline-error';
```

89~93행의 다음 블록을

```tsx
      {error && !cr && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}
```

이렇게 바꾼다. **`&& !cr` 조건은 유지한다** (Task 3에서 제거).

```tsx
      {!cr && <InlineError message={error} />}
```

- [ ] **Step 6: `dbNotice`를 `InlineError`로 교체**

`ApplyPanel` 안 752~756행의 다음 블록을

```tsx
      {dbNotice && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {dbNotice}
        </p>
      )}
```

이렇게 바꾼다.

```tsx
      <InlineError message={dbNotice} tone="notice" className="mt-3" />
```

`gate.reasonKey` 블록(746~750행)은 **바꾸지 않는다.** 정적 표시이지 갱신이 아니라서 `role="status"`를 주면 렌더마다 라이브 리전으로 읽히는 접근성 퇴행이 된다.

- [ ] **Step 7: `DecisionAction`의 루트를 `<section>`으로 변경**

524~525행:

```tsx
  return (
    <div>
      <div className="flex items-center gap-2">
```

를

```tsx
  return (
    <section>
      <div className="flex items-center gap-2">
```

로 바꾸고, 이 컴포넌트의 닫는 `</div>`(553행, `return` 블록의 최상위 닫는 태그)를 `</section>`으로 바꾼다.

**이유:** 현재 승인/반려 버튼의 가장 가까운 `<section>` 조상은 `ActionPanel`의 것(239행)이고, 거기엔 `SubmitAction`과 다른 쪽 `DecisionAction`까지 들어 있다. Task 4의 containment 단언이 의미를 가지려면 인스턴스별 경계가 필요하다.

- [ ] **Step 8: 타입 검사 · 테스트 · 빌드 확인**

Run:
```bash
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web build
```
Expected: 모두 성공. 동작 변경이 없으므로 기존 테스트도 그대로 통과한다.

- [ ] **Step 9: 커밋**

```bash
git add apps/web/components/inline-error.tsx apps/web/components/inline-error.test.tsx \
  "apps/web/app/(app)/change-requests/[id]/page.tsx"
git commit -m "refactor(web): add InlineError and give DecisionAction its own section"
```

---

## Task 3: 로드 에러 표면화

**Files:**
- Create: `apps/web/test/fixtures.ts`
- Create: `apps/web/app/(app)/change-requests/[id]/page.test.tsx`
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx` (58~62행 `load`, 89행 배너)

**Interfaces:**
- Consumes: `renderWithIntl` (Task 1), `InlineError` (Task 2)
- Produces:
  - `apps/web/test/fixtures.ts` — `makeUser`, `makeCr`, `makeTargetDb`, `makeLint`, `makeExecution`, `makeBackup`. Task 4~6이 전부 이 팩토리를 쓴다.
  - `page.test.tsx`의 공용 스캐폴딩(mock 선언, `beforeEach` 기본값). Task 4~6이 같은 파일에 테스트를 덧붙인다.

- [ ] **Step 1: 픽스처 팩토리 작성 — `apps/web/test/fixtures.ts`**

```ts
import type {
  Backup,
  ChangeRequestDetail,
  Execution,
  LintResult,
  TargetDatabase,
} from '@/lib/api';
import type { User } from '@/lib/auth';

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'u-dev',
    email: 'dev@dbflow.io',
    name: 'Dev',
    department: 'Platform',
    role: 'DEVELOPER',
    ...over,
  };
}

export function makeCr(over: Partial<ChangeRequestDetail> = {}): ChangeRequestDetail {
  return {
    id: 'cr1',
    title: 'Add index on orders',
    targetEnv: 'DEV',
    status: 'DRAFT',
    authorId: 'u-dev',
    authorName: 'Dev',
    reviewerId: 'u-rev',
    reviewerName: 'Rev',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    description: 'ops-42',
    files: [
      {
        id: 'f1',
        changeRequestId: 'cr1',
        order: 0,
        filename: '001_add_index.sql',
        sqlType: 'DDL',
        content: 'CREATE INDEX idx_orders_created ON orders (created_at);',
      },
    ],
    statusHistory: [],
    approvers: [],
    canActAsDelegate: false,
    iAlreadyActed: false,
    ...over,
  };
}

export function makeTargetDb(over: Partial<TargetDatabase> = {}): TargetDatabase {
  return {
    id: 'db1',
    name: 'orders-dev',
    env: 'DEV',
    dbType: 'MYSQL',
    host: 'localhost',
    port: 3306,
    username: 'app',
    database: 'orders',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

export function makeLint(over: Partial<LintResult> = {}): LintResult {
  return { changeRequestId: 'cr1', targetEnv: 'DEV', items: [], maxSeverity: 'INFO', ...over };
}

export function makeExecution(over: Partial<Execution> = {}): Execution {
  return {
    id: 'ex1',
    changeRequestId: 'cr1',
    targetDatabaseId: 'db1',
    status: 'SUCCESS',
    startedAt: '2026-07-01T00:00:00.000Z',
    finishedAt: '2026-07-01T00:00:01.000Z',
    triggeredById: 'u-appr',
    createdAt: '2026-07-01T00:00:00.000Z',
    steps: [],
    kind: 'APPLY',
    backupId: 'b1',
    ...over,
  };
}

export function makeBackup(over: Partial<Backup> = {}): Backup {
  return {
    id: 'b1',
    changeRequestId: 'cr1',
    targetDatabaseId: 'db1',
    executionId: 'ex1',
    scope: 'SCHEMA_AND_DATA',
    status: 'SUCCESS',
    location: 'DB',
    sizeBytes: 2048,
    note: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}
```

- [ ] **Step 2: 실패하는 테스트 작성 — `apps/web/app/(app)/change-requests/[id]/page.test.tsx`**

이 파일이 Task 4~6에서도 계속 커진다. 스캐폴딩을 정확히 이 형태로 만든다.

```tsx
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
```

- [ ] **Step 3: 테스트 실행 — 올바른 이유로 실패하는지 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected:
- `shows the banner when the initial load fails` → **PASS** (positive control. 이게 실패하면 렌더 자체가 안 되는 것이므로 인프라 문제를 먼저 해결할 것)
- `keeps the loaded content visible when a refresh fails` → **FAIL**: `Unable to find role="alert"` (배너가 `!cr`로 막혀 있음)
- `clears the load error once a later refresh succeeds` → **FAIL**: 같은 이유

- [ ] **Step 4: `load`가 성공 시 에러를 지우도록 수정**

58~62행:

```tsx
  const load = useCallback(() => {
    return getChangeRequest(id)
      .then(setCr)
      .catch((err: Error) => setError(err.message));
  }, [id]);
```

를

```tsx
  const load = useCallback(() => {
    return getChangeRequest(id)
      .then((next) => {
        setCr(next);
        setError(''); // 이전 실패 배너가 남지 않도록 성공 시 반드시 지운다
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);
```

로 바꾼다.

- [ ] **Step 5: 배너의 `!cr` 게이트 제거**

Task 2에서 만든

```tsx
      {!cr && <InlineError message={error} />}
```

를

```tsx
      <InlineError message={error} />
```

로 바꾼다.

**`staleContent` 접두는 여기서 붙이지 않는다.** 이 시점에는 공유 `error`에 여전히 액션
실패도 흘러들어온다(`AssigneePanel`·`ActionPanel`은 Task 4까지, `ApplyPanel`은 Task 5까지,
`ExecutionHistory`는 Task 6까지). 지금 접두를 붙이면 승인 실패에도 "화면을 갱신하지
못했습니다"가 앞에 붙어 **사실과 반대되는 문구**가 된다. 마지막 `onError` 작성자가 사라지는
Task 6에서 붙인다.

- [ ] **Step 6: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected: PASS — 3개 전부 통과.

- [ ] **Step 7: 전체 검증**

Run:
```bash
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web build
```
Expected: 모두 성공.

- [ ] **Step 8: 커밋**

이 태스크는 i18n 카탈로그를 건드리지 않는다.

```bash
git add apps/web/test/fixtures.ts \
  "apps/web/app/(app)/change-requests/[id]/page.test.tsx" \
  "apps/web/app/(app)/change-requests/[id]/page.tsx"
git commit -m "fix(web): surface CR detail load errors after the page has rendered"
```

---

## Task 4: 결정·제출·담당자 액션 에러 인라인화

**Files:**
- Modify: `apps/web/app/(app)/change-requests/[id]/page.test.tsx` (테스트 추가)
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx` (`AssigneePanel` 342~407행, `ActionPanel` 213~269행, `SubmitAction` 456~487행, `DecisionAction` 489~555행)

**Interfaces:**
- Consumes: `InlineError` (Task 2), 픽스처와 스캐폴딩 (Task 3)
- Produces: `AssigneePanel` · `SubmitAction` · `DecisionAction` · `ActionPanel`이 `onError` prop을 잃는다. `ApplyPanel`과 `ExecutionHistory`의 `onError`는 Task 5·6에서 제거하므로 이 태스크에서는 부모의 `onError={setError}` 배선을 **그 둘에 대해서만 남긴다.**

- [ ] **Step 1: 실패하는 테스트 작성 — `page.test.tsx`에 아래 describe 블록을 추가**

`REVIEWER`가 `SUBMITTED` CR을 볼 때 `DecisionAction`(검토)이 렌더된다.

```tsx
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
    // 형제 인스턴스에는 에러가 새지 않아야 한다.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // 이 페이지에서 손실 비용이 가장 큰 데이터다. 실패 시 반드시 보존되어야 한다.
    expect(textarea).toHaveValue('looks good');
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
```

`within`을 import에 추가한다:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
```

- [ ] **Step 2: 테스트 실행 — 올바른 이유로 실패하는지 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected: `action errors`의 5개 전부 FAIL. 실패 사유가 `Unable to find role="alert"`여야 한다(에러가 부모 배너로 흘러가 `!cr` 조건과 무관하게 이제는 상단에 뜨지만, `within(section)` 범위 안에는 없음). `shows a failed submit next to the submit button`은 상단 배너 때문에 통과할 수도 있는데, 그렇더라도 Step 4 이후 인라인 위치로 옮겨진다.

- [ ] **Step 3: `AssigneePanel`에서 `onError`를 로컬 state로 전환**

시그니처에서 `onError`를 제거한다 (342~349행):

```tsx
function AssigneePanel({
  cr,
  user,
  onDone,
}: {
  cr: ChangeRequestDetail;
  user: User;
  onDone: () => Promise<unknown>;
}) {
```

`const [busy, setBusy] = useState(false);` 아래에 추가한다:

```tsx
  const [error, setError] = useState('');
```

`reassign`의 `onError` 호출을 로컬 setter로 바꾼다:

```tsx
  async function reassign() {
    setBusy(true);
    setError('');
    try {
      await setAssignees(cr.id, {
        reviewerId: reviewerId || undefined,
        approverIds: approverIds.filter((id) => id),
      });
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
```

편집 분기의 저장 버튼 블록 뒤에 에러를 렌더한다. **읽기 전용 분기(`if (!canReassign)`)에는 넣지 않는다** — 거기서는 액션이 없다.

```tsx
      <div className="mt-3 flex justify-end">
        <button onClick={reassign} disabled={busy} className="btn-primary px-5 py-2.5 text-sm">
          {busy ? t('changing') : t('changeAssignment')}
        </button>
      </div>
      <InlineError message={error} className="mt-3" />
    </section>
  );
```

- [ ] **Step 4: `SubmitAction`에서 `onError`를 로컬 state로 전환**

456~487행 전체를 다음으로 교체한다:

```tsx
function SubmitAction({
  id,
  onDone,
}: {
  id: string;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await submitChangeRequest(id);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('submitNotice')}</p>
        <button onClick={submit} disabled={busy} className="btn-primary shrink-0 px-5 py-2.5 text-sm">
          {busy ? t('submitting') : t('requestReview')}
        </button>
      </div>
      <InlineError message={error} className="mt-3" />
    </div>
  );
}
```

- [ ] **Step 5: `DecisionAction`에서 `onError`를 로컬 state로 전환하고 에러를 textarea와 버튼 사이에 배치**

489~555행 전체를 다음으로 교체한다. `useId`를 `react` import에 추가해야 한다.

```tsx
function DecisionAction({
  title,
  badge,
  run,
  onDone,
}: {
  title: string;
  badge?: React.ReactNode;
  run: (decision: ReviewDecision, comment: string) => Promise<unknown>;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState('');
  // 검증 실패일 때만 textarea를 aria로 연결한다. API 실패는 필드 잘못이 아니다.
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function act(decision: ReviewDecision) {
    setError('');
    setInvalid(false);
    if (decision === 'REJECT' && !comment.trim()) {
      setError(t('rejectReasonRequired'));
      setInvalid(true);
      textareaRef.current?.focus(); // WCAG 3.3.1 — 문제가 된 필드를 식별시킨다
      return;
    }
    setBusy(decision);
    try {
      await run(decision, comment.trim());
      setComment('');
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      <textarea
        ref={textareaRef}
        aria-label={t('reviewCommentAriaLabel')}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className="mt-3 w-full resize-y rounded-2xl bg-subtle px-4 py-3 text-sm outline-none ring-1 ring-border-strong focus:ring-primary"
        placeholder={t('commentPlaceholder')}
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          // 검증 에러만 입력 즉시 지운다. API 실패는 실제 서버 결과이므로 재시도까지 남긴다.
          if (invalid) {
            setError('');
            setInvalid(false);
          }
        }}
      />
      <InlineError message={error} id={errorId} className="mt-3" />
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => act('APPROVE')}
          disabled={busy !== null}
          className="btn-primary flex-1 px-4 py-2.5 text-sm"
        >
          {busy === 'APPROVE' ? t('processing') : t('approve')}
        </button>
        <button
          onClick={() => act('REJECT')}
          disabled={busy !== null}
          className="focusable flex-1 rounded-2xl bg-card px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
        >
          {busy === 'REJECT' ? t('processing') : t('reject')}
        </button>
      </div>
    </section>
  );
}
```

`page.tsx` 최상단의 react import를 다음으로 바꾼다:

```tsx
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 6: `ActionPanel`에서 `onError` prop 배선 제거**

시그니처에서 `onError`를 제거하고(213~223행), 자식 호출에서도 제거한다(241·248·257행):

```tsx
function ActionPanel({
  cr,
  user,
  onDone,
}: {
  cr: ChangeRequestDetail;
  user: User;
  onDone: () => Promise<unknown>;
}) {
```

```tsx
      {canSubmit && <SubmitAction id={cr.id} onDone={onDone} />}
      {canReview && (
        <DecisionAction
          title={t('reviewTitle')}
          badge={isReviewDelegate ? <DelegateBadge label={t('delegateReview')} /> : null}
          run={(decision, comment) => reviewChangeRequest(cr.id, decision, comment)}
          onDone={onDone}
        />
      )}
      {canApprove && (
        <DecisionAction
          title={t('finalApprovalTitle')}
          badge={isApproveDelegate ? <DelegateBadge label={t('delegateApproval')} /> : null}
          run={(decision, comment) => approveChangeRequest(cr.id, decision, comment)}
          onDone={onDone}
        />
      )}
```

- [ ] **Step 7: 부모에서 두 컴포넌트의 `onError` 전달 제거**

147행과 151~156행:

```tsx
              <AssigneePanel cr={cr} user={user} onDone={load} />

              <ApprovalProgressPanel cr={cr} />

              <ActionPanel cr={cr} user={user} onDone={load} />
```

`ApplyPanel`(158~165행)과 `ExecutionHistory`(167~175행)의 `onError={setError}`는 **이 태스크에서 유지한다** — Task 5·6이 제거한다.

- [ ] **Step 8: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected: PASS — `load errors` 3개 + `action errors` 5개 = 8개 통과.

- [ ] **Step 9: 전체 검증**

Run:
```bash
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web build
```
Expected: 모두 성공.

- [ ] **Step 10: 커밋**

```bash
git add "apps/web/app/(app)/change-requests/[id]/page.tsx" \
  "apps/web/app/(app)/change-requests/[id]/page.test.tsx"
git commit -m "fix(web): render decision, submit and assignee errors next to their controls"
```

---

## Task 5: `ApplyPanel` 에러 분리와 린트 환경별 fail-closed

**Files:**
- Modify: `apps/web/app/(app)/change-requests/[id]/page.test.tsx` (테스트 추가)
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx` (`ApplyPanel` 588~843행, `DryRunSection` 845~906행, 부모 158~165행)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/ko.json` (`lintUnavailable`, `lintRetry`)

**Interfaces:**
- Consumes: `InlineError` (Task 2), 픽스처와 스캐폴딩 (Task 3)
- Produces:
  - `DryRunSection`이 `error?: string` prop을 얻는다.
  - `ApplyPanel`이 `onError` prop을 잃는다.
  - i18n 키 `changeRequestDetail.lintUnavailable`, `changeRequestDetail.lintRetry`

**배경(반드시 읽을 것):** 서버는 `apps/api/src/apply/lint.engine.ts:89`에서 DEV의 BLOCK을 WARN으로 강등한다. 즉 **DEV에서는 린트가 아무것도 게이트하지 않는다.** 따라서 린트 조회 실패로 적용을 막는 것은 STAGING/PROD에서만 의미가 있고, DEV에서 막으면 안전 이득 0에 비용만 생긴다. 또한 린트 effect의 deps가 세션 중 바뀌지 않으므로 **재시도 수단이 없으면 일시적 500 하나가 새로고침 전까지 적용을 영구히 잠근다.**

- [ ] **Step 1: 픽스처 import 확장 후 실패하는 테스트 작성 — `page.test.tsx`**

먼저 파일 상단의 픽스처 import에 `makeTargetDb`를 추가한다. 이걸 빠뜨리면 `tsc --noEmit`이
`Cannot find name 'makeTargetDb'`로 실패하고, Task 1에서 넣은 CI 스텝이 main을 빨갛게 만든다.

```tsx
import { makeCr, makeLint, makeTargetDb, makeUser } from '@/test/fixtures';
```

그다음 아래 describe 블록을 파일 끝에 추가한다.

```tsx
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
  });
});
```

- [ ] **Step 2: 테스트 실행 — 올바른 이유로 실패하는지 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected: `apply panel`의 4개 전부 FAIL.
- 첫 두 개: `Unable to find role="status"` (린트 실패 알림이 아예 없음)
- 세 번째: `Unable to find button "Check again"`
- 네 번째: dry-run 에러가 `DryRunSection` 밖(부모 배너)에 있음

- [ ] **Step 3: i18n 키 추가**

`apps/web/messages/en.json`의 `changeRequestDetail`에:

```json
"lintUnavailable": "Could not load the risky-SQL check result, so this change cannot be applied. Please retry; if it keeps failing, contact your administrator.",
"lintUnavailableDev": "Could not load the risky-SQL check result. DEV can still be applied, but risky statements will not be flagged. Please retry to see the check result.",
"lintRetry": "Check again",
```

`apps/web/messages/ko.json`의 `changeRequestDetail`에:

```json
"lintUnavailable": "위험 SQL 검사 결과를 불러오지 못해 적용할 수 없습니다. 다시 시도해 주세요. 계속 실패하면 관리자에게 문의하세요.",
"lintUnavailableDev": "위험 SQL 검사 결과를 불러오지 못했습니다. DEV는 그대로 적용할 수 있지만 위험 구문이 표시되지 않습니다. 다시 시도해 검사 결과를 확인해 주세요.",
"lintRetry": "다시 확인",
```

**키가 두 개인 이유:** DEV는 린트 결과가 없어도 적용이 막히지 않는다(Step 6 참조). 그런데
"적용할 수 없습니다"라고 적힌 앰버 상자 옆에 활성화된 적용 버튼이 있으면 운영자는 그 상자를
무시하도록 학습한다. 통제 절차 제품에서 가장 나쁜 종류의 알림이므로 환경별로 문구를 나눈다.

- [ ] **Step 4: `ApplyPanel`의 시그니처와 state 정리**

588~600행의 시그니처에서 `onError`를 제거한다:

```tsx
function ApplyPanel({
  cr,
  user,
  onApplied,
}: {
  cr: ChangeRequestDetail;
  user: User;
  onApplied: () => Promise<unknown>;
}) {
```

기존 state 선언부(`const [lint, setLint] = ...` 부근)에 3개를 추가한다. **`if (!roleAllowed) return null`(662행)보다 위여야 한다** — 훅은 조기 반환 뒤에 올 수 없다.

```tsx
  const [lint, setLint] = useState<LintResult | null>(null);
  const [lintNotice, setLintNotice] = useState('');
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunError, setDryRunError] = useState('');
  const [applyError, setApplyError] = useState('');
```

- [ ] **Step 5: 린트 조회를 `useCallback`으로 추출하고 재시도 가능하게 만들기**

646~655행의 effect를 다음으로 교체한다. `active` 언마운트 가드를 유지해야 한다.

```tsx
  // 적용 전 위험 SQL 린트(대상 DB와 무관, CR 파일 정적 분석). 환경정책 반영된 severity.
  // 실패 시 STAGING/PROD는 적용을 막으므로(fail-closed) 재시도 수단이 반드시 필요하다.
  const loadLint = useCallback(() => {
    let active = true;
    setLintNotice('');
    lintChangeRequest(cr.id)
      .then((res) => {
        if (!active) return;
        setLint(res);
      })
      .catch(() => {
        if (!active) return;
        setLint(null);
        // DEV는 적용이 막히지 않으므로 "적용할 수 없습니다"라고 말하면 안 된다.
        setLintNotice(t(cr.targetEnv === 'DEV' ? 'lintUnavailableDev' : 'lintUnavailable'));
      });
    return () => {
      active = false;
    };
  }, [cr.id, cr.targetEnv, t]);

  useEffect(() => {
    if (!roleAllowed) return;
    return loadLint();
  }, [roleAllowed, loadLint]);
```

- [ ] **Step 6: `canApply`를 환경별 fail-closed로 수정**

696~702행 부근의 `lintBlocked` 선언과 `canApply`를 다음으로 교체한다:

```tsx
  const lintBlocked = lint?.maxSeverity === 'BLOCK';
  // DEV는 서버가 BLOCK→WARN으로 강등(apps/api/src/apply/lint.engine.ts:89)하므로
  // 린트 게이트 자체가 없다. 게이트가 없는 환경에서 조회 실패로 적용을 막으면
  // 안전 이득 없이 빠른 반복 경로만 잠근다.
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

**알려진 과도 상태:** `lint === null`은 조회가 *실패했을 때*뿐 아니라 *아직 진행 중일 때*도
참이다. 따라서 STAGING/PROD에서는 린트 왕복이 끝날 때까지(보통 수백 ms) 적용 버튼이 이유
표시 없이 비활성이다. 게이트는 로딩 중에도 닫혀 있어야 하므로 이 동작을 완화하지 않는다.
버튼이 스스로 비활성 사유를 설명하는 문제는 로드맵 4단계 E6(적용 준비 체크리스트 위젯)의
몫이며, 이 과도 상태도 거기서 함께 해소된다.

- [ ] **Step 7: `runDryRun`과 `apply`를 각자의 에러 state로 전환**

```tsx
  async function runDryRun() {
    if (!selectedId) return;
    setDryRunning(true);
    setDryRun(null);
    setDryRunError('');
    try {
      setDryRun(await dryRunChangeRequest(cr.id, selectedId));
    } catch (err) {
      setDryRunError((err as Error).message);
    } finally {
      setDryRunning(false);
    }
  }

  async function apply() {
    if (!selectedId) return;
    setBusy(true);
    setApplyError('');
    setResult(null);
    try {
      const exec = await applyChangeRequest(cr.id, selectedId);
      setResult({ status: exec.status });
      await onApplied();
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 8: 린트 알림과 재시도 버튼을 위험 SQL 패널 자리에 렌더**

린트 결과 블록(710~742행, `{lint && lint.items.length > 0 && (...)}`) **바로 뒤에** 추가한다. 데이터가 있었어야 할 자리다.

```tsx
      {lintNotice && (
        <div className="mt-3">
          <InlineError message={lintNotice} tone="notice" />
          <div className="mt-2 flex justify-end">
            <button
              onClick={loadLint}
              className="focusable rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-ink ring-1 ring-border-strong transition-colors hover:bg-subtle"
            >
              {t('lintRetry')}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 9: 적용 에러를 적용 버튼 아래에 렌더**

적용 버튼 블록(`<div className="mt-4 flex items-center justify-end gap-3">…</div>`) 바로 뒤에 추가한다:

```tsx
          <div className="mt-4 flex items-center justify-end gap-3">
            <button onClick={apply} disabled={!canApply} className="btn-primary px-6 py-3 text-sm">
              {busy ? t('applying') : t('applyTitle')}
            </button>
          </div>
          <InlineError message={applyError} className="mt-3" />
```

- [ ] **Step 10: `DryRunSection`에 `error` prop을 추가하고 실행 버튼 아래에 렌더**

호출부:

```tsx
          <DryRunSection
            result={dryRun}
            running={dryRunning}
            disabled={!selectedId || dryRunning}
            onRun={runDryRun}
            error={dryRunError}
          />
```

컴포넌트 정의(845~856행):

```tsx
function DryRunSection({
  result,
  running,
  disabled,
  onRun,
  error,
}: {
  result: DryRunResult | null;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
  error?: string;
}) {
```

실행 버튼을 감싼 `<div className="flex items-center justify-between gap-3">…</div>` 바로 뒤, 결과 목록(`{result && (...)}`) 앞에 렌더한다:

```tsx
      <InlineError message={error} className="mt-3" />

      {result && (
```

- [ ] **Step 11: 부모에서 `ApplyPanel`의 `onError` 전달 제거**

158~165행:

```tsx
              <ApplyPanel
                cr={cr}
                user={user}
                onApplied={async () => {
                  await Promise.all([load(), loadExecutions(), loadBackups()]);
                }}
              />
```

- [ ] **Step 12: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected: PASS — 12개 통과 (load 3 + action 5 + apply 4).

- [ ] **Step 13: 전체 검증**

Run:
```bash
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web build
```
Expected: 모두 성공.

- [ ] **Step 14: 커밋**

```bash
git add "apps/web/app/(app)/change-requests/[id]/page.tsx" \
  "apps/web/app/(app)/change-requests/[id]/page.test.tsx" \
  apps/web/messages/en.json apps/web/messages/ko.json
git commit -m "fix(web): split apply/dry-run errors and fail closed on unknown lint outside DEV"
```

---

## Task 6: 적용 이력 알림과 롤백 수정

**Files:**
- Modify: `apps/web/app/(app)/change-requests/[id]/page.test.tsx` (테스트 추가)
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx` (부모 64~74·167~175행, `ExecutionHistory` 917~950행, `ExecutionCard` 952~1063행)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/ko.json` (`backupsUnavailable`, `executionsUnavailable`, `applyHistoryTitle`, `staleContent`)

**Interfaces:**
- Consumes: `InlineError` (Task 2), 픽스처와 스캐폴딩 (Task 3)
- Produces:
  - `ExecutionHistory`의 최종 prop 목록: `executions`, `backups`, `canRollback`, `onRolledBack`, `backupsNotice: string`, `executionsNotice: string`. **`onError`는 제거된다.**
  - i18n 키 `changeRequestDetail.backupsUnavailable`, `executionsUnavailable`, `applyHistoryTitle`, `staleContent`
  - 마지막 `onError` 작성자가 사라지므로, 이 태스크 이후 부모의 `error`는 로드 실패 전용이 된다.

**배경(반드시 읽을 것):** `apps/api/src/apply/apply.controller.ts:72`가 `:id/backups`를 `@Roles(DEVELOPER, APPROVER)`로 막는다. 즉 **DEVELOPER는 권한이 있고**, 403을 받는 쪽은 **REVIEWER와 ADMIN**이다. 이 둘은 모든 CR 상세 조회에서 매번 403을 받으며 애초에 롤백 버튼을 볼 수 없으므로, 403에 알림을 띄우면 순수한 소음이다.

- [ ] **Step 1: 픽스처 import 확장 후 실패하는 테스트 작성 — `page.test.tsx`**

먼저 파일 상단의 픽스처 import를 아래로 확장한다. 빠뜨리면 `tsc --noEmit`이
`Cannot find name 'makeExecution'`으로 실패해 CI가 빨개진다.

```tsx
import { makeBackup, makeCr, makeExecution, makeLint, makeTargetDb, makeUser } from '@/test/fixtures';
```

그다음 아래 describe 블록을 파일 끝에 추가한다. `ApiError`는 mock에서 `importOriginal`로
살아 있으므로 실제 클래스를 쓴다.

```tsx
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
    expect(screen.getByRole('heading', { name: 'Apply history' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Apply history \(0\)/ })).toBeNull();
    // 이력을 못 불러온 상황에서 백업 알림은 중복이자 무의미하다.
    expect(screen.getAllByRole('status')).toHaveLength(1);
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
```

- [ ] **Step 2: 테스트 실행 — 올바른 이유로 실패하는지 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected: `apply history notices`의 5개 중
- 1·3번: `Unable to find role="status"` (알림 자체가 없음)
- 2번: PASS 가능(알림이 없으니) — 그래도 Step 5 이후에도 통과해야 한다
- 4번: FAIL — 롤백 성공 후 버튼이 `Rolling back…` 라벨로 비활성 유지
- 5번: FAIL 또는 상단 배너에서 잡힘

- [ ] **Step 3: i18n 키 추가**

`apps/web/messages/en.json`의 `changeRequestDetail`에:

```json
"backupsUnavailable": "Could not load the backup list, so the rollback option stays hidden even if a backup exists. Please reload the page.",
"executionsUnavailable": "Could not load the apply history. This does not mean the change was never applied. Please reload the page to check.",
"applyHistoryTitle": "Apply history",
"staleContent": "Could not refresh this page, so the content below may be out of date.",
```

`apps/web/messages/ko.json`의 `changeRequestDetail`에:

```json
"backupsUnavailable": "백업 목록을 불러오지 못했습니다. 백업이 있어도 롤백 버튼이 표시되지 않으니 페이지를 새로고침해 주세요.",
"executionsUnavailable": "적용 이력을 불러오지 못했습니다. 적용된 적이 없다는 뜻이 아닙니다. 페이지를 새로고침해 확인해 주세요.",
"applyHistoryTitle": "적용 이력",
"staleContent": "화면을 갱신하지 못했습니다. 아래 내용은 최신이 아닐 수 있습니다.",
```

- [ ] **Step 4: 부모에 알림 state를 추가하고 403을 구분**

`const [error, setError] = useState('');` 아래에 추가한다:

```tsx
  const [executionsNotice, setExecutionsNotice] = useState('');
  const [backupsNotice, setBackupsNotice] = useState('');
```

`page.tsx` 상단에서 `useTranslations`가 이미 `t`로 잡혀 있다(51행). 64~74행을 다음으로 교체한다:

```tsx
  const loadExecutions = useCallback(() => {
    return listExecutions(id)
      .then((rows) => {
        setExecutions(rows);
        setExecutionsNotice('');
      })
      .catch(() => {
        // 조회 실패를 빈 배열로 삼키면 "적용된 적 없음"으로 보인다 — 감사 제품에서 최악의 거짓 음성.
        setExecutions([]);
        setExecutionsNotice(t('executionsUnavailable'));
      });
  }, [id, t]);

  const loadBackups = useCallback(() => {
    return listBackups(id)
      .then((rows) => {
        setBackups(rows);
        setBackupsNotice('');
      })
      .catch((err: unknown) => {
        setBackups([]);
        // REVIEWER·ADMIN은 백업 조회 권한이 없어 매 조회마다 403을 받는다(정상 경로).
        // 그들은 롤백 버튼도 볼 수 없으므로 알리면 소음이다. 그 외 실패만 알린다.
        setBackupsNotice(err instanceof ApiError && err.status === 403 ? '' : t('backupsUnavailable'));
      });
  }, [id, t]);
```

- [ ] **Step 5: 부모에서 `ExecutionHistory` 호출을 갱신**

167~175행:

```tsx
              <ExecutionHistory
                executions={executions}
                backups={backups}
                canRollback={applyRoleAllowed(cr, user)}
                executionsNotice={executionsNotice}
                backupsNotice={backupsNotice}
                onRolledBack={async () => {
                  await Promise.all([load(), loadExecutions(), loadBackups()]);
                }}
              />
```

- [ ] **Step 6: `ExecutionHistory`의 시그니처와 렌더 규칙 수정**

917~950행 전체를 다음으로 교체한다:

```tsx
function ExecutionHistory({
  executions,
  backups,
  canRollback,
  executionsNotice,
  backupsNotice,
  onRolledBack,
}: {
  executions: Execution[] | null;
  backups: Backup[];
  canRollback: boolean;
  executionsNotice: string;
  backupsNotice: string;
  onRolledBack: () => Promise<unknown>;
}) {
  const t = useTranslations('changeRequestDetail');
  const rows = executions ?? [];
  // 알림이 있으면 목록이 비어도 섹션을 렌더해야 알림이 표시될 자리가 생긴다.
  if (rows.length === 0 && !executionsNotice && !backupsNotice) return null;

  const backupsById = new Map(backups.map((b) => [b.id, b]));

  return (
    <section>
      <h2 className="text-base font-semibold text-ink">
        {executionsNotice ? t('applyHistoryTitle') : t('applyHistory', { count: rows.length })}
      </h2>
      {/* 이력을 못 불러온 상황에서 백업 알림은 중복이고, 롤백할 이력 자체가 없어 무의미하다. */}
      <InlineError
        message={executionsNotice || backupsNotice}
        tone="notice"
        className="mt-3"
      />
      <div className="mt-3 space-y-4">
        {rows.map((exec) => (
          <ExecutionCard
            key={exec.id}
            exec={exec}
            backup={exec.backupId ? backupsById.get(exec.backupId) : undefined}
            canRollback={canRollback}
            onRolledBack={onRolledBack}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: `ExecutionCard`에서 `onError`를 로컬 state로 전환하고 `rollingBack`을 고치기**

952~970행의 시그니처와 state:

```tsx
function ExecutionCard({
  exec,
  backup,
  canRollback,
  onRolledBack,
}: {
  exec: Execution;
  backup: Backup | undefined;
  canRollback: boolean;
  onRolledBack: () => Promise<unknown>;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('changeRequestDetail');
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState('');
```

975~988행의 `rollback`을 다음으로 교체한다. **성공 경로에 플래그 리셋이 없어 버튼이 영구 비활성으로 남던 기존 버그를 `finally`로 함께 고친다.**

```tsx
  async function rollback() {
    if (!window.confirm(t('rollbackConfirm'))) {
      return;
    }
    setRollingBack(true);
    setError('');
    try {
      await rollbackExecution(exec.id);
      await onRolledBack();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      // 성공 경로에도 반드시 리셋해야 한다. 카드는 exec.id 키로 그대로 마운트된 채 남으므로
      // 리셋하지 않으면 버튼이 "롤백 중…" 라벨로 영구 비활성이 된다.
      setRollingBack(false);
    }
  }
```

- [ ] **Step 8: 롤백 에러를 롤백 버튼 아래에 렌더**

`{showRollback && (...)}` 블록 안, 버튼을 감싼 `<div>` 뒤에 렌더한다:

```tsx
      {showRollback && (
        <div className="border-t border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">{t('rollbackDesc')}</p>
            <button
              onClick={rollback}
              disabled={rollingBack}
              className="focusable shrink-0 rounded-2xl bg-card px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
            >
              {rollingBack ? t('rollingBack') : t('rollback')}
            </button>
          </div>
          <InlineError message={error} className="mt-3" />
        </div>
      )}
```

- [ ] **Step 9: 상단 배너에 `staleContent` 접두 붙이기**

이 태스크에서 마지막 `onError` 작성자가 사라졌으므로, 이제 부모의 `error`에 도달하는 것은
로드 실패뿐이다. 비로소 접두가 사실과 일치한다.

Task 3에서 만든

```tsx
      <InlineError message={error} />
```

를

```tsx
      {/* cr이 이미 있는데 에러가 났다면 갱신만 실패한 것이다. 원시 에러만 보여주면
          "내 승인이 실패했다"로 읽혀 사용자가 다시 눌러 중복 결재를 만든다. */}
      <InlineError message={error ? (cr ? `${t('staleContent')} ${error}` : error) : ''} />
```

로 바꾼다.

- [ ] **Step 10: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @dbflow/web test page.test`
Expected: PASS — 19개 통과 (load 3 + action 5 + apply 4 + history 5 + stale 2).

- [ ] **Step 11: 전체 검증**

Run:
```bash
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web build
```
Expected: 모두 성공. 이 시점에 `page.tsx`에는 `onError`라는 식별자가 남아 있지 않아야 한다:

Run: `grep -c onError "apps/web/app/(app)/change-requests/[id]/page.tsx"`
Expected: `0`

- [ ] **Step 12: 커밋**

```bash
git add "apps/web/app/(app)/change-requests/[id]/page.tsx" \
  "apps/web/app/(app)/change-requests/[id]/page.test.tsx" \
  apps/web/messages/en.json apps/web/messages/ko.json
git commit -m "fix(web): surface apply-history load failures and unstick the rollback button"
```

---

## Task 7: 네트워크 에러 지역화

**Files:**
- Create: `apps/web/lib/api.test.ts`
- Modify: `apps/web/lib/api.ts` (`apiFetch` 35~45행)
- Modify: `apps/web/lib/i18n-client.ts` (`STRINGS`)

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: `apiFetch`가 네트워크 실패 시 `ApiError(0, <지역화된 메시지>)`를 던진다. 13개 화면 전부가 혜택을 본다.

**배경:** `apiFetch`가 `fetch`를 try/catch로 감싸지 않아, 네트워크 끊김·DNS 실패·CORS 오류는 원시 `TypeError`로 거부되고 메시지가 `"Failed to fetch"`(Safari는 `"Load failed"`)가 된다. 지금은 CR 상세 페이지의 버그가 이걸 가리고 있지만, Task 3~6이 그 가림막을 걷어내므로 **이 스펙이 만들어내는 회귀**다. 여기서 함께 닫는다.

- [ ] **Step 1: 실패하는 테스트 작성 — `apps/web/lib/api.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getChangeRequest } from '@/lib/api';

describe('apiFetch network failures', () => {
  beforeEach(() => {
    localStorage.setItem('accessToken', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('turns an unreachable server into a localized ApiError', async () => {
    // 브라우저가 네트워크 실패를 알리는 방식 그대로 — 원시 TypeError.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(getChangeRequest('cr1')).rejects.toBeInstanceOf(ApiError);
    await expect(getChangeRequest('cr1')).rejects.toThrow('Cannot reach the server');
  });

  it('keeps HTTP error responses untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Already applied.' }),
      }),
    );

    await expect(getChangeRequest('cr1')).rejects.toThrow('Already applied.');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @dbflow/web test api.test`
Expected:
- 첫 번째 FAIL: `TypeError: Failed to fetch`가 그대로 새어 나와 `ApiError`가 아니다.
- 두 번째 PASS (기존 동작이 이미 옳다 — 회귀 방지용).

- [ ] **Step 3: `networkError` 문자열 추가 — `apps/web/lib/i18n-client.ts`**

`STRINGS`에 추가한다:

```ts
const STRINGS = {
  requestFailed: { en: 'Request failed.', ko: '요청에 실패했습니다.' },
  sessionExpired: { en: 'Your session has expired. Please sign in again.', ko: '세션이 만료되었습니다. 다시 로그인해 주세요.' },
  exportFailed: { en: 'Export failed.', ko: '내보내기에 실패했습니다.' },
  loginFailed: { en: 'Sign-in failed.', ko: '로그인에 실패했습니다.' },
  networkError: {
    en: 'Cannot reach the server. Check your network connection and try again.',
    ko: '서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
  },
} as const;
```

- [ ] **Step 4: `apiFetch`의 `fetch`를 감싸기 — `apps/web/lib/api.ts`**

35~45행의

```ts
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': currentLocale(),
      ...authHeaders(),
      ...init?.headers,
    },
  });
```

를 다음으로 바꾼다:

```ts
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': currentLocale(),
        ...authHeaders(),
        ...init?.headers,
      },
    });
  } catch {
    // 네트워크 끊김/DNS/CORS는 원시 TypeError("Failed to fetch")로 온다.
    // 그대로 두면 미번역 영어가 화면에 노출된다. status 0은 "응답 없음"을 뜻한다.
    throw new ApiError(0, ct('networkError'));
  }
```

- [ ] **Step 5: `login()`도 같이 감싸기 — `apps/web/lib/api.ts`**

`login()`은 `apiFetch`를 거치지 않고 `fetch`를 직접 호출한다(74행 부근). **VPN이 끊긴
사용자가 가장 먼저 도착하는 화면이 로그인**이므로 여기를 빼면 수정의 효과가 절반이 된다.

```ts
export async function login(email: string, password: string) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': currentLocale() },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError(0, ct('networkError'));
  }
  if (!res.ok) throw new Error(ct('loginFailed'));
  // 이하 기존 코드 유지
```

`downloadAuditExport()`(605행 부근)도 `fetch`를 직접 쓰지만 사용자가 명시적으로 시작한
다운로드이고 실패가 즉시 드러나므로 이번 범위에서 제외한다.

- [ ] **Step 6: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @dbflow/web test api.test`
Expected: PASS — 2개 통과.

- [ ] **Step 7: 전체 검증**

Run:
```bash
pnpm --filter @dbflow/web exec tsc --noEmit && \
pnpm --filter @dbflow/web test && \
pnpm --filter @dbflow/web build
```
Expected: 모두 성공. 전체 테스트 27개 통과(page 19 + api 2 + inline-error 4 + 스모크 1 + 카탈로그 대칭 1).

- [ ] **Step 8: 커밋**

```bash
git add apps/web/lib/api.ts apps/web/lib/api.test.ts apps/web/lib/i18n-client.ts
git commit -m "fix(web): localize network failures instead of leaking 'Failed to fetch'"
```

---

## Task 8: 문서 갱신

**Files:**
- Modify: `docs/feature-checklist.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: Task 1~7의 완료 상태
- Produces: 없음 (문서만)

- [ ] **Step 1: `docs/feature-checklist.md`에 수동 QA 항목 추가**

파일을 읽어 CR 상세 관련 섹션을 찾고, 그 아래에 다음 항목을 추가한다(체크박스 형식은 해당 파일의 기존 스타일을 따를 것):

```markdown
- [ ] CR 상세: 반려 사유 없이 "반려"를 누르면 코멘트 입력란 아래에 사유 필수 메시지가 뜨고 입력란에 포커스가 간다
- [ ] CR 상세: 사유를 입력하기 시작하면 그 메시지가 사라진다
- [ ] CR 상세: 승인/적용/롤백이 실패하면 에러가 해당 버튼 옆에 뜬다(페이지 최상단이 아니라)
- [ ] CR 상세: 액션 성공 후 갱신이 실패하면 "화면을 갱신하지 못했습니다" 문구와 함께 기존 내용이 유지된다
- [ ] CR 상세(STAGING/PROD): 린트 조회가 실패하면 적용 버튼이 비활성화되고 "다시 확인" 버튼이 나타난다
- [ ] CR 상세(DEV): 린트 조회가 실패해도 적용 버튼은 비활성화되지 않는다
- [ ] CR 상세: 롤백에 성공한 뒤 롤백 버튼이 다시 활성화된다
- [ ] 네트워크를 끊고 아무 액션이나 실행하면 "서버에 연결할 수 없습니다"가 뜬다(영문 "Failed to fetch"가 아니라)
```

- [ ] **Step 2: `docs/ROADMAP.md`의 0단계를 완료 처리**

"### 0단계 — 버그픽스" 아래 항목을 체크한다:

```markdown
### 0단계 — 버그픽스 (최우선, S) ✅ 완료
- [x] **CR 상세 에러 표시 버그** — 에러 3종 분리(로드/액션/약화된 통제 알림), 린트 fail-closed(STAGING·PROD), 백업·이력 조회 실패 알림, 롤백 버튼 고착 수정, 네트워크 에러 지역화. 프론트엔드 테스트 인프라(Vitest+RTL) 동반 도입
```

- [ ] **Step 3: 커밋**

```bash
git add docs/feature-checklist.md docs/ROADMAP.md
git commit -m "docs: record stage-0 completion and its manual QA items"
```

---

## 최종 검증

전체 태스크 완료 후 다음을 모두 실행한다.

```bash
cd /Users/jinhyeongyu/toy-project/project-dbflow
pnpm --filter @dbflow/web test          # 27개 통과
pnpm --filter @dbflow/web exec tsc --noEmit
pnpm --filter @dbflow/web build
pnpm --filter @dbflow/api test          # 기존 API 스위트 회귀 없음
grep -c onError "apps/web/app/(app)/change-requests/[id]/page.tsx"   # 0
```

수동 QA: `./start.sh` 후 `docs/feature-checklist.md`에 추가한 8개 항목을 확인한다.

## 스펙 대비 테스트 매핑

스펙 §9는 12개를 요구했다. 이 계획은 `page.test.tsx`에 19개, 전체 27개로 늘렸다 — 스펙의
12개는 하한이었고, 태스크별 TDD 사이클을 완결시키려면 액션별 커버리지가 더 필요했다.

| 스펙 §9 | 계획 |
|---|---|
| #1 빈 코멘트 반려 | Task 4 `shows the missing-reason validation…` |
| #2 승인 실패 | Task 4 `scopes a failed decision to its own instance…` |
| #3 초기 로드 실패 (positive control) | Task 3 `shows the banner when the initial load fails` |
| #4 갱신 실패 + staleContent | Task 3 `keeps the loaded content visible…` + **Task 6** `tells the user the screen is stale…` |
| #5 재시도 성공 시 클리어 | Task 3 `clears the load error once a later refresh succeeds` |
| #6 PROD 린트 실패 | Task 5 `blocks apply on PROD…` |
| #7 DEV 린트 실패 | Task 5 `does not block apply on DEV…` |
| #8 린트 재시도 | Task 5 `re-enables apply after a successful lint retry` |
| #9 백업 500/403 | Task 6 `warns when the backup list…` + `stays silent when…forbidden` |
| #10 롤백 성공 후 재활성화 | Task 6 `re-enables the rollback button…` |
| #11 코멘트 보존 | Task 4 `scopes a failed decision…keeps the typed comment` |
| #12 dry-run 실패 위치 | Task 5 `shows a dry-run failure inside the dry-run section…` |
| 카탈로그 대칭 | Task 1 `en and ko expose an identical key set` |
| (추가) 검증 메시지 입력 시 소멸 | Task 4 `clears the validation message as soon as…` |
| (추가) 제출 실패의 **인라인 배치** | Task 4 `shows a failed submit inside the action panel…` |
| (추가) 담당자 저장 실패 | Task 4 `shows a failed assignee save…` |
| (추가) 이력 조회 실패 + 개수 없는 제목 | Task 6 `says the history could not be loaded…` |
| (추가) 롤백 실패의 **인라인 배치** | Task 6 `shows a failed rollback inside its own execution card…` |
| (추가) 첫 로드 실패엔 stale 문구 없음 | Task 6 `does not claim staleness when the very first load fails` |
| (추가) 네트워크 에러 지역화 | Task 7 `turns an unreachable server into a localized ApiError` |
| (추가) HTTP 에러 회귀 방지 | Task 7 `keeps HTTP error responses untouched` |
| (추가) 인프라 스모크 | Task 1 `renders a component through the @/ alias…` |
| (추가) `InlineError` 단위 4개 | Task 2 |

### 검수에서 실증된 것

계획 초안을 스크래치 복사본에 그대로 구현해 실행한 결과, **두 테스트가 수정 전에도
통과**했다 — 제출 실패와 롤백 실패. 둘 다 `screen.findByRole('alert')`만 확인해서 상단
배너로 충족됐고, 인라인 배치를 전혀 증명하지 못했다. 스펙 §9가 이름 붙여 금지한 바로 그
실패 양식이다. 위 표에서 **인라인 배치**로 표시한 두 항목은 포함 관계(`closest(...).contains`)
단언으로 교체해 실제로 red가 되도록 고친 것이다.

`makeTargetDb`·`makeExecution`·`makeBackup`을 import 없이 쓰던 Task 5·6의 컴파일 오류,
DEV에서 "적용할 수 없습니다"라고 쓰면서 적용 버튼은 활성인 문구 모순도 같은 검수에서
발견해 반영했다.
