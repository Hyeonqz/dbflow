# 지정 검토/결재 · 프로필 · 관리자 (스펙 1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 변경요청마다 검토자·결재자를 지정하고 지정된 사람만 검토/결재하게 하며, 계정에 부서를 부여하고 관리자(ADMIN)가 계정을 생성한다.

**Architecture:** 백엔드는 Prisma 스키마에 `ADMIN` 역할·`User.department`·`ChangeRequest.reviewerId/approverId`(3중 named relation)를 추가하고, change-request 서비스의 권한 게이트·가시성을 "지정 기반"으로 바꾼다. 신설 `UsersModule`이 계정 생성·프로필 API를 제공한다. 프론트는 `Role` 유니온에 ADMIN을 추가하고 `useCurrentUser`를 Context로 승격, 생성 폼에 지정 드롭다운, 관리자 사용자 페이지, KPI/필터를 지정 기반으로 재작성한다.

**Tech Stack:** NestJS 10, Prisma 5 (MySQL), class-validator, Jest(백엔드 단위테스트: 생성자 주입 + mock prisma), Next.js 14 App Router, Tailwind. 프론트는 테스트 인프라가 없으므로 `tsc --noEmit` + 빌드 + 수동 확인으로 검증.

**참조 스펙:** `docs/superpowers/specs/2026-07-17-dbflow-assignments-profiles-telegram-design.md` (스펙 1 = §4)

## Global Constraints

- 백엔드 단위테스트는 기존 패턴을 따른다: Nest `TestingModule` 없이 서비스를 `new Service(mockPrisma)`로 직접 생성(예 `apps/api/src/users/users.service.spec.ts`). 테스트 실행: `pnpm --filter @dbflow/api test`.
- 새 런타임 의존성 추가 금지(Node 22 전역 fetch 사용). 프론트 새 라이브러리 금지.
- 프론트 시맨틱 토큰만 사용(`bg-card`,`ring-border`,`ring-border-strong`,`text-ink`,`text-muted`,`bg-primary` 등). 신규 색 금지.
- 커밋은 각 Task 끝에서. 커밋 메시지 말미에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 마이그레이션은 `pnpm --filter @dbflow/api exec prisma migrate dev --name <name>`로 생성.
- `ADMIN`을 `Role`에 넣으면 프론트 `Record<Role,…>` 4곳이 tsc로 깨진다 → 반드시 Task 8에서 함께 갱신.

---

### Task 1: 스키마 · 마이그레이션 · seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_assignments_profiles_admin/migration.sql` (prisma가 생성)
- Modify: `apps/api/prisma/seed.ts`

**Interfaces:**
- Produces: `Role.ADMIN`, `User.department: string`, `User.telegramChatId: string | null`, `ChangeRequest.reviewerId/approverId: string | null`, named relations `author`/`reviewer`/`approver`.

- [ ] **Step 1: `Role` enum에 ADMIN 추가**

`apps/api/prisma/schema.prisma`:
```prisma
enum Role {
  DEVELOPER
  REVIEWER
  APPROVER
  ADMIN
}
```

- [ ] **Step 2: `User` 모델에 department·telegramChatId·관계 3분화**

기존 `changeRequests ChangeRequest[]` 한 줄을 아래로 교체하고 `department`/`telegramChatId` 추가:
```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  department   String
  passwordHash String
  role         Role
  telegramChatId String?
  createdAt    DateTime @default(now())

  changeRequests    ChangeRequest[] @relation("author")
  reviewingRequests ChangeRequest[] @relation("reviewer")
  approvingRequests ChangeRequest[] @relation("approver")
  statusHistories   StatusHistory[]
  executions        Execution[]
}
```

- [ ] **Step 3: `ChangeRequest`에 reviewerId·approverId·관계 추가**

기존 `author User @relation(fields: [authorId], references: [id])` 한 줄을 아래로 교체하고 필드/인덱스 추가:
```prisma
model ChangeRequest {
  id          String              @id @default(cuid())
  title       String
  description String
  targetEnv   TargetEnv
  status      ChangeRequestStatus @default(DRAFT)
  authorId    String
  reviewerId  String?
  approverId  String?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  author        User                @relation("author",   fields: [authorId],   references: [id])
  reviewer      User?               @relation("reviewer", fields: [reviewerId], references: [id])
  approver      User?               @relation("approver", fields: [approverId], references: [id])
  files         ChangeRequestFile[]
  statusHistory StatusHistory[]
  executions    Execution[]
  backups       Backup[]

  @@index([authorId])
  @@index([status])
  @@index([reviewerId])
  @@index([approverId])
}
```

- [ ] **Step 4: 마이그레이션 생성**

