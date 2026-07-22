# 사용자 관리 — 전체 목록 + 서버 페이징 + 필터/검색 설계

> 2026-07-22. 버그 수정 + 기능. 관리 UX 개선 슬라이스 A(사이드바 접기는 별도 스펙 B).

## 1. 문제

`/users`(사용자 관리) 페이지가 목록을 `LISTABLE_ROLES = ['REVIEWER','APPROVER']`로만 조회해 **DEVELOPER·ADMIN 사용자가 아예 안 보인다**(현재 4명만 표시). 백엔드 `GET /users?role=X`의 `listByRole`은 드롭다운(검토자/결재자 선택)용이라 그대로 두어야 한다(CR 생성·위임 페이지가 사용).

## 2. 목표

관리자 목록에 **전 역할 사용자**를 보이고, **서버 페이징 + 역할 필터 + 이름/이메일 검색**을 제공한다.

- 사용자 확정: 서버 페이징 / 역할 필터 + 이름·이메일 검색 / 전 역할 표시.
- 기존 `GET /users?role=X`(드롭다운, 배열 반환) 계약 **불변**.

## 3. 백엔드 — 신규 관리자 목록 엔드포인트

`GET /users/admin` (ADMIN 전용, 메서드 레벨 `@Roles(Role.ADMIN)`) — 감사 로그(`/audit-logs`)의 `{ items, total, page, pageSize }` 패턴 준용.

- 컨트롤러(`users.controller.ts`): 기존 `@Get()`(=`GET /users`, role 드롭다운)·`@Get('me')`와 **경로가 다른 정적 경로**(`GET /users/admin`)라 충돌 없음(critic A-3 — 우선순위가 아니라 별개 경로). `:id` 파라미터 라우트가 없어 순서 무관.
  ```ts
  @Get('admin')
  @Roles(Role.ADMIN)
  adminList(@Query() q: QueryAdminUsersDto) {
    return this.users.adminList(q);
  }
  ```
- DTO(`dto/query-admin-users.dto.ts`):
  ```ts
  export class QueryAdminUsersDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
    @IsOptional() @IsEnum(Role) role?: Role;
    @IsOptional() @IsString() @MaxLength(100) q?: string;
  }
  ```
- 서비스(`users.service.ts` `adminList`):
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
  - `User` 테이블 콜레이션은 `utf8mb4_unicode_ci`(critic A-1, 초기 마이그레이션 확인) — `_ci`라 `contains` 부분검색이 대소문자 구분 없이 동작(별도 mode 불필요).
  - `passwordHash`는 select에서 제외(노출 금지).

## 4. 프론트 — `/users` 페이지

- `lib/api.ts`:
  ```ts
  export type AdminUser = { id: string; email: string; name: string; department: string; role: Role; createdAt: string };
  export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
  export function adminListUsers(params: { page?: number; role?: Role | ''; q?: string }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.role) qs.set('role', params.role);
    if (params.q && params.q.trim()) qs.set('q', params.q.trim());
    return apiFetch<Paginated<AdminUser>>(`/users/admin?${qs.toString()}`);
  }
  ```
- `app/(app)/users/page.tsx`:
  - 기존 `LISTABLE_ROLES` 루프 제거 → `adminListUsers({ page, role, q })` 사용. **개발자·관리자 포함 전 역할 표시.**
  - 상태: `page`(기본 1), `role`(''=전체 또는 4역할), `q`(검색어). `role`/`q` 변경 시 `page`를 1로 리셋. `role`이 ''(전체)일 땐 API에 role 미전송(critic A-4 — 빈 문자열 보내면 `@IsEnum` 400; `adminListUsers`가 truthy일 때만 set하므로 UI에선 발생 안 함, 명시).
  - **(critic A-2) stale 응답 가드**: 디바운스 검색은 요청 순서 역전으로 오래된 응답이 나중에 그려질 수 있다 → `useRef` 요청 시퀀스 번호로 **latest-wins**(응답 도착 시 자기 seq가 최신일 때만 `setState`). 또는 `useEffect` 클린업으로 취소 플래그.
  - 상단 컨트롤: 역할 필터 `<select>`(전체/DEVELOPER/REVIEWER/APPROVER/ADMIN, `ROLE_LABEL` 라벨) + 이름·이메일 검색 `<input>`(**~300ms 디바운스**, 기존 페이지 토큰 재사용).
  - 목록 항목: 이름 · **이메일**(관리자에 필요) · 부서 · 역할 뱃지 · 가입일(`formatDateTime(createdAt)`).
  - 하단 페이지네이션: "이전 / {page} · 총 {total}건 / 다음". `page<=1`이면 이전 비활성, `page*pageSize>=total`이면 다음 비활성. `totalPages = Math.ceil(total/pageSize)`.
  - 로딩/빈 목록/에러 상태는 기존 페이지 패턴 재사용. 사용자 생성 성공 후 현재 필터·페이지로 재조회.

## 5. 테스트

- **백엔드 유닛**(`users.service.spec.ts`, `new UsersService(mockPrisma, mockAudit)`): 역할 필터 where, `q` → `OR:[name contains, email contains]` where, 페이징(skip/take·page 기본값 1·total 반환), passwordHash 미노출(select 확인).
- **API**: ADMIN만 200, 비-ADMIN 403(메서드 가드), DTO 검증(page<1·잘못된 role).
- 프론트: tsc + build + 수동. 체크리스트 §7(사용자 관리) 갱신.

## 6. 비범위

- 사용자 **수정/삭제/역할 변경**(현재 생성만 지원 — 별도 기능). 정렬 컬럼 선택(생성일 최신순 고정). 커서 기반 페이징(오프셋으로 충분). CSV 내보내기.

## 7. 성공 기준

1. 관리자 `/users`에서 **개발자·관리자 포함 전 역할** 사용자가 보인다(현재 누락 버그 해소).
2. 역할 필터로 특정 역할만, 검색으로 이름/이메일 부분일치 조회된다.
3. 20명 초과 시 이전/다음으로 페이지 이동, 총 건수 표시.
4. 필터/검색 변경 시 1페이지로 리셋된다.
5. 비-ADMIN은 `/users/admin` 403. 기존 CR 생성·위임의 역할 드롭다운(`GET /users?role=`)은 그대로 동작(무회귀).
6. 응답에 passwordHash가 없다.
