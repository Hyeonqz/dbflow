# 부재 위임 (Approval Delegation) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검토자/결재자가 부재 기간 동안 같은 역할 대리인에게 위임해 대신 검토/결재하게 한다 (스펙: `docs/superpowers/specs/2026-07-20-dbflow-delegation-design.md`).

**Architecture:** 신규 `Delegation` 테이블 + `ChangeRequestApprover.decidedById` + `delegation` NestJS 모듈(CRUD + 활성 판정 헬퍼) → change-request 서비스의 review()/approve()/가시성/요약에 위임 판정 통합. 행위 시점 판정, 스케줄러 없음. KST 벽시계.

**Tech Stack:** NestJS 10 + Prisma 5 + MySQL 8 / Next.js 14 App Router + Tailwind.

## Global Constraints

- 위임 활성: `startsAt <= now < endsAt`, KST 벽시계(`+09:00` 변환, apply-schedule과 동일 `new Date(\`${value}:00+09:00\`)`).
- **역할 동일 강제**: delegate.role === delegator.role, role ∈ {REVIEWER, APPROVER}. 자기위임 금지.
- **책임추적**: 대리 결재 슬롯 `decidedById`=실제 행위자, 감사 metadata `onBehalfOf`/`delegatedFrom`, 전이 시 StatusHistory.comment에 "(위임: {이름} 대리)".
- **동시성**: review()/approve() 모두 인터랙티브 tx + `SELECT … FOR UPDATE` + tx 안 상태·슬롯 재확인. delegatorIds/isActiveDelegateFor 읽기만 tx 밖 허용(위임 행은 CR 락 무관).
- **무회귀**: 위임 0건 → 모든 경로가 기존과 동일. `activeDelegatorIds`는 REVIEWER/APPROVER에만 조회(그 외 `[]`).
- **위임은 게이트 우회 금지**: 지정 인원 수(만장일치)·역할 자격 그대로.
- GET/POST /delegations 로그인 공통, 비-ADMIN은 delegatorId self 강제. DELETE는 위임자/ADMIN.
- 백엔드 유닛 `new Service(mockPrisma, ...)` 패턴(Nest TestingModule 금지). 프론트 tsc+build 검증.

---

### Task 1: 스키마 · 마이그레이션 · 감사 enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_delegation/migration.sql` (prisma 자동 생성)

**Interfaces:** Produces `Delegation` 모델, `ChangeRequestApprover.decidedById`, `AuditAction.DELEGATION_UPDATED`, `AuditTargetType.DELEGATION`.

- [ ] **Step 1: 스키마 편집**

`Delegation` 모델 추가(SqlReviewRule/ApplyWindow 근처):
```prisma
model Delegation {
  id          String   @id @default(cuid())
  delegatorId String
  delegateId  String
  startsAt    DateTime
  endsAt      DateTime
  reason      String?
  createdById String
  createdAt   DateTime @default(now())

  delegator User @relation("delegator", fields: [delegatorId], references: [id])
  delegate  User @relation("delegate", fields: [delegateId], references: [id])
  createdBy User @relation("delegationCreator", fields: [createdById], references: [id])

  @@index([delegatorId])
  @@index([delegateId])
  @@map("delegation")
}
```
`ChangeRequestApprover`에 추가:
```prisma
  decidedById String?
  decidedBy   User?   @relation("approverDecider", fields: [decidedById], references: [id])
```
`User` 모델 관계에 4개 추가:
```prisma
  delegationsGiven    Delegation[]            @relation("delegator")
  delegationsReceived Delegation[]            @relation("delegate")
  delegationsCreated  Delegation[]            @relation("delegationCreator")
  approverDecisions   ChangeRequestApprover[] @relation("approverDecider")
```
`AuditAction`에 `DELEGATION_UPDATED`, `AuditTargetType`에 `DELEGATION` 추가.

- [ ] **Step 2: 마이그레이션 생성·적용**

신규 테이블 1 + nullable 컬럼 1 → 백필 불필요, 일반 `migrate dev`:
Run: `pnpm --filter @dbflow/api exec prisma migrate dev --name delegation`
Expected: 마이그레이션 생성·적용 + 클라이언트 재생성.

- [ ] **Step 3: 확인 + Commit**

Run: `docker exec -i project-dbflow-mysql-1 mysql -udbflow -pdbflow dbflow -e "SHOW TABLES LIKE 'delegation'; SHOW COLUMNS FROM change_request_approver LIKE 'decidedById';"`
Expected: delegation 테이블 + decidedById 컬럼 존재.
```bash
git add apps/api/prisma
git commit -m "feat(api): Delegation model + ChangeRequestApprover.decidedById, delegation audit enums"
```

---

### Task 2: DelegationService · 컨트롤러 · 모듈 (TDD)