Run: `pnpm --filter @dbflow/api exec prisma migrate dev --name assignments_profiles_admin`
Expected: 마이그레이션 파일 생성 + 적용 성공. `department`가 NOT NULL 신규 컬럼이라 기존 행이 있으면 prisma가 기본값을 물어볼 수 있다 → **기존 데이터가 없다는 전제**(seed 유저만). 만약 실패하면, 마이그레이션 SQL에서 `ADD COLUMN department VARCHAR(191) NOT NULL DEFAULT '미지정'` 후 `ALTER ... DROP DEFAULT`로 수정.

- [ ] **Step 5: seed에 department + admin 계정 추가**

`apps/api/prisma/seed.ts`의 `users` 배열과 create를 교체:
```ts
const users = [
  { email: 'dev@dbflow.io', name: '개발자', department: '개발팀', role: 'DEVELOPER' as const },
  { email: 'dba@dbflow.io', name: '검토자', department: 'DBA팀', role: 'REVIEWER' as const },
  { email: 'approver@dbflow.io', name: '결재자', department: '인프라팀', role: 'APPROVER' as const },
  { email: 'admin@dbflow.io', name: '관리자', department: '운영팀', role: 'ADMIN' as const },
];
for (const u of users) {
  await prisma.user.upsert({
    where: { email: u.email },
    update: { department: u.department, role: u.role },
    create: { ...u, passwordHash: await argon2.hash('password1234') },
  });
}
```

- [ ] **Step 6: 클라이언트 재생성 + seed 실행**

Run: `pnpm --filter @dbflow/api exec prisma generate && pnpm --filter @dbflow/api exec prisma db seed`
Expected: 🌱 seed 성공, admin 계정 포함 4명.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): add ADMIN role, user.department, CR reviewer/approver assignment schema"
```

---

### Task 2: UsersModule 신설 — 계정 생성 · 프로필 API

**Files:**
- Modify: `apps/api/src/users/users.service.ts`
- Create: `apps/api/src/users/users.controller.ts`
- Create: `apps/api/src/users/users.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/users/dto/create-user.dto.ts`
- Create: `apps/api/src/users/dto/update-me.dto.ts`
- Modify: `apps/api/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `Role.ADMIN` (Task 1), `RolesGuard`/`Roles`/`CurrentUser` (기존 `src/auth`).
- Produces: `UsersService.create({email,name,department,password,role})`, `UsersService.listByRole(role)`, `UsersService.updateMe(id, {name?,department?,telegramChatId?})`, `UsersService.profile(id)`. 라우트: `POST /users`(ADMIN), `GET /users?role=`, `GET /users/me`, `PATCH /users/me`.

- [ ] **Step 1: `UsersService`에 department + 신규 메서드 (실패 테스트 먼저)**

`apps/api/src/users/users.service.spec.ts`에 추가:
```ts
it('lists users by role with minimal fields', async () => {
  const prisma: any = {
    user: { findMany: ({ where, select }: any) => Promise.resolve([{ id: '1', name: 'A', department: 'DBA팀' }]) },
  };
  const service = new UsersService(prisma);
  const rows = await service.listByRole('REVIEWER' as any);
  expect(rows[0]).toEqual({ id: '1', name: 'A', department: 'DBA팀' });
});

it('updates own profile fields', async () => {
  let updated: any = null;
  const prisma: any = {
    user: { update: ({ where, data }: any) => { updated = { where, data }; return Promise.resolve({ id: where.id, ...data }); } },
  };
  const service = new UsersService(prisma);
  await service.updateMe('u1', { department: 'IT본부' });
  expect(updated).toEqual({ where: { id: 'u1' }, data: { department: 'IT본부' } });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @dbflow/api test -- users.service`
Expected: FAIL (listByRole/updateMe 미정의)

- [ ] **Step 3: `UsersService` 구현 갱신**

