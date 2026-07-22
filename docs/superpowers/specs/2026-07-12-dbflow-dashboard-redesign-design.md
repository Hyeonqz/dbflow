# DBFlow 대시보드 리디자인 — 설계 문서

- 작성일: 2026-07-12 (리뷰 반영 2026-07-16)
- 상태: 구현 착수 (브랜치 `feat/web-dashboard-redesign`)
- 범위: 웹 프론트엔드(`apps/web`) UI 레이아웃 개편 + 테마(다크/라이트) 도입

> **리뷰 반영 결정사항 (2026-07-16, critic 리뷰 후 확정)** — 아래 §12에 상세.
> - **C1**: KPI 카드는 역할별 맞춤(백엔드 가시성 종속). 전역 4카드 가정 폐기.
> - **M1**: stock Tailwind 클래스(`bg-white`/`ring-gray-*`/`text-gray-*`)는 신규 시맨틱 토큰으로 **전 파일 일괄 치환**(작업량 인정).
> - **M2**: `ink`/`white` 이중 용도 격리 — 코드블록·활성탭용 고정 어두운 토큰 `code` 도입.
> - **M3**: `ThemeProvider` + FOUC 스크립트는 **루트 `app/layout.tsx`**. 앱셸은 `(app)` 그룹 layout.
> - `DataTable` 공용화 안 함(YAGNI). 테이블 2곳 각자 구현.

## 1. 배경 / 문제

현재 `apps/web`는 도메인 기능(로그인 → 변경요청 작성/검토/결재/적용, 스키마 Diff, 대상 DB 관리)이 모두 동작하지만, 화면이 **모바일 앱 형태**로 만들어져 있다.

- 모든 페이지가 좁은 중앙 컬럼(`max-w-2xl` / `max-w-3xl`)에 렌더된다.
- 전역 네비게이션이 없고, 페이지마다 `← 대시보드` 백링크로 이동한다.
- `/dashboard`가 실질적으로 **버튼 링크 3개 모음**이라 "대시보드"라 부르기 어렵다.
- 넓은 화면(데스크톱)에서 공간이 비어 단순해 보인다.

목표: **관리자 콘솔(admin console) 레이아웃**으로 전환해 한눈에 파악 가능한 깔끔한 화면을 만든다. 도메인 로직·API·데이터 모델은 변경하지 않는다.

## 2. 설계 원칙 / 비목표

**원칙**
- 기존 디자인 토큰(팔레트, 뱃지, `rounded-2xl`)을 **유지**하고 담는 그릇(레이아웃)만 바꾼다.
- 새 런타임 의존성 추가 없음. Tailwind + Next.js App Router 범위 안에서 해결.
- 기존 역할 기반 접근 규칙(개발자/검토자/결재자)을 레이아웃에 그대로 반영.

**비목표 (YAGNI)**
- 백엔드 API 추가/변경 없음. 대시보드 지표는 기존 `listChangeRequests` 응답을 **클라이언트에서 집계**한다.
- 실시간 갱신, 차트 라이브러리, i18n, 접근성 전면 감사(감사는 별도 작업)는 이번 범위 밖.
- 데이터 모델·인증 방식(localStorage 토큰) 변경 없음.

## 3. 현재 구조 요약 (기준선)

- 스택: Next.js 14 App Router, Tailwind, 클라이언트 인증(`lib/auth.ts`, localStorage).
- 라우트: `/login`, `/dashboard`, `/change-requests`, `/change-requests/new`, `/change-requests/[id]`, `/schema-diff`, `/target-databases`.
- 디자인 토큰(`tailwind.config.ts`): `primary(#3182f6/dark #1b64da)`, `ink(#191f28)`, `muted(#8b95a1)`, `surface(#f2f4f6)`, `rounded-2xl(20px)`.
- 공용 컴포넌트: `components/badges.tsx`(상태/환경/실행/백업/Diff/Lint 뱃지 — 재사용).
- 역할별 접근 규칙(레이아웃에 반영해야 함):
  - **스키마 Diff**: 검토자 접근 불가 (개발자·결재자만).
  - **대상 DB 관리**: 결재자만.
  - **변경요청 생성**: 개발자만.

## 4. 목표 아키텍처

