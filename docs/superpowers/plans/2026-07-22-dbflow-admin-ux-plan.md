# 관리 UX 개선 구현 계획 (사용자 관리 페이징 + 사이드바 접기)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (A) `/users` 관리자 목록을 전 역할 + 서버 페이징 + 역할 필터 + 이름/이메일 검색으로 개선(현재 REVIEWER/APPROVER만 보이는 버그 해소), (B) 데스크톱 사이드바를 아이콘 레일로 접기/펴기(localStorage 기억).

**Specs:** `docs/superpowers/specs/2026-07-22-dbflow-user-management-pagination-design.md`(A), `docs/superpowers/specs/2026-07-22-dbflow-sidebar-collapse-design.md`(B).

**Tech Stack:** NestJS 10 + Prisma 5 + MySQL 8 / Next.js 14 App Router + Tailwind.

## Global Constraints

- 기존 `GET /users?role=X`(드롭다운, 배열 반환) 계약 **불변**(CR 생성·위임 페이지 사용).
- 신규 `GET /users/admin` ADMIN 전용(메서드 `@Roles(ADMIN)`), `{items,total,page,pageSize}`(pageSize=20), passwordHash 미노출.
- 사이드바 접기 데스크톱(lg+)만, 모바일 드로어 무회귀. 접힘 시 하단(테마·로그아웃) 숨김. localStorage 기억, SSR 가드.
- 백엔드 유닛 `new UsersService(mockPrisma, mockAudit)`(Nest TestingModule 금지). 프론트 tsc+build+수동.

---

### Task 1: 백엔드 — 관리자 사용자 목록 엔드포인트 (TDD)

**Files:**
- Create: `apps/api/src/users/dto/query-admin-users.dto.ts`
- Modify: `apps/api/src/users/users.service.ts` (import에 `Prisma` 추가 — 현재 `{ AuditAction, AuditTargetType, Role, User }`만 import) (+ `.spec.ts` **확장**)
- Modify: `apps/api/src/users/users.controller.ts`

**Interfaces:** Produces `UsersService.adminList(q)` → `{items,total,page,pageSize}`. 라우트 `GET /users/admin`(ADMIN).

- [ ] **Step 1: 실패 테스트 (기존 파일에 append)**