**Files:**
- Create: `apps/api/src/delegation/delegation.service.ts` (+ `.spec.ts`)
- Create: `apps/api/src/delegation/delegation.controller.ts`
- Create: `apps/api/src/delegation/delegation.module.ts`
- Create: `apps/api/src/delegation/dto/delegation.dto.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 모델, `AuditService.record`(글로벌), `AuditActorSnapshot`(`../audit/audit.types`), auth 데코레이터.
- Produces: `activeDelegatorIds(delegateId): Promise<string[]>`, `isActiveDelegateFor(delegateId, delegatorId): Promise<boolean>`, `list(user)`, `createDelegation(dto, actor)`, `deleteDelegation(id, actor)`. `DelegationModule`은 **`exports: [DelegationService]`**. 라우트: `GET /delegations`, `POST /delegations`, `DELETE /delegations/:id`.

- [ ] **Step 1: 실패 테스트**

`delegation.service.spec.ts`:
```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DelegationService } from './delegation.service';

const TUE = new Date(2026, 6, 21, 3, 0, 0); // 화 03:00 KST

function svc(overrides: any = {}) {
  const prisma: any = {
    delegation: {
      findMany: overrides.findMany ?? (() => Promise.resolve([])),
      findFirst: overrides.findFirst ?? (() => Promise.resolve(null)),
      findUnique: overrides.findUnique ?? (() => Promise.resolve(null)),
      create: overrides.create ?? ((a: any) => Promise.resolve({ id: 'd1', ...a.data })),
      delete: overrides.delete ?? (() => Promise.resolve({})),
    },
    user: { findMany: overrides.users ?? (() => Promise.resolve([])) },
  };
  const audit = { record: overrides.record ?? (() => Promise.resolve()) };
  return new DelegationService(prisma as any, audit as any);
}

describe('DelegationService.activeDelegatorIds', () => {
  it('returns delegatorIds for active windows only', async () => {
    const s = svc({ findMany: ({ where }: any) => {
      // 검증: where.delegateId, startsAt.lte, endsAt.gt 형태
      expect(where.delegateId).toBe('Y');
      return Promise.resolve([{ delegatorId: 'X1' }, { delegatorId: 'X2' }]);
    }});
    expect(await s.activeDelegatorIds('Y')).toEqual(['X1', 'X2']);
  });
});

describe('DelegationService.createDelegation', () => {
  const admin = { userId: 'adm', name: 'A', role: 'ADMIN', department: '운영팀' };
  const appr = { userId: 'X', name: 'X', role: 'APPROVER', department: 'infra' };

  it('rejects self-delegation', async () => {
    await expect(svc().createDelegation(
      { delegateId: 'X', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any, appr as any,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects role mismatch (delegate not same role)', async () => {
    const s = svc({ users: () => Promise.resolve([
      { id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'REVIEWER' }]) });
    await expect(s.createDelegation(
      { delegateId: 'Y', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any, appr as any,
    )).rejects.toThrow(/같은 역할/);
  });

  it('rejects startsAt >= endsAt', async () => {
    const s = svc({ users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]) });
    await expect(s.createDelegation(
      { delegateId: 'Y', startsAt: '2026-07-02T00:00', endsAt: '2026-07-01T00:00' } as any, appr as any,
    )).rejects.toThrow(/시작/);
  });

  it('non-admin forces delegatorId to self and converts KST', async () => {
    let created: any = null;
    const s = svc({
      users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]),
      create: (a: any) => { created = a.data; return Promise.resolve({ id: 'd1', ...a.data }); },
    });
    await s.createDelegation(
      { delegatorId: 'SOMEONE_ELSE', delegateId: 'Y', startsAt: '2026-09-30T00:00', endsAt: '2026-10-02T00:00' } as any,
      appr as any,
    );
    expect(created.delegatorId).toBe('X');          // self 강제(비-ADMIN)
    expect(created.startsAt.toISOString()).toBe('2026-09-29T15:00:00.000Z'); // KST 00:00
  });

  it('admin may set delegatorId to another user', async () => {
    let created: any = null;
    const s = svc({
      users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]),
      create: (a: any) => { created = a.data; return Promise.resolve({ id: 'd1', ...a.data }); },
    });
    await s.createDelegation(
      { delegatorId: 'X', delegateId: 'Y', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any,
      admin as any,
    );
    expect(created.delegatorId).toBe('X');
    expect(created.createdById).toBe('adm');
  });
});