### 4.1 앱 셸 (전 페이지 공통)

```
┌──────────┬─────────────────────────────────────┐
│  DBFlow  │  [페이지 타이틀]          [+ 액션]   │  ← 상단바(PageHeader)
│          ├─────────────────────────────────────┤
│ 🏠 대시보드 │                                     │
│ 📋 변경요청 │        메인 콘텐츠 영역              │
│ 🔍 스키마Diff│      (max-w-6xl, 카드/테이블)       │
│ 🗄 대상 DB  │                                     │
│          │                                     │
│──────────│                                     │
│ 🌗 테마    │                                     │
│ 김개발     │                                     │
│ 개발자     │                                     │
│  로그아웃  │                                     │
└──────────┴─────────────────────────────────────┘
```

- **좌측 고정 사이드바**: 로고 / 역할별 네비 항목 / 하단 테마 토글 + 사용자 정보 + 로그아웃.
- **네비 항목은 역할로 필터**: 스키마 Diff(검토자 숨김), 대상 DB(결재자만), 변경요청 생성 CTA(개발자만). 접근 규칙과 1:1 일치.
- 흩어진 `← 대시보드` / `← 목록으로` 백링크는 **전부 제거**하고 사이드바 네비로 대체.
- **반응형**: `lg` 이상은 고정 사이드바, 그 미만은 상단 바 + 햄버거 → 슬라이드 드로어(오버레이). 드로어 열림 상태는 로컬 컴포넌트 state.
- **인증 가드 통합**: 로그인 필요한 페이지는 셸이 `useCurrentUser`로 가드. `/login`은 셸 밖(풀스크린 중앙 정렬 유지).

### 4.2 대시보드 페이지 (`/dashboard`) — 역할 맞춤

1. **KPI 카드 4개** — `listChangeRequests` 결과를 클라이언트 집계:
   - 검토 대기 = `status === 'SUBMITTED'`
   - 결재 대기 = `status === 'REVIEW_APPROVED'`
   - 반려 = `status ∈ {REVIEW_REJECTED, FINAL_REJECTED}`
   - 완료 = `status ∈ {FINAL_APPROVED, APPLIED}`
   - 현재 역할에 해당하는 카드(검토자→검토 대기, 결재자→결재 대기)를 primary 강조.
   - 각 카드 클릭 시 해당 필터가 적용된 `/change-requests`로 이동.
2. **주요 액션 배너**: 역할별 CTA(개발자→변경요청 만들기, 검토자→검토 대기 보기, 결재자→결재 대기 보기). 기존 `ROLE_ACTION` 매핑 재사용.
3. **최근 변경요청 테이블**: 최신 5–8건(제목·환경 뱃지·상태 뱃지·작성자·생성일). 행 클릭 → 상세로. "전체 보기" → `/change-requests`.

로딩/에러 상태: 스켈레톤 또는 기존 "불러오는 중…" 패턴 유지. 데이터 없을 때 빈 상태 카드.

### 4.3 변경요청 목록 (`/change-requests`) — 테이블화

- 현재 세로 카드 리스트 → 콘솔풍 **테이블**(컬럼: 제목 / 환경 / 상태 / 작성자 / 생성일).
- 상태 필터 탭(전체/검토대기/결재대기/반려/완료)은 **유지**.
- 모바일(`sm` 미만)에서는 테이블이 카드형으로 자연스럽게 스택되도록 반응형 처리.

### 4.4 나머지 페이지 (상세 / 생성 / 대상 DB / 스키마 Diff)

- 콘텐츠·폼 로직은 **그대로 유지**, 앱 셸 안에 배치하고 넓은 폭을 활용.
- 상세/생성 폼은 여유 있는 2-컬럼(모바일 1-컬럼)로 재배치. 기능 변경 없음.
- 각 페이지 상단의 백링크 제거, 대신 `PageHeader`(타이틀 + 우측 액션 버튼).

## 5. 테마 (다크 / 라이트)

**요구사항**: 사용자가 다크/라이트를 선택 가능. 기본값은 **system default**(`prefers-color-scheme`).

### 5.1 방식 — CSS 변수 기반 시맨틱 토큰 + `class` 다크모드