**⚠️ (critic Important#1) `apps/api/src/users/users.service.spec.ts`는 이미 존재하며 3개 테스트(create/listByRole/updateMe)가 있다. 절대 덮어쓰지 말 것.** 기존 `describe`는 그대로 두고, 아래 `describe('UsersService.adminList', ...)` **블록만 추가**한다(기존 mock 패턴 `new UsersService(prisma, audit as any)`와 동일):
```ts
// (파일 상단 import { UsersService } 는 이미 있음 — 추가 import 불필요)

function svc(overrides: any = {}) {
  const prisma: any = {
    user: {
      findMany: overrides.findMany ?? (() => Promise.resolve([])),
      count: overrides.count ?? (() => Promise.resolve(0)),
    },
  };
  return new UsersService(prisma, { record: () => Promise.resolve() } as any);
}

describe('UsersService.adminList', () => {
  it('applies role filter and name/email search to where, paginates', async () => {
    let args: any = null;
    const s = svc({
      findMany: (a: any) => { args = a; return Promise.resolve([{ id: 'u1' }]); },
      count: () => Promise.resolve(42),
    });
    const res = await s.adminList({ page: 2, role: 'DEVELOPER' as any, q: 'kim' });
    expect(args.where).toMatchObject({ role: 'DEVELOPER' });
    expect(args.where.OR).toEqual([{ name: { contains: 'kim' } }, { email: { contains: 'kim' } }]);
    expect(args.skip).toBe(20); // (page2-1)*20
    expect(args.take).toBe(20);
    expect(args.select.passwordHash).toBeUndefined(); // 노출 금지
    expect(res).toMatchObject({ total: 42, page: 2, pageSize: 20 });
  });

  it('defaults page to 1 and omits role/OR when not given', async () => {
    let args: any = null;
    const s = svc({ findMany: (a: any) => { args = a; return Promise.resolve([]); } });
    await s.adminList({});
    expect(args.skip).toBe(0);
    expect(args.where.role).toBeUndefined();
    expect(args.where.OR).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @dbflow/api test -- users.service` → FAIL.

- [ ] **Step 3: DTO + 서비스 구현**

`dto/query-admin-users.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Role } from '@prisma/client';

export class QueryAdminUsersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
```
`users.service.ts`에 `adminList`(import `Prisma`):
```ts
async adminList(q: { page?: number; role?: Role; q?: string }) {
  const pageSize = 20;
  const page = q.page && q.page > 0 ? q.page : 1;
  const where: Prisma.UserWhereInput = {
    ...(q.role ? { role: q.role } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q } }, { email: { contains: q.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    this.prisma.user.findMany({
      where,
      select: { id: true, email: true, name: true, department: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    this.prisma.user.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @dbflow/api test -- users.service` → PASS.

- [ ] **Step 5: 컨트롤러 라우트**

`users.controller.ts`에 추가(기존 `@Get()`/`@Get('me')` 사이/뒤, import `QueryAdminUsersDto`):
```ts
@Get('admin')
@Roles(Role.ADMIN)
adminList(@Query() q: QueryAdminUsersDto) {
  return this.users.adminList(q);
}
```

- [ ] **Step 6: 빌드 + Commit**

`pnpm --filter @dbflow/api test && pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/users
git commit -m "feat(api): admin user list endpoint with pagination, role filter, name/email search"
```

---

### Task 2: 프론트 — /users 페이징·필터·검색 (전 역할)

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/(app)/users/page.tsx`

**Interfaces:** Consumes `GET /users/admin`(Task 1).

- [ ] **Step 1: api 클라이언트**

`lib/api.ts`(기존 `Role` 재사용):
```ts
export type AdminUser = { id: string; email: string; name: string; department: string; role: Role; createdAt: string };
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
export function adminListUsers(params: { page?: number; role?: Role | ''; q?: string }) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.role) qs.set('role', params.role);          // ''(전체)면 미전송 → @IsEnum 400 회피
  if (params.q && params.q.trim()) qs.set('q', params.q.trim());
  return apiFetch<Paginated<AdminUser>>(`/users/admin?${qs.toString()}`);
}
```

- [ ] **Step 2: 페이지 재작성**

`app/(app)/users/page.tsx` — 기존 `LISTABLE_ROLES` 루프·`ListedUser`·`listUsersByRole`/`UserSummary` import 제거, `createUser`(폼용)는 **유지**, `adminListUsers`/`AdminUser` import 추가, `import { formatDateTime } from '@/lib/format';` 추가(critic Minor1/3). audit 페이지의 페이징 컨트롤(총 N건·page/totalPages·이전/다음 disabled, audit/page.tsx ~242–264) 패턴 재사용:
- 상태: `role: Role | ''`(기본 ''), `q: string`(입력), `page`(기본 1), `result: Paginated<AdminUser> | null`.
- **(critic Important#2) 단일 effect 패턴**(audit는 "적용 버튼"이라 디바운스 템플릿은 없음 — 아래대로 직접):
  - `const [debouncedQ, setDebouncedQ] = useState('')`. 디바운스 effect: `useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t); }, [q])`.
  - stale 가드: `const seqRef = useRef(0)`. `const load = useCallback((p, r, query) => { const my = ++seqRef.current; adminListUsers({ page: p, role: r, q: query }).then((res) => { if (my === seqRef.current) setResult(res); }).catch((e) => setError(e.message)); }, [])`.
  - **로드 effect 1개**: `useEffect(() => { if (user?.role === 'ADMIN') load(page, role, debouncedQ); }, [page, role, debouncedQ, load, user])`.
  - **page 리셋은 onChange 핸들러에서**(effect 아님): 역할 select `onChange`와 검색 input `onChange`에서 각각 `setPage(1)` 호출(값 setState와 함께). → q 변경 시 page 리셋 + 디바운스 후 1회 로드(이중 페치·리셋 레이스 없음).
- 상단: 역할 `<select>`(전체/DEVELOPER/REVIEWER/APPROVER/ADMIN, `ROLE_LABEL`) + 검색 `<input value={q}>` (기존 `inputClass` 재사용).
- 목록 항목: 이름 · **이메일**(`text-sm text-muted`) · 부서 · 역할 뱃지 · 가입일(`formatDateTime(u.createdAt)`).
- 하단: `총 {result.total}건 · {result.page}/{totalPages} 페이지` + 이전/다음(`totalPages=Math.max(1,Math.ceil(total/pageSize))`, `page<=1`/`page>=totalPages` disabled).
- 사용자 생성 성공 시 현재 `page/role/debouncedQ`로 재조회(`load(page, role, debouncedQ)`) — `UserForm`의 `onSubmit`이 `createUser` 후 이 load를 호출.
- 로딩/빈/에러 상태 기존 패턴 유지.

- [ ] **Step 3: tsc + build + Commit**

`pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
```bash
git add apps/web/lib/api.ts "apps/web/app/(app)/users/page.tsx"
git commit -m "feat(web): user management all-roles list with pagination, role filter, debounced search"
```

---

### Task 3: 프론트 — 사이드바 접기/펴기 (아이콘 레일)

**Files:**
- Modify: `apps/web/components/icons.tsx` (`ChevronIcon` 추가)
- Modify: `apps/web/components/sidebar.tsx` (`collapsed`/`onToggle` prop)
- Modify: `apps/web/components/app-shell.tsx` (상태·localStorage·aside 폭)

**Interfaces:** 순수 프론트, 백엔드 무관.

- [ ] **Step 1: ChevronIcon**

`icons.tsx`에 기존 아이콘 스타일(같은 `Base`/`SVGProps`/stroke/viewBox)로 `ChevronIcon` 추가(왼쪽 chevron `‹` 형태; 접힘 시 CSS로 180° 회전해 방향 표현).

- [ ] **Step 2: Sidebar collapsed 분기**