`apps/api/src/users/users.service.ts`를 아래로 교체(기존 메서드 유지 + department·신규):
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { Role, User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(input: {
    email: string; name: string; department: string; password: string; role: Role;
  }): Promise<User> {
    const passwordHash = await hashPassword(input.password);
    return this.prisma.user.create({
      data: {
        email: input.email, name: input.name, department: input.department,
        role: input.role, passwordHash,
      },
    });
  }

  listByRole(role: Role) {
    return this.prisma.user.findMany({
      where: { role },
      select: { id: true, name: true, department: true },
      orderBy: { name: 'asc' },
    });
  }

  async profile(id: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return {
      id: u.id, email: u.email, name: u.name, department: u.department,
      role: u.role, telegramLinked: !!u.telegramChatId,
    };
  }

  updateMe(id: string, data: { name?: string; department?: string; telegramChatId?: string }) {
    return this.prisma.user.update({ where: { id }, data });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test -- users.service`
Expected: PASS

- [ ] **Step 5: DTO 2개 생성**

`apps/api/src/users/dto/create-user.dto.ts`:
```ts
import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) department!: string;
  @IsString() @MinLength(8) @MaxLength(72) password!: string;
  @IsEnum(Role) role!: Role;
}
```

`apps/api/src/users/dto/update-me.dto.ts`:
```ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @IsString() @MaxLength(50) department?: string;
  @IsOptional() @IsString() @MaxLength(64) telegramChatId?: string;
}
```

- [ ] **Step 6: `UsersController` 생성**

`apps/api/src/users/users.controller.ts`:
```ts
import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreateUserDto) {
    const u = await this.users.create(dto);
    return { id: u.id, email: u.email, name: u.name, department: u.department, role: u.role };
  }

  @Get()
  list(@Query('role') role?: Role) {
    return role ? this.users.listByRole(role) : [];
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.users.profile(user.userId);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.userId, dto);
  }
}
```

- [ ] **Step 7: `UsersModule` 생성 + AppModule 등록**

`apps/api/src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [PassportModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaService],
  exports: [UsersService],
})
export class UsersModule {}
```

`apps/api/src/app.module.ts`의 imports 배열에 `UsersModule` 추가(import 문도):
```ts
import { UsersModule } from './users/users.module';
// imports: [ AuthModule, UsersModule, ChangeRequestModule, ... ]
```

- [ ] **Step 8: 빌드 + 라우트 확인**

Run: `pnpm --filter @dbflow/api build`
Expected: 컴파일 성공. (수동: 로그인 후 `GET /users?role=REVIEWER` 200)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/users apps/api/src/app.module.ts
git commit -m "feat(api): UsersModule with admin user creation and profile endpoints"
```

---

### Task 3: 로그인 응답에 department 포함

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`

**Interfaces:**
- Produces: `/auth/login` 응답 `user`에 `department` 추가.

- [ ] **Step 1: `validateAndLogin` 반환 user에 department 추가**

`apps/api/src/auth/auth.service.ts`의 return을 교체:
```ts
    return {
      accessToken,
      user: {
        id: user.id, email: user.email, name: user.name,
        department: user.department, role: user.role,
      },
    };
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm --filter @dbflow/api build`
Expected: 성공.

- [ ] **Step 3: 수동 확인**

Run: `curl -s -X POST http://localhost:3001/auth/login -H 'Content-Type: application/json' -d '{"email":"dba@dbflow.io","password":"password1234"}'`
Expected: 응답 `user.department == "DBA팀"`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/auth.service.ts
git commit -m "feat(api): include department in login response"
```

---

### Task 4: CR 생성/제출/게이트 — 지정 반영

**Files:**
- Modify: `apps/api/src/change-request/dto/create-change-request.dto.ts`
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Create: `apps/api/src/change-request/change-request.service.spec.ts` (없으면 생성)

**Interfaces:**
- Consumes: `ChangeRequest.reviewerId/approverId` (Task 1), `AuthUser` (기존).
- Produces: `create`가 reviewerId/approverId 저장. `submit`이 미지정 시 400. `review`/`approve`가 지정자 검증(403).

- [ ] **Step 1: DTO에 reviewerId·approverId (선택) 추가**

`create-change-request.dto.ts`의 `CreateChangeRequestDto`에 필드 추가:
```ts
  @IsOptional()
  @IsString()
  reviewerId?: string;

  @IsOptional()
  @IsString()
  approverId?: string;
```
상단 import에 `IsOptional` 추가.

- [ ] **Step 2: 게이트 실패 테스트 작성**

`apps/api/src/change-request/change-request.service.spec.ts` 생성:
```ts
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ChangeRequestService } from './change-request.service';

function svc(cr: any) {
  const prisma: any = {
    changeRequest: { findUnique: () => Promise.resolve(cr) },
  };
  return new ChangeRequestService(prisma);
}