현재 색상이 하드코딩 hex(`bg-white`, `text-ink`, `ring-gray-100` 등)로 페이지마다 흩어져 있어, 다크모드를 페이지별 `dark:` 유틸로 일일이 붙이면 유지보수가 어렵다. 대신 **시맨틱 토큰을 CSS 변수로 정의**하고 라이트/다크에서 값만 바꾼다.

- `tailwind.config.ts`에 `darkMode: 'class'` 설정.
- `globals.css`의 `:root`(라이트)와 `.dark`(다크)에 시맨틱 변수 정의:
  - `--bg`(페이지 배경), `--surface`(카드), `--border`, `--ink`(본문), `--muted`(보조), `--primary` 등.
- Tailwind color를 CSS 변수 참조로 매핑(예: `surface: 'var(--surface)'`). 기존 토큰 이름은 최대한 유지해 페이지 수정 폭을 줄인다.
- 뱃지의 의미색(성공=emerald, 위험=red 등)은 라이트/다크 모두에서 대비가 유지되도록 다크 값만 보정.

> 트레이드오프: 시맨틱 토큰 전환은 초기 작업이 페이지별 `dark:` 부착보다 크지만, 전 페이지가 한 번에 다크 대응되고 이후 유지보수가 단순해진다. 전면 테마가 목표이므로 이 방식을 채택한다.

### 5.2 토글 동작

- **ThemeProvider**(클라이언트): 마운트 시 `localStorage.theme`(`'light' | 'dark' | 'system'`)를 읽는다. 없으면 `'system'`.
- 실제 적용값 = `system`이면 `prefers-color-scheme` 결과, 아니면 저장값. `<html>`에 `.dark` 클래스 토글.
- **FOUC 방지**: `<head>`에 인라인 스크립트로 첫 페인트 전 클래스를 선반영(Next.js `beforeInteractive` 패턴 또는 `layout`의 `<script dangerouslySetInnerHTML>`).
- **토글 UI**: 사이드바 하단에 라이트/다크/시스템 3-상태 토글(또는 아이콘 버튼). 선택 시 `localStorage.theme` 갱신 + 즉시 반영.
- `system` 선택 시 OS 테마 변경을 `matchMedia` 리스너로 실시간 반영.

## 6. 컴포넌트 설계

새로 뽑을 공용 컴포넌트(각각 단일 책임):

| 컴포넌트 | 역할 | 의존 |
|---|---|---|
| `AppShell` | 사이드바 + 상단바 + 콘텐츠 슬롯, 인증 가드, 반응형 드로어 | `useCurrentUser`, `Sidebar` |
| `Sidebar` | 역할별 네비 항목 렌더, 활성 라우트 하이라이트, 하단 사용자/테마/로그아웃 | `usePathname`, `ThemeToggle` |
| `PageHeader` | 페이지 타이틀 + 우측 액션 슬롯 | — |
| `StatCard` | KPI 카드(라벨/값/강조/링크) | `badges`(선택) |
| `DataTable` (경량) | 반응형 테이블 래퍼(헤더/행/모바일 스택). 과설계 방지를 위해 얇게 | — |
| `ThemeProvider` / `ThemeToggle` | 테마 상태·적용·토글 | localStorage, matchMedia |

- 기존 `components/badges.tsx`, `lib/auth.ts`, `lib/api.ts`, `lib/format.ts`는 **재사용**(수정 최소화).
- `AppShell`은 각 페이지에서 감싸는 형태 또는 App Router의 그룹 `layout.tsx`로 적용(로그인 라우트는 그룹 밖). 구현 계획 단계에서 확정.

## 7. 데이터 흐름

- 인증: 변화 없음(localStorage 토큰, `useCurrentUser` 가드). 셸이 가드를 대신 수행.
- 대시보드 KPI/최근목록: 기존 `listChangeRequests()` 1회 호출 → 클라이언트에서 카운트·정렬·slice. **신규 엔드포인트 없음.**
- 테마: 클라이언트 전용 상태(localStorage + matchMedia), 서버 왕복 없음.

## 8. 반응형 / 접근성 기준선

