# 사이드바 접기/펴기 (아이콘 레일) 설계

> 2026-07-22. 관리 UX 개선 슬라이스 B(사용자 관리 페이징은 별도 스펙 A). 순수 프론트엔드.

## 1. 목표

데스크톱 사이드바를 접었다 펼 수 있게 하고, 접으면 본문이 넓어진다.

- 사용자 확정: **아이콘 레일**(접으면 라벨 숨기고 아이콘만) / 상태 **localStorage 기억**.
- 범위: **데스크톱(lg+)만**. 모바일은 기존 슬라이드 드로어 유지(변경 없음).

## 2. 현재 구조

`app-shell.tsx`: `<div className="min-h-screen lg:flex">` 안에 데스크톱 `<aside className="hidden w-64 shrink-0 ... lg:block lg:h-screen">`(고정 256px) + 모바일 상단바/드로어 + `<main className="mx-auto w-full max-w-6xl ...">`. `sidebar.tsx`가 로고 + `NAV` 링크(아이콘+라벨) + 하단(테마 토글·유저·로그아웃)을 렌더.

## 3. 동작

- **접힘/펼침 토글**: 데스크톱 `aside` 폭 `w-64`(펼침) ↔ `w-16`(접힘, 아이콘 레일). `main`은 `lg:flex`의 나머지 공간을 차지하므로 aside가 줄면 자동으로 넓어짐. `aside`에 `transition-[width] duration-200`으로 부드럽게.
- **접힘 시 Sidebar 표시 전환**(`collapsed` prop):
  - 로고: "DBFlow" 텍스트 → 컴팩트 마크 "DB"(가운데 정렬).
  - NAV 링크: `justify-center`, 라벨 `<span>` 숨김, 아이콘만. 접근성 위해 `title={label}` + `aria-label={label}`(네이티브 툴팁 + 스크린리더).
  - **하단(테마 토글·유저 정보·로그아웃)은 접힘 시 통째로 숨김**(critic B-1 — lazy). `ThemeToggle`은 3버튼 radiogroup이라 64px 레일에 안 맞고, 로그아웃/테마용 아이콘도 없음. 펼침 시에만 하단 노출 → 새 아이콘/컴팩트 변형 불필요. (접힌 상태에서 테마/로그아웃이 필요하면 사이드바를 펴면 됨.)
- **토글 버튼**: 사이드바 상단(로고 옆/아래)에 chevron 버튼. **`icons.tsx`에 `ChevronIcon` 신규 추가**(기존 Base 스타일; 접힘=오른쪽 »/펼침=왼쪽 « 방향 회전 또는 두 방향 아이콘). `aria-label="사이드바 접기"/"사이드바 펼치기"`, `aria-expanded={!collapsed}`. 클릭 시 상태 토글 + localStorage 저장.

## 4. 상태 · 영속성

- `app-shell.tsx`에 `const [collapsed, setCollapsed] = useState(false)`.
- **하이드레이션 안전**: SSR/초기 렌더는 항상 `false`(펼침)로 시작 → `useEffect`로 마운트 후 `localStorage['dbflow.sidebar.collapsed'] === '1'`을 읽어 반영(서버/클라 첫 렌더 불일치 방지). `window` 접근은 useEffect 안에서만(SSR 가드).
- **(critic B-3) 알려진 수용**: 접힘 선호 사용자는 매 로드 시 펼침→접힘 순간 깜빡임(FOUC)이 있고 `transition-[width]`로 애니메이션됨. 관리 도구 특성상 수용(pre-paint 인라인 스크립트는 과설계라 미도입).
- 토글 시 `localStorage.setItem('dbflow.sidebar.collapsed', next ? '1' : '0')`.
- `collapsed`·`onToggle`을 **데스크톱 `<Sidebar>`에만** 전달. 모바일 드로어의 `<Sidebar>`는 `collapsed={false}`(항상 풀 라벨) 유지.

## 5. 컴포넌트 인터페이스

- `Sidebar({ user, onNavigate?, collapsed?, onToggle? })` — `collapsed` 기본 false(모바일·미전달 시 기존 동작 그대로, 무회귀). `collapsed`에 따라 로고/링크/하단 렌더 분기 + `onToggle` 있을 때만 토글 버튼 노출(데스크톱).
- `app-shell.tsx`: 데스크톱 `aside` className을 `collapsed ? 'lg:w-16' : 'lg:w-64'`로 조건화(+ `transition-[width]`), `<Sidebar user collapsed={collapsed} onToggle={...} />`. **모바일 드로어의 `<Sidebar>`는 collapsed/onToggle 미전달**(항상 풀 라벨, 토글 버튼 없음) — 두 호출부가 분리돼 있어 무회귀.
- `icons.tsx`: `ChevronIcon` 신규(기존 아이콘 Base/stroke/viewBox 스타일 준수).

## 6. 접근성 · 반응성

- 토글 버튼 `aria-label`·`aria-expanded`. 접힘 링크의 접근명은 `aria-label`/`title`로 보존.
- 키보드 포커스 링(`focusable`) 유지. 모바일 미영향(lg 미만에선 aside 자체가 `hidden`).
- 다크/라이트 토큰 그대로.

## 7. 테스트

- 프론트 테스트 인프라 없음 → `tsc --noEmit` + `build` + 수동:
  - 펼침→접힘 토글 시 aside 폭·본문 확장, 아이콘 레일 + 툴팁.
  - 새로고침 후 상태 유지(localStorage).
  - 모바일 드로어 기존대로(풀 라벨).
- 체크리스트 §1(공통 셸)에 사이드바 접기 1줄 추가.

## 8. 비범위

- 모바일 사이드바 접기(드로어로 충분). 사이드바 폭 사용자 조절(드래그 리사이즈). 접힘 시 hover-확장(flyout) 서브메뉴 — 아이콘+툴팁으로 충분. 서버 저장(로컬 저장으로 충분).

## 9. 성공 기준

1. 데스크톱에서 토글 버튼으로 사이드바를 접으면 아이콘 레일이 되고 **본문 영역이 넓어진다**(critic B-2: `max-w-6xl` 상한 초과 넓은 화면에선 확보 공간만큼 재중앙정렬 — 본문 블록 자체가 6xl 상한까지만 넓어짐).
2. 접힌 상태에서 아이콘 hover 시 라벨 툴팁이 뜨고, 클릭하면 해당 페이지로 이동한다.
3. 새로고침·재접속 후에도 마지막 접힘/펼침 상태가 유지된다.
4. 모바일(lg 미만) 드로어는 기존대로 풀 라벨로 동작(무회귀).
5. 하이드레이션 경고 없이 렌더된다.