describe('DelegationService.deleteDelegation', () => {
  it('forbids a non-owner non-admin', async () => {
    const s = svc({ findUnique: () => Promise.resolve({ id: 'd1', delegatorId: 'X', delegateId: 'Y' }) });
    await expect(s.deleteDelegation('d1', { userId: 'Z', role: 'APPROVER' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run `pnpm --filter @dbflow/api test -- delegation.service` → FAIL.

- [ ] **Step 3: 서비스 구현**

`delegation.service.ts`:
```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';

function parseKst(value: string): Date {
  return new Date(`${value}:00+09:00`);
}

@Injectable()
export class DelegationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** 지금 이 사람이 대리 가능한 위임자 id 목록. */
  async activeDelegatorIds(delegateId: string, now = new Date()): Promise<string[]> {
    const rows = await this.prisma.delegation.findMany({
      where: { delegateId, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { delegatorId: true },
    });
    return rows.map((r) => r.delegatorId);
  }

  async isActiveDelegateFor(delegateId: string, delegatorId: string, now = new Date()): Promise<boolean> {
    const row = await this.prisma.delegation.findFirst({
      where: { delegateId, delegatorId, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { id: true },
    });
    return !!row;
  }

  async list(user: { userId: string; role: Role }) {
    const where =
      user.role === Role.ADMIN
        ? {}
        : { OR: [{ delegatorId: user.userId }, { delegateId: user.userId }] };
    return this.prisma.delegation.findMany({
      where,
      orderBy: { startsAt: 'desc' },
      select: {
        id: true, startsAt: true, endsAt: true, reason: true,
        delegator: { select: { name: true, role: true } },
        delegate: { select: { name: true, role: true } },
        createdBy: { select: { name: true } },
      },
    });
  }

  async createDelegation(
    dto: { delegatorId?: string; delegateId: string; startsAt: string; endsAt: string; reason?: string },
    actor: AuditActorSnapshot & { role: Role },
  ) {
    // 비-ADMIN은 self 강제
    const delegatorId = actor.role === Role.ADMIN && dto.delegatorId ? dto.delegatorId : actor.userId;
    if (delegatorId === dto.delegateId)
      throw new BadRequestException('자기 자신에게 위임할 수 없습니다.');
    const startsAt = parseKst(dto.startsAt);
    const endsAt = parseKst(dto.endsAt);
    if (!(startsAt < endsAt)) throw new BadRequestException('위임 시작이 종료보다 빨라야 합니다.');

    const users = await this.prisma.user.findMany({
      where: { id: { in: [delegatorId, dto.delegateId] } },
      select: { id: true, role: true },
    });
    const del = users.find((u) => u.id === delegatorId);
    const dee = users.find((u) => u.id === dto.delegateId);
    const ALLOWED: Role[] = [Role.REVIEWER, Role.APPROVER];
    if (!del || !dee || del.role !== dee.role || !ALLOWED.includes(del.role))
      throw new BadRequestException('위임자와 대리인은 같은 역할(검토자 또는 결재자)이어야 합니다.');

    const row = await this.prisma.delegation.create({
      data: { delegatorId, delegateId: dto.delegateId, startsAt, endsAt, reason: dto.reason ?? null, createdById: actor.userId },
    });
    await this.audit.record({
      actor, action: AuditAction.DELEGATION_UPDATED, targetType: AuditTargetType.DELEGATION, targetId: row.id,
      summary: `위임 등록: ${delegatorId} → ${dto.delegateId}`,
      metadata: { op: 'CREATE', delegatorId, delegateId: dto.delegateId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    });
    return row;
  }

  async deleteDelegation(id: string, actor: AuditActorSnapshot & { role: Role }) {
    const row = await this.prisma.delegation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('위임을 찾을 수 없습니다.');
    if (actor.role !== Role.ADMIN && row.delegatorId !== actor.userId)
      throw new ForbiddenException('본인 위임 또는 관리자만 해제할 수 있습니다.');
    await this.prisma.delegation.delete({ where: { id } });
    await this.audit.record({
      actor, action: AuditAction.DELEGATION_UPDATED, targetType: AuditTargetType.DELEGATION, targetId: id,
      summary: `위임 해제: ${row.delegatorId} → ${row.delegateId}`,
      metadata: { op: 'DELETE', delegatorId: row.delegatorId, delegateId: row.delegateId },
    });
    return { ok: true };
  }
}
```

- [ ] **Step 4: 통과 확인** — Run `pnpm --filter @dbflow/api test -- delegation.service` → PASS.

- [ ] **Step 5: DTO + 컨트롤러 + 모듈 + app.module**

`dto/delegation.dto.ts`:
```ts
import { IsOptional, IsString, Length, Matches } from 'class-validator';
export class CreateDelegationDto {
  @IsOptional() @IsString() delegatorId?: string;        // ADMIN만 의미
  @IsString() delegateId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAt!: string; // KST 벽시계
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) endsAt!: string;
  @IsOptional() @Length(1, 200) reason?: string;
}
```
`delegation.controller.ts` (컨트롤러 레벨 @Roles 금지 — GET/POST 로그인 공통):
```ts
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DelegationService } from './delegation.service';
import { CreateDelegationDto } from './dto/delegation.dto';

@Controller('delegations')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class DelegationController {
  constructor(private readonly svc: DelegationService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.list({ userId: user.userId, role: user.role });
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateDelegationDto) {
    return this.svc.createDelegation(dto, { userId: user.userId, name: user.name, role: user.role, department: user.department });
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.deleteDelegation(id, { userId: user.userId, name: user.name, role: user.role, department: user.department });
  }
}
```
`delegation.module.ts` (exports 필수):
```ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { DelegationController } from './delegation.controller';
import { DelegationService } from './delegation.service';

@Module({
  imports: [PassportModule],
  controllers: [DelegationController],
  providers: [DelegationService, PrismaService],
  exports: [DelegationService],
})
export class DelegationModule {}
```
`app.module.ts` imports에 `DelegationModule` 추가.

- [ ] **Step 6: 빌드 + Commit**

Run: `pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/delegation apps/api/src/app.module.ts
git commit -m "feat(api): delegation module — CRUD, active-delegation helpers, audited"
```

---

### Task 3: change-request 위임 통합 (최대 파급, opus)

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Modify: `apps/api/src/change-request/change-request.module.ts`
- Modify: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:**
- Consumes: `DelegationService.activeDelegatorIds`/`isActiveDelegateFor` (Task 2), `ChangeRequestApprover.decidedById` (Task 1).
- Produces: 대리인 가시성·review/approve 대리 경로·`decidedBy`/`canActAsDelegate` 노출·대리 `myApprovalPending`.

- [ ] **Step 1: 생성자·모듈·SELECT 배선**

- 생성자 4번째 인자 추가: `private readonly delegation: DelegationService,` (import).
- `change-request.module.ts` imports에 `DelegationModule` 추가(import). (현재 `[PassportModule, ApprovalPolicyModule]`.)
- `DETAIL_INCLUDE.approvers.select`에 추가: `decidedById: true, decidedBy: { select: { name: true } },`.
- `toDetail`의 `approvers.map(a => ({...}))`에 추가: `decidedBy: a.decidedBy?.name ?? null,`.

- [ ] **Step 2: 가시성 확장 (critic C1)**

`visibilityWhere`를 `(user, delegatorIds: string[] = [])`로 변경:
```ts
private visibilityWhere(user: AuthUser, delegatorIds: string[] = []): Prisma.ChangeRequestWhereInput {
  switch (user.role) {
    case Role.DEVELOPER:
      return { authorId: user.userId };
    case Role.REVIEWER:
      return { OR: [{ reviewerId: user.userId }, { reviewerId: { in: delegatorIds } }], status: { not: ChangeRequestStatus.DRAFT } };
    case Role.APPROVER:
      return {
        OR: [{ approvers: { some: { userId: user.userId } } }, { approvers: { some: { userId: { in: delegatorIds } } } }],
        status: { not: ChangeRequestStatus.DRAFT },
      };
    default:
      return { id: { equals: '' } };
  }
}
```
`list`/`findOne`에 delegatorIds resolve 헬퍼:
```ts
private async delegatorIdsFor(user: AuthUser): Promise<string[]> {
  if (user.role !== Role.REVIEWER && user.role !== Role.APPROVER) return []; // critic Minor4
  return this.delegation.activeDelegatorIds(user.userId);
}
```
`list(user)`:
```ts
const delegatorIds = await this.delegatorIdsFor(user);
const rows = await this.prisma.changeRequest.findMany({
  where: this.visibilityWhere(user, delegatorIds),
  select: SUMMARY_SELECT, orderBy: { createdAt: 'desc' },
});
return rows.map((row) => this.toSummary(row, user.userId, delegatorIds));
```
`findOne(user, id)`:
```ts
const delegatorIds = await this.delegatorIdsFor(user);
const changeRequest = await this.prisma.changeRequest.findFirst({
  where: { id, ...this.visibilityWhere(user, delegatorIds) },
  include: DETAIL_INCLUDE,
});
if (!changeRequest) throw new NotFoundException('변경요청을 찾을 수 없습니다.');
return this.toDetail(changeRequest, user.userId, delegatorIds);
```
(주의: `findOne`이 `{ id, ...where }`로 스프레드 → id AND OR AND status. `DEVELOPER.role`로 approve()가 findOne 호출하는 곳은 delegatorIds=[] 이므로 무영향.)

- [ ] **Step 3: toSummary/toDetail 대리 확장**

`toSummary(row, currentUserId, delegatorIds: string[] = [])` — `myApprovalPending` **status 게이트 유지(critic Major1)**:
```ts
myApprovalPending:
  rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
  approvers.some((a) => (a.userId === currentUserId || delegatorIds.includes(a.userId)) && a.decision === null),
```
`toDetail(changeRequest, currentUserId?: string, delegatorIds: string[] = [])` — `decidedBy` 평탄화(Step 1) + `canActAsDelegate` 추가(critic Minor5). 반환 객체에:
```ts
canActAsDelegate:
  (rest.status === ChangeRequestStatus.SUBMITTED && !!delegatorIds.length && delegatorIds.includes(rest.reviewerId ?? '')) ||
  (rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
    approvers.some((a) => delegatorIds.includes(a.userId) && a.decision === null)),
```
(주의: `toDetail`이 `reviewerId`를 rest에 갖는지 확인 — DETAIL_INCLUDE는 select 아닌 include라 전체 필드 포함, `reviewerId` 존재. approvers는 구조분해로 이미 빠져 별도 참조.)

- [ ] **Step 4: withDelegateNote 헬퍼**

서비스에 private:
```ts
private withDelegateNote(comment: string | null | undefined, delegatorName: string | null): string | null {
  const base = comment ?? null;
  if (!delegatorName) return base;
  return `${base ? base + ' ' : ''}(위임: ${delegatorName} 대리)`;
}
```

- [ ] **Step 5: review() 인터랙티브 tx 재작성 (critic I2/Major2/Minor2,3)**

기존 `review()` 전체를 스펙 §3 코드로 교체:
```ts
async review(actor: CurrentUserPayload, id: string, dto: DecisionDto) {
  const action: CrTransitionAction = dto.decision === Decision.APPROVE ? 'REVIEW_APPROVE' : 'REVIEW_REJECT';
  await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ChangeRequest WHERE id = ${id} FOR UPDATE`;
    const cr = await tx.changeRequest.findUnique({ where: { id }, select: { id: true, status: true, reviewerId: true } });
    if (!cr) throw new NotFoundException('변경요청을 찾을 수 없습니다.');
    const rid = cr.reviewerId;
    const isDirect = rid === actor.userId;
    const isDelegate = !isDirect && !!rid && (await this.delegation.isActiveDelegateFor(actor.userId, rid));
    if (!isDirect && !isDelegate) throw new ForbiddenException('지정된 검토자 또는 활성 대리인만 검토할 수 있습니다.');
    const toStatus = getNextStatus(cr.status, action); // 이미 전이됨이면 throw → 이중 검토 차단
    const delegatorName = isDelegate
      ? (await tx.user.findUnique({ where: { id: rid! }, select: { name: true } }))?.name ?? null
      : null;
    await tx.changeRequest.update({ where: { id }, data: { status: toStatus } });
    await tx.statusHistory.create({
      data: { changeRequestId: id, fromStatus: cr.status, toStatus, actorId: actor.userId,
        comment: this.withDelegateNote(dto.comment, delegatorName) },
    });
    await tx.auditLog.create({
      data: this.audit.buildData({
        actor, action: AuditAction.CR_REVIEWED, targetType: AuditTargetType.CHANGE_REQUEST, targetId: id,
        summary: `검토 ${action === 'REVIEW_APPROVE' ? '승인' : '반려'} (CR ${id})`,
        metadata: { fromStatus: cr.status, toStatus, comment: dto.comment ?? undefined, onBehalfOf: isDelegate ? rid : undefined },
      }),
    });
  });
  return this.findOne(actor, id);
}
```
(`applyTransition`은 submit 전용으로 그대로. 필요한 import: 이미 있는 것들 + 없으면 추가.)

- [ ] **Step 6: approve() 대리 슬롯 확장 (critic Major2)**

기존 approve() tx 안, `mine` 판정 블록을 교체:
```ts
const delegatorIds = await this.delegation.activeDelegatorIds(actor.userId); // tx 밖(호출은 $transaction 앞에 둔다)
// … $transaction 안, FOR UPDATE + status 체크 직후:
const mine = await tx.changeRequestApprover.findUnique({
  where: { changeRequestId_userId: { changeRequestId: id, userId: actor.userId } },
});
let slot = mine && mine.decision === null ? mine : null;
let onBehalfOf: string | null = null;
let delegatorName: string | null = null;
if (!slot && delegatorIds.length) {
  const del = await tx.changeRequestApprover.findFirst({
    where: { changeRequestId: id, userId: { in: delegatorIds }, decision: null },
    orderBy: { order: 'asc' },
    include: { user: { select: { name: true } } },
  });
  if (del) { slot = del; onBehalfOf = del.userId; delegatorName = del.user?.name ?? null; }
}
if (!slot) {
  if (mine && mine.decision !== null) throw new ConflictException('이미 결재하셨습니다.');
  throw new ForbiddenException('지정된 결재자 또는 활성 대리인만 결재할 수 있습니다.');
}
const decision: ApprovalDecision = dto.decision === Decision.APPROVE ? ApprovalDecision.APPROVE : ApprovalDecision.REJECT;
await tx.changeRequestApprover.update({
  where: { id: slot.id },
  data: { decision, comment: dto.comment ?? null, decidedAt: new Date(), decidedById: onBehalfOf ? actor.userId : null },
});
```
- `delegatorIds` 읽기는 `this.prisma.$transaction(...)` **호출 직전**에 배치(tx 밖).
- 이후 진행률/전이 블록: 전이 시 StatusHistory `comment: this.withDelegateNote(dto.comment, delegatorName)`, 감사 metadata에 `delegatedFrom: onBehalfOf ?? undefined` 추가.

- [ ] **Step 7: 테스트 재작성 + 신규**

`change-request.service.spec.ts`:
- **생성자 4번째 인자**: 모든 `new ChangeRequestService(prisma, audit, policy)` 호출부(grep `new ChangeRequestService(` — 정확히 **9곳**: 79,304,465,553,610,631,652,671,681행)를 `(prisma, audit, policy, delegation)`로. `delegationMock = { activeDelegatorIds: async () => [], isActiveDelegateFor: async () => false }` 기본.
- **깨지는 기존 테스트 3종(critic — 반드시 함께 수정, 안 그러면 스위트 적색):**
  1. **≈526행 "records the audit log inside the array-form transition transaction (review path)"** — review가 이제 인터랙티브 fn-form tx라 "배열 길이 3" 전제가 **거짓**이 됨. 이 테스트를 **`submit()` 경로로 재지정**(submit은 여전히 applyTransition 배열 tx)하거나 삭제. **배열 tx를 유지하려 review를 되돌리지 말 것**(설계 위반).
  2. **≈208·218행 visibility 단언** — `visibilityWhere`가 이제 `{ OR:[...], status:{not:DRAFT} }` 형태. 기대값을 flat(`{reviewerId:'dba',status:{not:DRAFT}}`/`{approvers:{some:...},status:{not:DRAFT}}`)에서 **OR 형태로 재작성**. (DEVELOPER≈200·ADMIN≈228 테스트는 `delegatorIdsFor`가 비-검토/결재 역할을 `[]`로 단락하므로 그대로 통과.)
  3. **`svc()` 헬퍼(≈299행)·`makeService`(≈39행) mock prisma에 `$queryRaw: () => Promise.resolve([])` 추가**(+ svc()엔 `$transaction: (fn) => fn(tx)` 없으면 추가). 새 review()가 `tx.$queryRaw...FOR UPDATE`·`tx.user.findUnique`를 호출하므로, 없으면 403 테스트(≈308)·review 해피패스/409(≈144~196)가 기대 예외 대신 TypeError. review용 tx mock에 `changeRequest.findUnique/update`·`statusHistory.create`·`auditLog.create`·`user.findUnique` 포함.
- **review 신규/수정**: 직접 검토자 해피패스 + 미지정·비대리 403(approve 테스트의 `txPrisma` 패턴 참고).
- **신규**: 
  - `activeDelegatorIds` 반환 시 review 대리 통과(status 전이, 감사 onBehalfOf).
  - approve 직접 슬롯 우선 → 위임 슬롯(delegatorIds에 슬롯주인 포함, decision=null), `decidedById=actor` 세팅, 진행률 무영향.
  - 이미 직접 결재 + 위임 슬롯 없음 → 409.
  - 가시성: `visibilityWhere('APPROVER', ['X'])` OR 형태 단언 / `list`가 delegatorIds resolve 후 전달.
  - `myApprovalPending`: 대리 슬롯 미결정 + status REVIEW_APPROVED → true, SUBMITTED → false(Major1 회귀).
- Run: `pnpm --filter @dbflow/api test` → 전체 GREEN.

- [ ] **Step 8: 빌드 + Commit**

Run: `pnpm --filter @dbflow/api test && pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/change-request
git commit -m "feat(api): delegation-aware review/approve, visibility, decidedBy, canActAsDelegate (interactive tx + FOR UPDATE)"
```

---

### Task 4: 프론트 — 위임 관리 페이지 + API + 네비 + 감사 옵션

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/app/(app)/delegations/page.tsx`
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/icons.tsx`
- Modify: `apps/web/app/(app)/audit/page.tsx`

**Interfaces:** Consumes Task 2 라우트 + `listUsersByRole`. Produces `listDelegations`/`createDelegation`/`deleteDelegation` + 타입.

- [ ] **Step 1: api 클라이언트**

`lib/api.ts`(기존 `TargetEnv`/`Role`/`listUsersByRole` 재사용 — 확인):
```ts
export type DelegationRow = {
  id: string; startsAt: string; endsAt: string; reason: string | null;
  delegator: { name: string | null; role: string };
  delegate: { name: string | null; role: string };
  createdBy: { name: string | null };
};
export function listDelegations() { return apiFetch<DelegationRow[]>(`/delegations`); }
export function createDelegation(input: { delegatorId?: string; delegateId: string; startsAt: string; endsAt: string; reason?: string }) {
  return apiFetch<DelegationRow>(`/delegations`, { method: 'POST', body: JSON.stringify(input) });
}
export function deleteDelegation(id: string) {
  return apiFetch<unknown>(`/delegations/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: 감사 필터 옵션**

`audit/page.tsx`: `ACTION_OPTIONS`에 `'DELEGATION_UPDATED'`, `TARGET_TYPE_OPTIONS`에 `'DELEGATION'` 추가.

- [ ] **Step 3: 위임 페이지**

`app/(app)/delegations/page.tsx` — apply-schedule/approval-policy 페이지 패턴(useUser, PageHeader "부재 위임", 에러 배너, 재조회):
- 접근: REVIEWER·APPROVER·ADMIN(그 외 "접근 불가").
- `listDelegations()` 로드 → 목록 테이블(위임자/대리인/기간 KST/사유/등록자/해제 버튼).
- 등록 폼:
  - 비-ADMIN: 대리인 셀렉트만(=자기 역할 사용자, **`listUsersByRole(user.role as 'REVIEWER' | 'APPROVER')`** — `listUsersByRole` 파라미터 타입이 `'REVIEWER'|'APPROVER'`라 넓은 `Role`을 그대로 넘기면 tsc 에러; 이 분기는 REVIEWER/APPROVER만 도달하므로 캐스트 안전, critic), 자기 제외 + 기간(`datetime-local` 2개, 원문 문자열 전송) + 사유. delegatorId 미전송(서버 self 강제).
  - ADMIN: 위임자 셀렉트(`listUsersByRole('REVIEWER')`·`listUsersByRole('APPROVER')` 두 번 로드해 합침) + 대리인 셀렉트(선택된 위임자와 **같은 역할만** 필터) + 기간 + 사유.
- KST 표시 헬퍼는 apply-schedule 페이지의 `toLocaleString('ko-KR', { timeZone:'Asia/Seoul' })` 방식 재사용.

- [ ] **Step 4: 사이드바 + 아이콘**

`icons.tsx`: `UserSwitchIcon`(사람+화살표, 기존 Base 스타일). `sidebar.tsx`: import에 추가 + 나비 항목 `{ href: '/delegations', label: '부재 위임', Icon: UserSwitchIcon, roles: ['REVIEWER','APPROVER','ADMIN'] }`(적절 위치). **다중 역할 배열은 이미 지원됨**(`roles?: Role[]` + `it.roles.includes(user.role)` 필터, critic 확인) — 그대로 추가하면 됨.

- [ ] **Step 5: tsc + build + Commit**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
```bash
git add apps/web/lib/api.ts "apps/web/app/(app)/delegations" apps/web/components/sidebar.tsx apps/web/components/icons.tsx "apps/web/app/(app)/audit/page.tsx"
git commit -m "feat(web): delegation management page, nav, audit filter options"
```

---

### Task 5: 프론트 — CR 상세 대리 버튼 + 표기

**Files:**
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx`
- Modify: `apps/web/lib/api.ts` (상세 타입에 `canActAsDelegate`, approvers `decidedBy` 추가)

**Interfaces:** Consumes Task 3 상세 응답(`canActAsDelegate`, `approvers[].decidedBy`).

- [ ] **Step 1: 타입 갱신**

`lib/api.ts` `ChangeRequestDetail`에 `canActAsDelegate: boolean` 추가, `approvers[]` 항목에 `decidedBy: string | null` 추가.

- [ ] **Step 2: 상세 UI**

`[id]/page.tsx`:
- **검토/결재 버튼 노출 조건 확장**(실제 코드 ≈220~223행: `canReview = role==='REVIEWER' && status==='SUBMITTED'`(역할 기반), `canApprove`는 `myApprover` 확인 포함): **`canApprove`에 `|| cr.canActAsDelegate` OR 추가**(대리 결재 핵심). `canReview`는 역할 기반이라 검토 대리인도 이미 통과하지만, 대리 여부 뱃지 표시를 위해 `cr.canActAsDelegate` 참조. 대리 케이스면 버튼 옆 "위임 결재"/"위임 검토" 뱃지(기존 뱃지 토큰 재사용).
- **결재자 리스트**: `decidedBy`가 있고 슬롯 주인(name)과 다르면 "{name} — {decidedBy} 대리 결재"로 표기(없으면 기존 그대로).
- 훅 순서·기존 로직 보존. 배너/버튼 스타일 기존 토큰 준수.

- [ ] **Step 3: tsc + build + Commit**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
```bash
git add "apps/web/app/(app)/change-requests/[id]/page.tsx" apps/web/lib/api.ts
git commit -m "feat(web): delegate action buttons + on-behalf display on CR detail"
```

---

### Task 6: 통합 검증

**Files:** 없음(버그 발견 시만 수정).

- [ ] **Step 1: 자동** — `pnpm --filter @dbflow/api test`(전체 GREEN) + `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`.
- [ ] **Step 2: 라이브 E2E**(API 재기동 `lsof -ti tcp:3001 | xargs -r kill -9; ./start.sh --no-install`, 클린 시드 `prisma migrate reset --force`; seed 계정 password `password1234`, 결재자 2번째는 admin `POST /users`로 생성) — 스펙 §9:
  1. **무회귀**: 위임 0건 — 기존 검토→결재→최종 흐름 정상.
  2. 결재자 X가 본인 부재 위임(현재 포함 기간, 대리인 Y=APPROVER) 등록 → Y가 X 지정 PROD CR(검토 승인 후) 결재 → X 슬롯 채워지고 `decidedBy=Y`, 진행률 정상, 최종 승인 도달(정책1이면).
  3. 검토자 부재 위임 → 대리인이 검토 승인, 감사 `onBehalfOf` 기록.
  4. 역할 다른 대리인/자기위임/기간 역전 → 400. 기간 밖 대리 결재 → 403.
  5. ADMIN이 타인 위임 등록 가능, 비-ADMIN은 self 강제(요청 delegatorId 무시).
  6. 대리인 목록/상세에 위임 CR이 **보임**(가시성 C1), 대시보드 "결재 대기"에 대리 대기 반영(myApprovalPending).
  7. 위임 등록/해제 감사(`/audit-logs?action=DELEGATION_UPDATED`) + DELETE 권한(위임자/ADMIN만, 타인 403).
  8. 위임이 만장일치·역할 게이트 우회 안 함(대리도 지정 슬롯만, 인원 수 그대로).
- [ ] **Step 3: 체크리스트 §12**

`docs/feature-checklist.md` §11 뒤(추천 시나리오 앞)에 추가:
```markdown
## 12. 부재 위임 (검토자/결재자)

- [ ] `/delegations` — 검토자·결재자·관리자 접근(그 외 "접근 불가")
- [ ] 본인 부재 위임 등록(대리인=같은 역할, 기간 KST, 사유) · 해제
- [ ] ADMIN은 타인 위임 등록 가능, 비-ADMIN은 본인만(요청 delegatorId 무시)
- [ ] 역할 다른 대리인/자기위임/기간 역전 → 검증 에러
- [ ] **대리 결재**: 위임 기간 중 대리인이 위임자 지정 CR을 결재 → 슬롯 채워지고 "Y (X 대리)" 표기, 진행률 정상
- [ ] **대리 검토**: 대리인이 검토 승인/반려, 감사에 onBehalfOf
- [ ] **가시성**: 대리인 목록/상세에 위임 CR이 보이고, 대시보드 "결재 대기"에 대리 대기 반영
- [ ] 기간 밖에는 대리 불가(403), 위임이 지정 인원·역할 게이트 우회 안 함
- [ ] 위임 등록/해제가 감사(`DELEGATION_UPDATED`)에 남고 필터로 조회
- [ ] 위임 0건이면 기존 검토/결재 동작 그대로(무회귀)
```
```bash
git add docs/feature-checklist.md
git commit -m "docs: add approval delegation to feature checklist (§12)"
```
- [ ] **Step 4: 잔여 정리** — 테스트로 만든 위임 삭제(또는 DB reset).

---

## Self-Review (작성자 확인 완료)

- **스펙 커버리지**: §2 모델→T1, §3 판정/헬퍼→T2, §3 review/approve/가시성/myApprovalPending/canActAsDelegate→T3, §4 API→T2, §5 프론트→T4·T5, §6 감사→T1(enum)·T2(record)·T4(필터), §7 테스트→각 태스크, §9 성공기준→T6. 전 항목 매핑.
- **타입 일관성**: 생성자 `(prisma, audit, policy, delegation)`(T3), `activeDelegatorIds`/`isActiveDelegateFor` 시그니처(T2↔T3), `visibilityWhere(user, delegatorIds)`·`toSummary(row, cur, delegatorIds)`·`toDetail(cr, cur, delegatorIds)` 3인자 확장, KST `parseKst` apply-schedule과 동일.
- **critic 반영 확인**: C1 가시성 OR(T3 S2), I1 comment 주석+decidedBy(T1·T3), I2 review 락(T3 S5), Major1 myApprovalPending 그룹화(T3 S3), Major2 이름 소스(T3 S5·S6), Minor1 status AND(T3 S2), Minor2 review TOCTOU tx내(T3 S5), Minor3 감사키 보존(T3 S5), Minor4 역할가드(T3 S2), Minor5 canActAsDelegate 판정식(T3 S3).
- **주의**: T3는 최대 파급 — spec.ts 생성자 호출부 9곳(grep) + 깨지는 기존 테스트 3종(526행 배열-tx review 감사→submit 재지정, 208/218 visibility OR 재작성, svc/makeService mock에 `$queryRaw` 추가). 사이드바 다중 역할은 이미 지원(critic 확인). T4 `listUsersByRole`는 좁힌 캐스트 필요(tsc).