- 브레이크포인트: `lg`(1024px) 기준으로 사이드바 고정 ↔ 드로어 전환.
- 테이블은 `sm` 미만에서 카드형 스택.
- 네비/토글은 키보드 포커스 가능, `aria-current`로 활성 항목 표시, 드로어는 `Esc` 닫기. (전면 접근성 감사는 별도.)

## 9. 영향 범위 / 마이그레이션

- **수정**: `tailwind.config.ts`(darkMode, 시맨틱 색), `globals.css`(CSS 변수), `layout.tsx`(테마 부트스트랩), 각 `page.tsx`(셸 적용·백링크 제거·폭 조정), `/dashboard`·`/change-requests` 대폭 개편.
- **신규**: `AppShell`, `Sidebar`, `PageHeader`, `StatCard`, `DataTable`, `ThemeProvider`/`ThemeToggle`.
- **불변**: API 클라이언트(`lib/api.ts`), 백엔드(`apps/api`) 전체, 데이터 모델, 도메인 폼 로직.

## 10. 열린 질문 (구현 계획 단계에서 확정)

1. 앱 셸 적용을 App Router 그룹 `layout.tsx`로 할지, 페이지별 래퍼 컴포넌트로 할지.
2. 사이드바 아이콘: 이모지 유지 vs 경량 인라인 SVG(의존성 없이).
3. `DataTable`을 공용화할지, 목록/대시보드 각자 테이블로 둘지(과설계 경계).

## 11. 성공 기준

- 데스크톱에서 좌측 네비 + 넓은 콘텐츠의 콘솔 레이아웃으로 모든 페이지가 통일된다.
- `/dashboard`가 KPI 카드 + 최근 변경요청 테이블로 "대시보드"답게 보인다.
- 라이트/다크/시스템 테마를 토글할 수 있고, 새로고침 시 FOUC 없이 유지된다.
- 기존 도메인 기능(작성/검토/결재/적용/Diff/대상DB)이 회귀 없이 동작한다.
- 모바일에서 사이드바가 드로어로 접혀 사용 가능하다.

## 12. 리뷰 반영 상세 (2026-07-16)

> **⚠️ 부분 대체됨 (2026-07-17)**: §12.1 KPI 역할 매트릭스와 §12.3의 "테마 토글=사이드바 하단"은
> `2026-07-17-dbflow-assignments-profiles-telegram-design.md`가 대체한다.
> KPI는 지정(reviewerId/approverId) 기반으로, 테마 토글은 우상단 설정 모달로 이동.

### 12.1 C1 — 역할별 KPI 카드 매트릭스

백엔드 `change-request.service.ts`의 `visibilityWhere()`가 목록을 역할별로 스코프하므로, `listChangeRequests()` 집계로 만들 수 있는 카드는 역할마다 다르다. 전역 4카드 가정을 폐기하고 아래 매트릭스를 따른다.

| 역할 | 응답에 담기는 status | 표시 카드 | 라벨 주의 |
|---|---|---|---|
| **REVIEWER** | `DRAFT` 제외 전체 | 검토 대기(SUBMITTED) · 결재 대기(REVIEW_APPROVED) · 반려(REVIEW_REJECTED∪FINAL_REJECTED) · 완료(FINAL_APPROVED∪APPLIED) | 전역 관점, 4카드 모두 정상 |
| **APPROVER** | REVIEW_APPROVED·FINAL_APPROVED·FINAL_REJECTED·APPLIED | 결재 대기(REVIEW_APPROVED) · 완료(FINAL_APPROVED∪APPLIED) · 반려(FINAL_REJECTED) | "검토 대기" 카드 **미표시**. "반려"는 최종 반려만 |
| **DEVELOPER** | `authorId=본인` 전체 | 내 작성 중(DRAFT) · 내 진행 중(SUBMITTED∪REVIEW_APPROVED) · 내 반려(REVIEW_REJECTED∪FINAL_REJECTED) · 내 완료(FINAL_APPROVED∪APPLIED) | 전부 "내 요청" 관점, 라벨에 명시 |

- 각 카드는 클릭 시 해당 필터가 걸린 `/change-requests`로 이동. 역할 응답에 없는 status 필터탭(예: 결재자의 "검토 대기")은 목록 페이지에서도 노출하지 않는다(리뷰 m4).
- 현재 역할의 "대기" 카드(검토자→검토 대기, 결재자→결재 대기, 개발자→내 진행 중)를 primary 강조.