describe('ChangeRequestService assignment gates', () => {
  it('rejects review by a non-assigned reviewer', async () => {
    const service = svc({ id: 'c1', status: 'SUBMITTED', authorId: 'a', reviewerId: 'r1', approverId: 'p1' });
    await expect(
      service.review('someone-else', 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects approve by a non-assigned approver', async () => {
    const service = svc({ id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a', reviewerId: 'r1', approverId: 'p1' });
    await expect(
      service.approve('someone-else', 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects submit when reviewer/approver unassigned', async () => {
    const service = svc({ id: 'c1', status: 'DRAFT', authorId: 'a', reviewerId: null, approverId: null });
    await expect(service.submit('a', 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @dbflow/api test -- change-request.service`
Expected: FAIL (게이트 미구현, submit이 400 안 냄)

- [ ] **Step 4: `getOrThrow` select 확장**

`change-request.service.ts`의 `getOrThrow` select에 reviewerId/approverId 추가:
```ts
      select: { id: true, status: true, authorId: true, reviewerId: true, approverId: true },
```

- [ ] **Step 5: `create`에 지정 저장**

`create`의 `data`에 추가:
```ts
        authorId,
        reviewerId: dto.reviewerId ?? null,
        approverId: dto.approverId ?? null,
```

- [ ] **Step 6: `submit` 미지정 검증**

`submit`의 authorId 체크 뒤에 추가(상단 import에 `BadRequestException`):
```ts
    if (!changeRequest.reviewerId || !changeRequest.approverId) {
      throw new BadRequestException('제출 전에 검토자와 결재자를 지정해야 합니다.');
    }
```

- [ ] **Step 7: `review`/`approve` 지정자 게이트**

`review` 시작에:
```ts
    const changeRequest = await this.getOrThrow(id);
    if (changeRequest.reviewerId !== actorId) {
      throw new ForbiddenException('지정된 검토자만 검토할 수 있습니다.');
    }
```
`approve` 시작에:
```ts
    const changeRequest = await this.getOrThrow(id);
    if (changeRequest.approverId !== actorId) {
      throw new ForbiddenException('지정된 결재자만 결재할 수 있습니다.');
    }
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test -- change-request.service`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/change-request
git commit -m "feat(api): assign reviewer/approver on create, gate review/approve to assignees"
```

---

### Task 5: 가시성 재작성 · 지정자 재지정

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Modify: `apps/api/src/change-request/change-request.controller.ts`
- Create: `apps/api/src/change-request/dto/assignees.dto.ts`
- Modify: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:**
- Produces: `visibilityWhere` 지정 기반. `setAssignees(user, id, {reviewerId, approverId})` — DRAFT는 작성자, 그 외 ADMIN. 라우트 `PATCH /change-requests/:id/assignees`.
- Consumes: `SUMMARY_SELECT`에 reviewerId/approverId 노출 필요.

- [ ] **Step 1: 가시성 재작성 (스펙 §4.2 표)**

`visibilityWhere`를 교체:
```ts
  private visibilityWhere(user: AuthUser): Prisma.ChangeRequestWhereInput {
    switch (user.role) {
      case Role.DEVELOPER:
        return { authorId: user.userId };
      case Role.REVIEWER:
        return { reviewerId: user.userId, status: { not: ChangeRequestStatus.DRAFT } };
      case Role.APPROVER:
        return { approverId: user.userId, status: { not: ChangeRequestStatus.DRAFT } };
      default:
        // ADMIN 및 미지정 역할은 목록에서 아무것도 못 봄(관리자는 /users 사용).
        return { id: { equals: '' } };
    }
  }
```

- [ ] **Step 2: SUMMARY/DETAIL에 지정자 노출**

`SUMMARY_SELECT`에 추가:
```ts
  reviewerId: true,
  approverId: true,
  reviewer: { select: { name: true, department: true } },
  approver: { select: { name: true, department: true } },
```
`toSummary`에서 reviewer/approver를 평탄화(이름 노출):
```ts
  private toSummary(row: SummaryPayload) {
    const { author, reviewer, approver, ...rest } = row;
    return {
      ...rest,
      authorName: author?.name ?? null,
      reviewerName: reviewer?.name ?? null,
      approverName: approver?.name ?? null,
    };
  }
```
`DETAIL_INCLUDE`에도 `reviewer: { select: { name: true, department: true } }, approver: { select: { name: true, department: true } }` 추가하고 `toDetail`에서 동일하게 평탄화.

- [ ] **Step 3: 재지정 실패 테스트**

`change-request.service.spec.ts`에 추가:
```ts
it('lets author reassign only while DRAFT', async () => {
  const cr = { id: 'c1', status: 'SUBMITTED', authorId: 'a', reviewerId: 'r1', approverId: 'p1' };
  const service = svc(cr);
  await expect(
    service.setAssignees({ userId: 'a', role: 'DEVELOPER' } as any, 'c1', { reviewerId: 'r2' }),
  ).rejects.toBeTruthy(); // 제출됨 + 작성자 → 불가(ADMIN만)
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm --filter @dbflow/api test -- change-request.service`
Expected: FAIL (setAssignees 미정의)

- [ ] **Step 5: `setAssignees` 구현**

`change-request.service.ts`에 메서드 추가(상단 import에 `BadRequestException` 이미 있음):
```ts
  async setAssignees(
    user: AuthUser,
    id: string,
    dto: { reviewerId?: string; approverId?: string },
  ) {
    const cr = await this.getOrThrow(id);
    const isDraft = cr.status === ChangeRequestStatus.DRAFT;
    const allowed =
      (isDraft && cr.authorId === user.userId) || user.role === Role.ADMIN;
    if (!allowed) {
      throw new ForbiddenException(
        'DRAFT 상태에서는 작성자만, 제출 후에는 관리자만 지정을 변경할 수 있습니다.',
      );
    }
    await this.prisma.changeRequest.update({
      where: { id },
      data: {
        ...(dto.reviewerId !== undefined ? { reviewerId: dto.reviewerId } : {}),
        ...(dto.approverId !== undefined ? { approverId: dto.approverId } : {}),
      },
    });
    return this.findOne({ userId: cr.authorId, role: Role.DEVELOPER }, id);
  }
```
참고: 반환은 상세를 다시 읽되, ADMIN이 호출한 경우 ADMIN 가시성으로는 안 보이므로 작성자 컨텍스트로 조회한다(위처럼 authorId 사용).

- [ ] **Step 6: DTO + 라우트 추가**

`apps/api/src/change-request/dto/assignees.dto.ts`:
```ts
import { IsOptional, IsString } from 'class-validator';

export class AssigneesDto {
  @IsOptional() @IsString() reviewerId?: string;
  @IsOptional() @IsString() approverId?: string;
}
```
`change-request.controller.ts`에 라우트 추가(import: `Patch`, `AssigneesDto`). 역할 게이트는 서비스에서 처리하므로 컨트롤러엔 `@Roles` 없이(로그인만):
```ts
  @Patch(':id/assignees')
  setAssignees(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AssigneesDto,
  ) {
    return this.service.setAssignees(user, id, dto);
  }
```

- [ ] **Step 7: 테스트 통과 + 빌드**

Run: `pnpm --filter @dbflow/api test -- change-request.service && pnpm --filter @dbflow/api build`
Expected: PASS + 컴파일 성공.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/change-request
git commit -m "feat(api): assignment-based visibility and reassignment endpoint"
```

---

### Task 6: 프론트 — Role/ADMIN + UserProvider Context

**Files:**
- Modify: `apps/web/lib/auth.ts`
- Create: `apps/web/components/user-context.tsx`
- Modify: `apps/web/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `User.department: string`, `Role`에 `'ADMIN'`, `ROLE_LABEL.ADMIN`, `UserProvider`/`useUser()` → `{user, setUser, ready}`.

- [ ] **Step 1: `lib/auth.ts` — Role·User·ROLE_LABEL 갱신**

`Role` 유니온과 `User` 타입, `ROLE_LABEL` 교체:
```ts
export type Role = 'DEVELOPER' | 'REVIEWER' | 'APPROVER' | 'ADMIN';

export type User = {
  id: string; email: string; name: string; department: string; role: Role;
};

export const ROLE_LABEL: Record<Role, string> = {
  DEVELOPER: '개발자',
  REVIEWER: '검토자(DBA)',
  APPROVER: '결재자',
  ADMIN: '관리자',
};
```

- [ ] **Step 2: `UserProvider` Context 생성**

`apps/web/components/user-context.tsx`:
```tsx
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readUser, type User } from '@/lib/auth';

type Ctx = { user: User | null; ready: boolean; setUser: (u: User) => void };
const UserContext = createContext<Ctx | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = readUser();
    if (!u) { router.replace('/login'); return; }
    setUserState(u);
    setReady(true);
  }, [router]);

  function setUser(u: User) {
    setUserState(u);
    localStorage.setItem('user', JSON.stringify(u));
  }

  return <UserContext.Provider value={{ user, ready, setUser }}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
```

- [ ] **Step 3: `(app)/layout.tsx`에서 UserProvider로 감싸기**

`apps/web/app/(app)/layout.tsx`의 `AppShell` 바깥을 `UserProvider`로 감싼다. `AppShell`은 내부에서 `useUser()`를 쓰도록 다음 태스크에서 조정. 예:
```tsx
import { UserProvider } from '@/components/user-context';
import { AppShell } from '@/components/app-shell';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <AppShell>{children}</AppShell>
    </UserProvider>
  );
}
```

- [ ] **Step 4: 타입체크**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit`
Expected: **아직 에러 있음** — `Record<Role,…>` 4곳(대시보드/목록)에서 ADMIN 키 누락. Task 8에서 해소. (auth.ts/context 자체는 통과)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/auth.ts apps/web/components/user-context.tsx "apps/web/app/(app)/layout.tsx"
git commit -m "feat(web): ADMIN role, department on User, UserProvider context"
```

---

### Task 7: 프론트 — API 클라이언트 확장

**Files:**
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces: `listUsersByRole(role)`, `createUser(input)`, `getMyProfile()`, `updateMyProfile(patch)`, `setAssignees(id, patch)`; 타입 `UserSummary`, `AdminUserInput`. `ChangeRequestSummary`에 reviewerName/approverName 추가, `CreateChangeRequestInput`에 reviewerId/approverId.

- [ ] **Step 1: 타입 확장**

`ChangeRequestSummary`에 추가:
```ts
  reviewerId?: string | null;
  approverId?: string | null;
  reviewerName?: string | null;
  approverName?: string | null;
```
`CreateChangeRequestInput`(생성 입력 타입)에 `reviewerId?: string; approverId?: string;` 추가. 새 타입:
```ts
export type UserSummary = { id: string; name: string; department: string };
export type AdminUserInput = {
  email: string; name: string; department: string; password: string; role: Role;
};
```
(`Role`은 `@/lib/auth`에서 import)

- [ ] **Step 2: 함수 추가**

`lib/api.ts` 하단에:
```ts
export function listUsersByRole(role: 'REVIEWER' | 'APPROVER') {
  return apiFetch<UserSummary[]>(`/users?role=${role}`);
}
export function createUser(input: AdminUserInput) {
  return apiFetch<{ id: string }>(`/users`, { method: 'POST', body: JSON.stringify(input) });
}
export function getMyProfile() {
  return apiFetch<{ id: string; email: string; name: string; department: string; role: Role; telegramLinked: boolean }>(`/users/me`);
}
export function updateMyProfile(patch: { name?: string; department?: string; telegramChatId?: string }) {
  return apiFetch<unknown>(`/users/me`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function setAssignees(id: string, patch: { reviewerId?: string; approverId?: string }) {
  return apiFetch<unknown>(`/change-requests/${id}/assignees`, { method: 'PATCH', body: JSON.stringify(patch) });
}
```

- [ ] **Step 3: 타입체크(부분)**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit`
Expected: api.ts 관련 에러 없음(대시보드 ADMIN 키 에러는 Task 8까지 잔존).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(web): api client for users, profile, assignees"
```

---

### Task 8: 프론트 — 대시보드 KPI/필터 재작성 + ADMIN 라우팅

**Files:**
- Modify: `apps/web/app/(app)/dashboard/page.tsx`
- Modify: `apps/web/app/(app)/change-requests/page.tsx`

**Interfaces:**
- Consumes: `useUser()` (Task 6), 지정 기반 가시성(Task 5).
- Produces: ADMIN 진입 시 `/users` 리다이렉트. `CARDS_BY_ROLE`/`filtersForRole` 지정 기반.

- [ ] **Step 1: 대시보드 — useUser 전환 + ADMIN 리다이렉트 + 카드 재작성**

`dashboard/page.tsx`에서 `useCurrentUser`를 `useUser`로 교체. 컴포넌트 상단에 ADMIN 리다이렉트:
```tsx
const { user, ready } = useUser();
const router = useRouter();
useEffect(() => {
  if (ready && user?.role === 'ADMIN') router.replace('/users');
}, [ready, user, router]);
if (!ready || !user || user.role === 'ADMIN') return <p className="text-muted">불러오는 중…</p>;
```
`CARDS_BY_ROLE`(§4.4)를 지정 기반으로 교체 — 세 역할 모두 자기 응답 집계:
```tsx
const CARDS_BY_ROLE: Record<'DEVELOPER'|'REVIEWER'|'APPROVER', CardDef[]> = {
  DEVELOPER: [
    { label: '내 작성 중', match: (s) => s === 'DRAFT' },
    { label: '내 진행 중', emphasis: true, match: (s) => s === 'SUBMITTED' || s === 'REVIEW_APPROVED' },
    { label: '내 반려', filter: 'REJECTED', match: (s) => s === 'REVIEW_REJECTED' || s === 'FINAL_REJECTED' },
    { label: '내 완료', filter: 'DONE', match: (s) => s === 'FINAL_APPROVED' || s === 'APPLIED' },
  ],
  REVIEWER: [
    { label: '검토 대기', emphasis: true, filter: 'REVIEW_PENDING', match: (s) => s === 'SUBMITTED' },
    { label: '결재 대기', filter: 'APPROVE_PENDING', match: (s) => s === 'REVIEW_APPROVED' },
    { label: '반려', filter: 'REJECTED', match: (s) => s === 'REVIEW_REJECTED' || s === 'FINAL_REJECTED' },
    { label: '완료', filter: 'DONE', match: (s) => s === 'FINAL_APPROVED' || s === 'APPLIED' },
  ],
  APPROVER: [
    { label: '검토 진행', filter: 'REVIEW_PENDING', match: (s) => s === 'SUBMITTED' },
    { label: '결재 대기', emphasis: true, filter: 'APPROVE_PENDING', match: (s) => s === 'REVIEW_APPROVED' },
    { label: '반려', filter: 'REJECTED', match: (s) => s === 'REVIEW_REJECTED' || s === 'FINAL_REJECTED' },
    { label: '완료', filter: 'DONE', match: (s) => s === 'FINAL_APPROVED' || s === 'APPLIED' },
  ],
};
```
(`CardDef` 타입에 optional `filter?: FilterKey`, `emphasis?: boolean`, `match: (s: ChangeRequestStatus) => boolean` 유지. `user.role`이 ADMIN이 아님을 위 가드로 보장하므로 `CARDS_BY_ROLE[user.role]` 접근 안전.)

- [ ] **Step 2: 목록 — useUser 전환 + 필터 재작성**

`change-requests/page.tsx`에서 `useCurrentUser`→`useUser`. `filtersForRole`의 결재자 SUBMITTED 숨김 규칙 제거:
```tsx
function filtersForRole(_role: Role) {
  return FILTERS; // 지정 기반: 모든 역할이 자기에게 지정된 전 상태를 봄
}
```
`DEFAULT_FILTER_BY_ROLE`는 유지하되 ADMIN 키가 필요 없다(ADMIN은 목록 진입 안 함) — 안전을 위해 목록 페이지 상단에도 ADMIN 리다이렉트 가드 추가:
```tsx
useEffect(() => { if (ready && user?.role === 'ADMIN') router.replace('/users'); }, [ready, user, router]);
```
`DEFAULT_FILTER_BY_ROLE`에서 ADMIN 참조가 생기지 않도록 `user.role` 접근 전에 위 가드로 차단.

- [ ] **Step 3: 타입체크 통과 확인**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit`
Expected: **0 errors** (ADMIN 키 문제 해소).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/dashboard/page.tsx" "apps/web/app/(app)/change-requests/page.tsx"
git commit -m "feat(web): assignment-based KPI cards and filters, ADMIN routing"
```

---

### Task 9: 프론트 — 사이드바(이름·부서/역할) + 관리자 네비

**Files:**
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/app-shell.tsx`

**Interfaces:**
- Consumes: `useUser()`.
- Produces: 사이드바 하단 2줄 표시 + ADMIN에게 "사용자 관리" 네비.

- [ ] **Step 1: AppShell을 useUser로 전환**

`app-shell.tsx`에서 `useCurrentUser` 대신 `useUser()`를 사용(가드는 UserProvider가 이미 수행). `Sidebar`에 `user` 전달 유지.

- [ ] **Step 2: 사이드바 하단 2줄 + 부서**

`sidebar.tsx` 하단 사용자 블록을 교체:
```tsx
<div className="text-sm">
  <div className="font-semibold text-ink">
    {user.name} <span className="text-muted">| {user.department}</span>
  </div>
  <div className="text-xs text-muted">{ROLE_LABEL[user.role]}</div>
</div>
```

- [ ] **Step 3: ADMIN 네비 항목 추가**

`sidebar.tsx`의 네비 정의에 "사용자 관리"(href `/users`) 항목을 추가하되 `user.role === 'ADMIN'`일 때만 렌더. 기존 역할 필터 패턴(스키마Diff=검토자 숨김 등)과 동일 방식.

- [ ] **Step 4: 타입체크 + 수동 확인**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit`
Expected: 0 errors. (수동: 검토자 로그인 시 `검토자 | DBA팀 / 검토자(DBA)` 표시)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/sidebar.tsx apps/web/components/app-shell.tsx
git commit -m "feat(web): sidebar shows name | department / role, admin nav"
```

---

### Task 10: 프론트 — 관리자 사용자 페이지

**Files:**
- Create: `apps/web/app/(app)/users/page.tsx`

**Interfaces:**
- Consumes: `createUser`, `listUsersByRole` 없음(목록은 별도) — 관리자 목록용으로 `GET /users?role=` 4역할 합쳐 표시하거나, 간단히 생성 폼 + 역할별 목록. MVP: 생성 폼 + 역할별(REVIEWER/APPROVER/DEVELOPER) 목록.

- [ ] **Step 1: 페이지 생성(생성 폼 + 목록)**

`apps/web/app/(app)/users/page.tsx` — `useUser()`로 ADMIN 아니면 "접근 불가" 카드. `PageHeader title="사용자 관리"`. 폼 필드: 이메일·이름·부서·역할(select DEVELOPER/REVIEWER/APPROVER/ADMIN)·초기 비밀번호. 제출 시 `createUser`, 성공 시 폼 초기화 + 목록 새로고침. 목록은 `listUsersByRole('REVIEWER')`·`('APPROVER')` 등을 합쳐 표시(이름·부서·역할). 토큰: `bg-card`,`ring-border`,`inputClass=bg-card ring-border-strong`.

(완전한 코드는 `target-databases/page.tsx`의 생성 폼·목록 패턴을 그대로 따른다 — 동일 토큰·검증·에러 배너.)

- [ ] **Step 2: 빌드 확인**

Run: `pnpm --filter @dbflow/web build`
Expected: `/users` 라우트 컴파일 성공.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/users/page.tsx"
git commit -m "feat(web): admin user management page"
```

---

### Task 11: 프론트 — CR 생성 폼 지정 드롭다운 + 상세 지정자 표시/재지정

**Files:**
- Modify: `apps/web/app/(app)/change-requests/new/page.tsx`
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx`

**Interfaces:**
- Consumes: `listUsersByRole`, `createChangeRequest`(reviewerId/approverId), `setAssignees`, `ChangeRequestSummary.reviewerName/approverName`.

- [ ] **Step 1: 생성 폼에 검토자·결재자 드롭다운**

`new/page.tsx`: 마운트 시 `listUsersByRole('REVIEWER')`·`('APPROVER')` 로드. select 2개(검토자/결재자, 옵션 `이름 (부서)`). state `reviewerId`/`approverId`. 제출 검증: 미선택 시 에러. `createChangeRequest`에 `reviewerId`·`approverId` 포함.

- [ ] **Step 2: 상세에 지정자 표시**

`[id]/page.tsx` 헤더 영역에 지정 검토자/결재자 이름 표시(`reviewerName`/`approverName`). 없으면 "미지정".

- [ ] **Step 3: 재지정 UI(조건부)**

DRAFT면서 작성자이거나 role===ADMIN일 때 지정 변경 select + "지정 변경" 버튼 노출 → `setAssignees(id, {...})` 후 새로고침. 그 외엔 읽기전용 표시.

- [ ] **Step 4: 빌드 + 수동 시나리오**

Run: `pnpm --filter @dbflow/web build`
Expected: 성공. 수동: 개발자가 CR 생성 시 검토자/결재자 선택 → 그 검토자만 상세에서 검토 버튼 동작.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/change-requests/new/page.tsx" "apps/web/app/(app)/change-requests/[id]/page.tsx"
git commit -m "feat(web): assign reviewer/approver on create, show/reassign on detail"
```

---

### Task 12: 통합 검증

**Files:** 없음(검증 전용)

- [ ] **Step 1: 백엔드 테스트 전체**

Run: `pnpm --filter @dbflow/api test`
Expected: 전체 PASS.

- [ ] **Step 2: 프론트 빌드**

Run: `pnpm --filter @dbflow/web build`
Expected: 전 라우트 컴파일(신규 `/users` 포함), 타입 0 에러.

- [ ] **Step 3: 풀스택 기동 + 시나리오(수동)**

Run: `./start.sh --no-install`
확인:
- admin(`admin@dbflow.io`)으로 로그인 → `/users`로 이동, 계정 생성 가능
- 개발자로 CR 생성 시 검토자·결재자 지정 → 제출
- 지정 안 한 검토자로 로그인 시 그 CR이 목록에 안 보임(가시성)
- 지정된 검토자만 검토 승인 가능, 지정된 결재자만 결재 가능
- 사이드바에 `이름 | 부서 / 역할` 표시
- 대시보드 KPI가 "내 담당" 기준으로 집계

- [ ] **Step 4: 최종 커밋(있으면)**

```bash
git add -A && git commit -m "chore: spec1 assignments/profiles/admin integration verified" || true
```

---

## Self-Review (작성자 확인 완료)

- **스펙 커버리지**: §4.1(스키마)→T1, §4.2 Users→T2·auth→T3·CR게이트→T4·가시성/재지정→T5, §4.3 사이드바/Context→T6·T9, §4.4 Role/ADMIN/KPI/필터→T6·T8, 관리자 페이지→T10, 생성/상세→T11. 전 항목 태스크 매핑됨.
- **플레이스홀더**: 각 코드 스텝에 실제 코드 포함. T10·T11의 폼은 기존 `target-databases`/`new` 패턴 재사용을 명시(코드 분량상 패턴 참조, 토큰·검증 규칙 구체화).
- **타입 일관성**: `setAssignees`·`listByRole`·`updateMe`·`profile` 시그니처가 서비스↔컨트롤러↔api.ts에서 일치. `CardDef.filter?`/`emphasis?` 유지.
- **주의**: T6 이후 T8까지 tsc가 빨간 상태(ADMIN 키) — 의도된 순서. 커밋은 각 태스크 단위이므로 T8 전 중간 커밋은 빌드 실패일 수 있음 → 실행 시 T6·T7·T8을 연속 처리 권장.
