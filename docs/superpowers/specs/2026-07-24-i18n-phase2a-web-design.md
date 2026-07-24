# i18n Phase 2a — 웹 다국어 (영어 기본 + 한국어) 설계

> 2026-07-24. 오픈소스 전환 M3(i18n)의 Phase 2a. 전략 문서 `docs/open-source-strategy.md` §6, 결정 §4-D(쿠키+미들웨어, URL 불변).
> 범위: **웹 UI 문자열만**. api 예외 메시지 국제화는 Phase 2b(별도 스펙). 라이브러리 `next-intl`.

## 목표와 종료 기준

**목표**: 웹 UI가 **영어를 기본**으로 표시되고, 사용자가 한국어로 전환할 수 있다. 언어 추가는 json 파일 추가로 끝나는 구조.

**종료 기준**:
1. 첫 방문(쿠키 없음) 시 UI가 **영어**로 표시된다.
2. 사이드바의 언어 전환으로 한국어↔영어 즉시 전환되고, 쿠키에 저장돼 새로고침/재방문에도 유지된다.
3. 기존 한국어 문자열이 전부 `messages/ko.json`으로 이전되고 동등한 영어가 `messages/en.json`에 있다 (남은 하드코딩 한국어 0 — `lib/`의 React 밖 문자열 포함).
4. `<html lang>`이 활성 로케일을 반영한다.
5. 날짜 표시가 로케일 기반(en: en-US, ko: ko-KR)이되, 적용 작업창 등 **비즈니스 시각의 Asia/Seoul 기준은 언어와 무관하게 유지**.
6. web 프로덕션 빌드(`pnpm --filter @dbflow/web build`) 성공, Docker 이미지 정상 기동.

**스코프 제외**: api NestJS 예외 메시지(백엔드가 반환하는 한국어) → Phase 2b. Phase 2a 동안 영어 UI에서 백엔드 에러 상세는 한국어로 보일 수 있음(전략 §6-5의 단계적 롤아웃, 수용).

## 아키텍처 (next-intl, 쿠키 로케일, URL 무변경)

현재 앱: Next.js 14.2 App Router, 페이지 대부분 `'use client'`, 커스텀 app-shell. `app/layout.tsx`·`app/(app)/layout.tsx`만 서버 컴포넌트.

### 로케일 결정 (미들웨어 없음)
- 지원 로케일 `['en', 'ko']`, 기본 `'en'`. URL prefix 미사용(§4-D).
- `LOCALE_COOKIE = 'dbflow_locale'`. 값이 `en`/`ko`면 사용, 없거나 그 외면 `'en'` 폴백.
- 미들웨어 불필요 — 서버 컴포넌트 `app/layout.tsx`에서 쿠키를 읽어 로케일 결정. (Accept-Language 자동 협상은 도입 안 함 — 기본 영어로 충분, 사용자가 토글.)

### 파일 구성
- **`apps/web/i18n/config.ts`** (신규): `export const locales = ['en','ko'] as const; export type Locale = (typeof locales)[number]; export const defaultLocale: Locale = 'en'; export const LOCALE_COOKIE = 'dbflow_locale';` + `resolveLocale(value?: string): Locale` (쿠키값 검증).
- **`apps/web/i18n/request.ts`** (신규): next-intl `getRequestConfig` — `cookies()`에서 로케일 읽어 `resolveLocale`, `messages: (await import(\`../messages/${locale}.json\`)).default` 반환.
- **`apps/web/messages/en.json`, `apps/web/messages/ko.json`** (신규): 메시지 카탈로그(네임스페이스 구조는 아래 §카탈로그).
- **`apps/web/next.config.js`** (수정): `const withNextIntl = require('next-intl/plugin')('./i18n/request.ts');` 로 래핑. 기존 `output:'standalone'`/`outputFileTracingRoot` 유지(plugin은 webpack alias만 주입, 이들 무영향).
- **`apps/web/app/layout.tsx`** (수정, 서버 컴포넌트): `const locale = await getLocale(); const messages = await getMessages();` → `<html lang={locale}>`, `<body>`에서 `<NextIntlClientProvider locale={locale} messages={messages}><ThemeProvider>{children}</ThemeProvider></NextIntlClientProvider>`. `metadata.title/description`도 로케일별(generateMetadata 사용 또는 정적 영어).
- **`apps/web/components/locale-toggle.tsx`** (신규): `components/theme.tsx`의 `ThemeToggle`(radiogroup 패턴, line 56-92) 복제 — 쿠키 기록 + `router.refresh()`로 서버 재렌더 트리거. EN/한 2버튼.
- **`apps/web/components/sidebar.tsx`** (수정): line 99 `<ThemeToggle />` 옆에 `<LocaleToggle />` 삽입.

### 클라이언트 소비
- 대부분 `'use client'` 컴포넌트 → `useTranslations('<namespace>')` 훅으로 `t('key')`.
- 서버 컴포넌트(2개 레이아웃)는 `next-intl/server`의 `getTranslations`.
- **React 밖 문자열**(`lib/api.ts`의 fetch 에러 fallback, 훅 사용 불가): 신규 **`apps/web/lib/i18n-client.ts`** — `document.cookie`에서 로케일 읽어 소형 인라인 en/ko 맵에서 선택하는 `ct(key)`. `lib/api.ts`의 fallback 문자열 ~4개(요청 실패/세션 만료/내보내기 실패)만 대상. (백엔드가 준 `message`는 그대로 표시 — Phase 2b 대상.)