### 12.2 M1/M2 — 시맨틱 토큰 & 일괄 치환 매핑

`tailwind.config.ts`에 `darkMode: 'class'`. `globals.css`의 `:root`/`.dark`에 CSS 변수 정의. Tailwind color를 변수 참조로 매핑하고, 아래 표대로 전 페이지 className을 **일괄 치환**한다.

| 신규 토큰(Tailwind) | 용도 | 라이트 | 다크 | 대체 대상(기존 클래스) |
|---|---|---|---|---|
| `bg-bg` | 페이지 배경 | `#f2f4f6` | `#0f1115` | `body`, `bg-surface`(페이지 한정) |
| `bg-card` | 카드/패널 배경 | `#ffffff` | `#181b20` | `bg-white` |
| `bg-subtle` | 보조 버튼/영역 배경 | `#f2f4f6` | `#22262e` | `bg-surface`(버튼), `bg-gray-100` |
| `ring-border` / `border-border` | 얇은 테두리 | `#f1f3f5` | `#2a2f37` | `ring-gray-100` |
| `ring-border-strong` | 강한 테두리 | `#e5e8eb` | `#3a4049` | `ring-gray-200` |
| `text-ink` | 본문 텍스트 | `#191f28` | `#e9edf1` | `text-ink`(변수화, 클래스명 유지) |
| `text-muted` | 보조 텍스트 | `#8b95a1` | `#9aa5b1` | `text-muted`, `text-gray-600` |
| `bg-code` / `text-code-fg` | **고정** 어두운 코드/활성 서피스 | `#191f28` / `#e5e7eb` | `#0d1117` / `#e5e7eb` | `bg-ink`(코드블록) |
| `bg-primary`,`text-primary` | 강조 | `#3182f6` | `#4b93f7` | 동일(변수화) |

- **이중 용도 격리(M2)**: `text-ink`/`text-white`(전경)는 리네임하지 않고 그대로 둔다. `bg-ink`(코드블록 배경)만 `bg-code`로 이관. 활성 탭 `bg-ink text-white` → `bg-primary text-white`로 변경(다크에서 ink 반전 파손 회피).
- **뱃지(`components/badges.tsx`)**: 의미색 `bg-*-50 text-*-600` 계열은 토큰 리매핑으로 안 덮이므로 각 항목에 `dark:` 변형을 추가(예: `dark:bg-emerald-500/15 dark:text-emerald-300`). 대비 유지가 목적.
- 정확한 파일별 치환 대상 수량은 구현 시 인벤토리 기준(대략 `bg-white`≈39, `ring-gray-100`≈23, `ring-gray-200`≈13, `text-gray-*`≈10, 뱃지≈34).

### 12.3 M3 — 테마 부트스트랩 위치

- `ThemeProvider`(클라이언트)와 FOUC 방지 인라인 스크립트는 **루트 `app/layout.tsx`**의 `<head>`/`<body>` 최상위에 둔다 → 로그인 포함 모든 라우트가 첫 페인트부터 테마 반영.
- 인라인 스크립트: `localStorage.theme`(없으면 `matchMedia('(prefers-color-scheme: dark)')`)를 읽어 `<html>`에 `.dark` 즉시 부여.
- `ThemeToggle` UI는 사이드바 하단에만(로그인 화면엔 토글 없음, 테마 자체는 적용됨).

### 12.4 앱셸 적용 방식

- `app/(app)/layout.tsx` 그룹 layout에 `AppShell`(사이드바+상단바+인증가드) 배치. 기존 인증 페이지들을 `app/(app)/` 하위로 이동:
  `dashboard`, `change-requests/**`, `schema-diff`, `target-databases`.
- `/login`은 그룹 밖(루트 직속 `app/login`) 유지 → 셸 없이 풀스크린.
- 각 페이지의 `← 대시보드`/`← 목록으로` 백링크 및 페이지 내 `<main className="mx-auto max-w-*">` 래퍼 제거 → 셸이 폭·패딩 담당. 권한 없는 페이지의 인페이지 가드 카드는 백링크 없이 유지(네비로 이동).