`sidebar.tsx` — `Sidebar({ user, onNavigate, collapsed = false, onToggle })`:
- 상단 로고 영역: 현재 `<div className="px-5 py-5">`. **접힘 시 패딩 축소**(critic Minor2 — 64px 레일에 `px-5`는 과함): `collapsed ? 'px-2 py-4 flex justify-center' : 'px-5 py-5'`. `onToggle` 있으면(데스크톱) chevron 토글 버튼 노출(`aria-label={collapsed?'사이드바 펼치기':'사이드바 접기'}`, `aria-expanded={!collapsed}`, 클릭 `onToggle`). 로고 텍스트는 `collapsed ? 'DB' : 'DBFlow'`. (접힘 시 "DB" 마크 + 토글 버튼을 세로 배치하거나 토글만 노출 — 44px 폭 안에 맞게.)
- NAV 링크: `collapsed`면 `justify-center`, 라벨 `<span>` 미렌더, `<Link>`에 `title={it.label}` + `aria-label={it.label}`. 아니면 기존(아이콘+라벨).
- 하단(테마·유저·로그아웃 블록): `collapsed`면 통째로 미렌더. 아니면 기존.
- 기존 `onNavigate`(모바일 링크 클릭 닫기) 유지.

- [ ] **Step 3: AppShell 상태·영속·폭**

`app-shell.tsx`:
- `const [collapsed, setCollapsed] = useState(false);`
- `useEffect(() => { setCollapsed(localStorage.getItem('dbflow.sidebar.collapsed') === '1'); }, []);` (마운트 후 1회, SSR 가드 자동)
- `const toggle = () => setCollapsed((c) => { const n = !c; localStorage.setItem('dbflow.sidebar.collapsed', n ? '1' : '0'); return n; });`
- 데스크톱 `<aside>` className: `hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 lg:sticky lg:top-0 lg:block lg:h-screen ${collapsed ? 'lg:w-16' : 'lg:w-64'}`.
- 데스크톱 `<Sidebar user={user} collapsed={collapsed} onToggle={toggle} />`. **모바일 드로어의 `<Sidebar>`는 collapsed/onToggle 미전달**(기존 그대로).

- [ ] **Step 4: tsc + build + Commit**

`pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
```bash
git add apps/web/components/icons.tsx apps/web/components/sidebar.tsx apps/web/components/app-shell.tsx
git commit -m "feat(web): collapsible desktop sidebar (icon rail) with persisted state"
```

---

### Task 4: 통합 검증 + 체크리스트

**Files:** `docs/feature-checklist.md`.

- [ ] **Step 1: 자동** — `pnpm --filter @dbflow/api test`(전체 GREEN) + `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`.
- [ ] **Step 2: 라이브 스모크**(API 재기동 `lsof -ti tcp:3001|xargs -r kill -9; ./start.sh --no-install`, admin 로그인):
  - `GET /users/admin`(admin 토큰) → 전 역할 포함 items + total. `?role=DEVELOPER` 필터, `?q=dev` 검색, `?page=2` 동작. 비-ADMIN(dev 토큰) → 403. 기존 `GET /users?role=REVIEWER` 배열 반환 무회귀.
  - (UI 수동은 사용자 몫 — 사이드바 접기·검색·페이징은 브라우저 확인 항목으로 체크리스트에 기재.)
- [ ] **Step 3: 체크리스트 갱신**

`docs/feature-checklist.md`:
- **§7 사용자 관리** 항목 갱신: "목록에 **전 역할** 표시 · 역할 필터 · 이름/이메일 검색 · 페이지네이션(20/페이지) · 비ADMIN `/users/admin` 403".
- **§1 인증/공통 셸/테마**에 1줄: "데스크톱 사이드바 접기/펴기(아이콘 레일) · 새로고침 후 상태 유지 · 접으면 본문 넓어짐".
```bash
git add docs/feature-checklist.md
git commit -m "docs: update checklist for user management pagination + sidebar collapse"
```

---

## Self-Review (작성자 확인 완료)

- **스펙 커버리지**: A §3 엔드포인트→T1, A §4 프론트→T2, B §3~5 사이드바→T3, 성공기준→T4. 전 항목 매핑.
- **타입 일관성**: `Paginated<T>`/`AdminUser`(T2)↔`adminList` 반환(T1). `Sidebar` prop `collapsed?/onToggle?` 기본값으로 모바일·기존 호출 무회귀(T3).
- **critic 반영**: A-1 collation(스펙 정정)·A-2 stale 가드(T2 Step2)·A-3/A-4 문구(스펙)·B-1 하단 숨김+ChevronIcon(T3)·B-2/B-3 문구(스펙).
- **주의**: T2는 audit **페이징 컨트롤**만 재사용(디바운스는 없음 — 단일 effect 패턴 직접). T1 spec.ts는 **append**(3개 기존 테스트 보존). `GET /users?role=` 드롭다운 계약·`api.ts`의 `listUsersByRole` 절대 변경 금지. T3 접힘 헤더 패딩 축소, ChevronIcon 기존 스타일.