## 메시지 카탈로그 구조

네임스페이스 = 화면/도메인 단위. 키는 영어 slug. 보간은 ICU `{name}`.

```
common.*        저장/취소/삭제/생성/로딩/에러 등 공용 액션·상태
nav.*           사이드바 메뉴명
enum.status.*   ChangeRequestStatus (DRAFT…APPLIED) — badges.tsx STATUS_STYLE
enum.role.*     Role (DEVELOPER…ADMIN) — lib/auth.ts ROLE_LABEL
enum.execution.* / enum.diffKind.* / enum.backup.* / enum.sqlType.*  — badges.tsx 나머지 맵
dashboard.*, changeRequests.*, changeRequestDetail.*, targetDatabases.*,
applySchedule.*, audit.*, schemaDiff.*, delegations.*, users.*,
sqlReview.*, approvalPolicy.*, login.*   — 각 페이지
errors.*        lib/api.ts 클라이언트 fallback (i18n-client.ts와 공유)
```

`en.json`은 기본 = 영어 원문. `ko.json`은 기존 코드의 한국어를 그대로 이전. **enum/role 맵은 `className`은 코드에 두고 `label`만 `t('enum.status.DRAFT')`로 스왑**(키셋이 안정적인 enum 값).

## 날짜/숫자 포맷

- **`apps/web/lib/format.ts`** (수정): `formatDateTime(iso, locale)` — `Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {...})`. 호출부는 `useLocale()`로 로케일 전달.
- 인라인 중복 3곳(`delegations/page.tsx:25`, `apply-schedule/page.tsx:29`의 `fmtKst`, `change-requests/[id]/page.tsx:747`)을 이 헬퍼로 통합. **`timeZone:'Asia/Seoul'`은 유지**(작업창/동결 판정 시각은 언어 무관 — 배포 타임존 파라미터화는 별도 트랙).

## 언어 전환 UI

`components/locale-toggle.tsx`: `theme.tsx`의 radiogroup 패턴 복제. 옵션 `[{v:'en',label:'EN'},{v:'ko',label:'한'}]`. 클릭 시 `document.cookie = 'dbflow_locale=<v>; path=/; max-age=31536000'` 후 `router.refresh()`(서버가 새 쿠키로 재렌더 → provider 메시지 교체). 사이드바 푸터(collapsed 아닐 때) ThemeToggle 옆.

## 구현 순서 (플랜에서 태스크화)

1. **인프라 + 증명**: `next-intl` 설치, `i18n/config.ts`·`request.ts`, `next.config` 플러그인, 루트 provider + `<html lang>`, `locale-toggle` + 사이드바 삽입, `messages/{en,ko}.json` 뼈대(common + nav). **사이드바 메뉴가 en/ko로 전환되면 인프라 완성**.
2. **enum 라벨**: `badges.tsx`(7개 맵 중 한국어 라벨) + `lib/auth.ts` ROLE_LABEL → `enum.*` 네임스페이스. label만 `t()`로.
3. **포맷 헬퍼**: `lib/format.ts` 로케일화 + 인라인 3곳 통합.
4~N. **페이지별 추출**: Hangul 많은 순으로 area당 1태스크 — change-request-detail(95) → change-requests(new+list) → target-databases → apply-schedule → audit → schema-diff → delegations → dashboard → users → sql-review → approval-policy → login. 각 태스크: 해당 파일 한국어를 `<namespace>.json`(en/ko)로 이전 + `useTranslations` 적용, 빌드·tsc 통과.
N+1. **React 밖 문자열**: `lib/i18n-client.ts` + `lib/api.ts` fallback ~4개. 잔여 하드코딩 한국어 0 검증(grep).

## 검증 계획

- 각 태스크: `pnpm --filter @dbflow/web build` + tsc 통과, 변경 파일 한국어 잔존 grep 0.
- 인프라(태스크1) 후: dev/이미지에서 쿠키 없이 영어 표시, 토글로 한국어 전환·유지 확인.
- 최종: 전 페이지 en/ko 스팟체크, `grep -rn '[가-힣]' apps/web/app apps/web/components apps/web/lib` → 결과는 messages/*.json 과 주석만(코드 문자열 0). 날짜가 로케일별 표기, 작업창 시각은 KST 유지.
- Docker: `docker build -f apps/web/Dockerfile` 성공 + `/login` 200(영어).

## 리스크

- **standalone + 동적 import 메시지**: `messages/*.json`을 `outputFileTracingRoot` 하에서 standalone이 포함하도록 확인(next-intl plugin이 처리하나 이미지 기동 스모크로 확정).
- **문자열량(~500)**: 태스크를 area로 쪼개 점진 진행. 영어 번역은 기본 초안 작성(도메인 용어는 기존 영문 enum·README 용어와 정합: Change Request, Reviewer, Approver, Apply, Freeze 등).
- **보간 문자열**: `[id]/page.tsx:747` 등 혼합 JSX는 ICU `t.rich`/`{param}`로. 태스크 내에서 개별 처리.
- **`router.refresh()` 후 클라이언트 상태**: localStorage 인증·폼 상태는 유지(쿠키/서버 재렌더만 트리거)—전환 시 로그인 유지 확인.
