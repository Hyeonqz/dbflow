# 커스텀 승인 플로우 (환경별 결재 인원) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결재자 1명 고정을 환경별 필요 결재자 수(N)로 승격하고, 지정 N명 전원 승인 시에만 최종 승인(한 명 반려 시 즉시 반려)되게 한다.

**Architecture:** `ChangeRequest.approverId`(단일 컬럼)를 `ChangeRequestApprover` 조인(decision/comment/decidedAt 통합, 별도 Approval 테이블 없음)으로 교체. `approve()`는 인터랙티브 `$transaction` + `FOR UPDATE` 행 락으로 결정을 기록·재집계해 전원 승인 시에만 전이(경쟁 승인 직렬화). 환경별 `ApprovalPolicy(requiredApprovals)`(기본 1, ADMIN이 PATCH, GET은 로그인 개방)는 제출 시점에 결재자 수를 강제. 무회귀: 기본 1 + 기존 approverId 데이터 마이그레이션 백필.

**Tech Stack:** NestJS 10, Prisma 5(MySQL, raw SQL 데이터 마이그레이션 + `FOR UPDATE`), class-validator, Jest(`new Service(mockPrisma)`). Next.js 14 App Router(프론트 tsc+build+수동).

**참조 스펙:** `docs/superpowers/specs/2026-07-19-dbflow-approval-flow-design.md`

## Global Constraints

- 백엔드 단위테스트: `new Service(mockPrisma)` 직접 생성. 실행 `pnpm --filter @dbflow/api test`.
- 새 런타임 의존성 금지. 프론트 새 라이브러리 금지, 시맨틱 토큰만.
- **무회귀**: 정책 기본 전 환경 `1`; 기존 approverId를 조인 1행으로 백필; schema-diff 경유 생성 무파손(생성 시 approverIds optional, 개수 강제는 submit).
- **승인 성립 기준 = 그 CR의 현재 지정 결재자 수**(정책 아님). 정책은 제출 시 지정 수 검증에만.
- `approve()`는 **인터랙티브 `$transaction` + `FOR UPDATE`**(선례: `apply.service.ts` `startExecution`). submit/review는 기존 배열형 `applyTransition` 존치.
- 재지정 = 조인 행 **전체 교체**(제거된 결재자 결정 함께 삭제).
- 정책 API: `GET /approval-policy` 로그인 개방, `PATCH` **메서드 레벨** `@Roles(ADMIN)`(컨트롤러 레벨 금지). 변경 감사 `APPROVAL_POLICY_UPDATED`.
- 커밋 트레일러: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## 공유 인터페이스

```ts
// @prisma/client (Task 1)
enum ApprovalDecision { APPROVE  REJECT }
// models: ApprovalPolicy(env @unique, requiredApprovals Int), ChangeRequestApprover(changeRequestId, userId, order, decision?, comment?, decidedAt?)
// AuditAction += APPROVAL_POLICY_UPDATED ; AuditTargetType += APPROVAL_POLICY

// ApprovalPolicyService (Task 2)
getRequired(env: TargetEnv): Promise<number>;              // 정책 requiredApprovals, 결손/실패 시 1
list(): Promise<{ env: TargetEnv; requiredApprovals: number }[]>;
update(env: TargetEnv, requiredApprovals: number, actor: AuditActorSnapshot): Promise<void>;

// change-request DTO (Task 3): create/assignees `approverIds?: string[]` (approverId 제거)
// summary(Task 3): approverNames:string[], approvalProgress:{approved,required}, myApprovalPending:boolean
```

---

### Task 1: 스키마 · 마이그레이션(백필→drop→정책 삽입) · 감사 enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_approval_flow/migration.sql` (prisma 생성 후 백필·정책 INSERT 추가)
- Modify: `apps/api/prisma/seed.ts`

**Interfaces:** Produces `ApprovalPolicy`, `ChangeRequestApprover`, `ApprovalDecision`, audit enum 값, DB에 정책 3행 + 기존 approver 백필.

- [ ] **Step 1: 스키마 편집**

`schema.prisma`:
- 추가:
```prisma
enum ApprovalDecision { APPROVE  REJECT }

model ApprovalPolicy {
  id                String    @id @default(cuid())
  env               TargetEnv @unique
  requiredApprovals Int       @default(1)
  updatedAt         DateTime  @updatedAt
  @@map("approval_policy")
}

model ChangeRequestApprover {
  id              String            @id @default(cuid())
  changeRequestId String
  userId          String
  order           Int
  decision        ApprovalDecision?
  comment         String?           @db.Text
  decidedAt       DateTime?
  changeRequest ChangeRequest @relation(fields: [changeRequestId], references: [id], onDelete: Cascade)
  user          User          @relation("assignedApprover", fields: [userId], references: [id])
  @@unique([changeRequestId, userId])
  @@index([userId])
  @@map("change_request_approver")
}
```
- `ChangeRequest`: `approverId String?` 필드와 `approver User? @relation("approver", …)`·`@@index([approverId])` **제거**, `approvers ChangeRequestApprover[]` 추가.
- `User`: `approvingRequests ChangeRequest[] @relation("approver")` **제거**, `assignedApprovals ChangeRequestApprover[] @relation("assignedApprover")` 추가.
- `AuditAction`에 `APPROVAL_POLICY_UPDATED`, `AuditTargetType`에 `APPROVAL_POLICY` 추가.

- [ ] **Step 2: 마이그레이션 생성 (자동 적용 금지 — `--create-only`)**

Run: `pnpm --filter @dbflow/api exec prisma migrate dev --name approval_flow --create-only`
Expected: 마이그레이션 파일만 **생성(미적용)**. `--create-only`가 자동 적용을 막아, 아래 순서 교정·백필 검증을 **적용 전에** 할 수 있다(critic M1: 일반 `migrate dev`는 편집 전 초안을 즉시 적용해 approverId 데이터를 유실시킬 수 있음).

- [ ] **Step 3: 마이그레이션 SQL 순서 교정 + 백필·정책 삽입**

생성된 `migration.sql`을 편집해 **아래 순서를 반드시 보장**한다(critic M1 — 백필이 DROP보다 먼저여야 유실 없음). prisma가 만든 `approverId` 관련 DROP 문들(FK: `DropForeignKey`, 인덱스: `DROP INDEX`, 컬럼: `DROP COLUMN` — 실제 산출물에서 개수 확인)을 **백필 SELECT 뒤로 이동**한다:

**문장 순서 체크리스트(diff로 확인):**
1. `CREATE TABLE change_request_approver …` / `CREATE TABLE approval_policy …`
2. 백필 INSERT…SELECT (아래)
3. `ChangeRequest.approverId` FK/인덱스/컬럼 DROP (prisma 생성분을 여기로 이동)
4. 정책 3행 INSERT (아래)

```sql
-- 2) 백필: 기존 단일 결재자를 조인 1행으로 (DROP 이전!)
INSERT INTO `change_request_approver` (`id`,`changeRequestId`,`userId`,`order`,`decision`,`comment`,`decidedAt`)
SELECT CONCAT('cra_', `id`), `id`, `approverId`, 0, NULL, NULL, NULL
FROM `ChangeRequest` WHERE `approverId` IS NOT NULL;

-- 3) (prisma의 approverId DropForeignKey/DropIndex/DropColumn 문을 여기로 이동)

-- 4) 정책 3행(고정 id, 기본 1)
INSERT INTO `approval_policy` (`id`,`env`,`requiredApprovals`,`updatedAt`) VALUES
 ('ap_dev','DEV',1,NOW(3)),
 ('ap_staging','STAGING',1,NOW(3)),
 ('ap_prod','PROD',1,NOW(3));
```

- [ ] **Step 4: 백필 정확성 검증 (합성 데이터로 — critic M1)**

아직 마이그레이션 미적용(=`approverId` 컬럼 존재). 검증용 합성 CR 1건을 **구 스키마에 삽입** 후 마이그레이션을 적용해 백필이 실제 동작하는지 확인한다. mysql exec로:
```sql
-- 구 스키마(approverId 존재)에 검증 행 삽입: 아무 기존 user id를 approverId로
SET @u := (SELECT id FROM `User` WHERE role='APPROVER' LIMIT 1);
INSERT INTO `ChangeRequest` (`id`,`title`,`description`,`targetEnv`,`status`,`authorId`,`reviewerId`,`approverId`,`createdAt`,`updatedAt`)
VALUES ('cr_backfill_probe','probe','d','DEV','REVIEW_APPROVED',
  (SELECT id FROM `User` WHERE role='DEVELOPER' LIMIT 1),
  (SELECT id FROM `User` WHERE role='REVIEWER' LIMIT 1), @u, NOW(3), NOW(3));
```
Run: `pnpm --filter @dbflow/api exec prisma migrate deploy` (편집한 마이그레이션 적용)
Then 검증:
```sql
SELECT changeRequestId, userId, `order`, decision FROM `change_request_approver` WHERE changeRequestId='cr_backfill_probe';
SELECT env,requiredApprovals FROM `approval_policy`;
SHOW COLUMNS FROM `ChangeRequest` LIKE 'approverId';
```
Expected: 백필 조인 **1행**(`userId=@u, order=0, decision=NULL`), 정책 3행(전부 1), `approverId` 컬럼 없음(빈 결과). ← 백필이 실제로 이관됨을 실증.

- [ ] **Step 4b: 클린 상태 복구**

Run: `pnpm --filter @dbflow/api exec prisma migrate reset --force`
Expected: 전체 재적용 + seed. (probe 행은 reset으로 사라짐 — 정상. 이후 개발/E2E는 클린 DB.)

- [ ] **Step 5: seed.ts 정책 upsert(dev 편의) + 클라이언트 재생성 + Commit**

`seed.ts`에 추가:
```ts
for (const env of ['DEV','STAGING','PROD'] as const) {
  await prisma.approvalPolicy.upsert({ where: { env }, update: {}, create: { env, requiredApprovals: 1 } });
}
```
(reset이 seed도 돌리므로 기존 seed CR/유저는 조인 백필 대상이 아님 — seed는 유저만 만든다.)
Run: `pnpm --filter @dbflow/api exec prisma generate`
```bash
git add apps/api/prisma
git commit -m "feat(api): ApprovalPolicy + ChangeRequestApprover(join with decision), migrate approverId→join, audit enums"
```

---

### Task 2: ApprovalPolicyService · 모듈 · 컨트롤러(GET 개방/PATCH ADMIN)

**Files:**
- Create: `apps/api/src/approval-policy/approval-policy.service.ts` (+ `.spec.ts`)
- Create: `apps/api/src/approval-policy/approval-policy.controller.ts`
- Create: `apps/api/src/approval-policy/approval-policy.module.ts`
- Create: `apps/api/src/approval-policy/dto/update-approval-policy.dto.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:** Produces `getRequired(env)`, `list()`, `update(env, n, actor)`. `ApprovalPolicyModule` exports service. Routes: `GET /approval-policy`(로그인), `PATCH /approval-policy`(ADMIN).

- [ ] **Step 1: 실패 테스트**

`approval-policy.service.spec.ts`:
```ts
import { ApprovalPolicyService } from './approval-policy.service';

describe('ApprovalPolicyService', () => {
  it('getRequired returns policy value, defaults to 1 when missing/failing', async () => {
    const hit: any = { approvalPolicy: { findUnique: () => Promise.resolve({ requiredApprovals: 2 }) } };
    expect(await new ApprovalPolicyService(hit, {} as any).getRequired('PROD' as any)).toBe(2);
    const miss: any = { approvalPolicy: { findUnique: () => Promise.resolve(null) } };
    expect(await new ApprovalPolicyService(miss, {} as any).getRequired('DEV' as any)).toBe(1);
    const boom: any = { approvalPolicy: { findUnique: () => Promise.reject(new Error('x')) } };
    expect(await new ApprovalPolicyService(boom, {} as any).getRequired('DEV' as any)).toBe(1);
  });

  it('update upserts and audits from/to', async () => {
    let up: any = null; const rec: any[] = [];
    const prisma: any = { approvalPolicy: {
      findUnique: () => Promise.resolve({ requiredApprovals: 1 }),
      upsert: (a: any) => { up = a; return Promise.resolve({}); } } };
    const svc = new ApprovalPolicyService(prisma, { record: (i: any) => { rec.push(i); return Promise.resolve(); } } as any);
    await svc.update('PROD' as any, 2, { userId: 'a', name: 'A', role: 'ADMIN', department: '운영팀' });
    expect(up.create).toMatchObject({ env: 'PROD', requiredApprovals: 2 });
    expect(rec[0]).toMatchObject({ action: 'APPROVAL_POLICY_UPDATED', targetType: 'APPROVAL_POLICY' });
    expect(rec[0].metadata).toMatchObject({ env: 'PROD', from: 1, to: 2 });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run `pnpm --filter @dbflow/api test -- approval-policy.service` → FAIL.

- [ ] **Step 3: 서비스 구현**

`approval-policy.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditTargetType, TargetEnv } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';

const ENVS: TargetEnv[] = [TargetEnv.DEV, TargetEnv.STAGING, TargetEnv.PROD];

@Injectable()
export class ApprovalPolicyService {
  private readonly logger = new Logger(ApprovalPolicyService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async getRequired(env: TargetEnv): Promise<number> {
    try {
      const row = await this.prisma.approvalPolicy.findUnique({ where: { env }, select: { requiredApprovals: true } });
      return row?.requiredApprovals ?? 1;
    } catch (err) {
      this.logger.error(`approval policy load failed, default 1: ${(err as Error).message}`);
      return 1;
    }
  }

  async list() {
    const rows = await this.prisma.approvalPolicy.findMany();
    return ENVS.map((env) => ({ env, requiredApprovals: rows.find((r) => r.env === env)?.requiredApprovals ?? 1 }));
  }

  async update(env: TargetEnv, requiredApprovals: number, actor: AuditActorSnapshot) {
    const prev = await this.prisma.approvalPolicy.findUnique({ where: { env }, select: { requiredApprovals: true } });
    await this.prisma.approvalPolicy.upsert({ where: { env }, update: { requiredApprovals }, create: { env, requiredApprovals } });
    await this.audit.record({
      actor, action: AuditAction.APPROVAL_POLICY_UPDATED, targetType: AuditTargetType.APPROVAL_POLICY,
      targetId: env, summary: `결재 정책 변경: ${env} → ${requiredApprovals}명`,
      metadata: { env, from: prev?.requiredApprovals ?? null, to: requiredApprovals },
    });
  }
}
```

- [ ] **Step 4: 통과 확인** — Run `pnpm --filter @dbflow/api test -- approval-policy.service` → PASS.

- [ ] **Step 5: DTO + 컨트롤러 + 모듈**

`dto/update-approval-policy.dto.ts`:
```ts
import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { TargetEnv } from '@prisma/client';
export class UpdateApprovalPolicyDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @IsInt() @Min(1) @Max(5) requiredApprovals!: number;
}
```
`approval-policy.controller.ts` (컨트롤러 레벨 @Roles 금지 — GET 개방):
```ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApprovalPolicyService } from './approval-policy.service';
import { UpdateApprovalPolicyDto } from './dto/update-approval-policy.dto';

@Controller('approval-policy')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ApprovalPolicyController {
  constructor(private readonly svc: ApprovalPolicyService) {}

  @Get()
  list() { return this.svc.list(); }        // 로그인 사용자 누구나(생성 폼용)

  @Patch()
  @Roles(Role.ADMIN)                         // 메서드 레벨 — PATCH만 ADMIN
  update(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateApprovalPolicyDto) {
    return this.svc.update(dto.env, dto.requiredApprovals, {
      userId: user.userId, name: user.name, role: user.role, department: user.department,
    });
  }
}
```
`approval-policy.module.ts` (PassportModule import, providers/exports service, controllers). `app.module.ts` imports에 `ApprovalPolicyModule` 추가.

- [ ] **Step 6: 빌드 + Commit**

Run: `pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/approval-policy apps/api/src/app.module.ts
git commit -m "feat(api): ApprovalPolicy module — open GET, admin PATCH, audited"
```

---

### Task 3: change-request 서비스 다중 결재자 전환 (최대 파급, 인터랙티브 approve)

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Modify: `apps/api/src/change-request/dto/create-change-request.dto.ts`
- Modify: `apps/api/src/change-request/dto/assignees.dto.ts`
- Modify: `apps/api/src/change-request/change-request.module.ts`
- Modify: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:**
- Consumes: `ApprovalPolicyService.getRequired` (Task 2), `ChangeRequestApprover`/`ApprovalDecision` (Task 1).
- Produces: 서비스가 approverIds(다중)·approve 수집을 처리. summary에 `approverNames`/`approvalProgress`/`myApprovalPending`.

- [ ] **Step 1: DTO 변경**

`create-change-request.dto.ts`: `reviewerId?`는 유지, `approverId?` 제거 → 추가:
```ts
  @IsOptional() @IsArray() @IsString({ each: true })
  approverIds?: string[];
```
`assignees.dto.ts`: `approverId?` 제거 → `@IsOptional() @IsArray() @IsString({ each: true }) approverIds?: string[];`

- [ ] **Step 2: 서비스 — 읽기/지정 플러밍 (approverId → approvers 조인)**

`change-request.service.ts`:
- 생성자에 `private readonly policy: ApprovalPolicyService` 추가(import), `change-request.module.ts`에 `ApprovalPolicyModule` import.
- `DETAIL_INCLUDE`: `approver: {…}` 제거 → 추가:
  ```ts
  approvers: { orderBy: { order: 'asc' }, select: { userId: true, order: true, decision: true, comment: true, decidedAt: true, user: { select: { name: true, department: true } } } },
  ```
- `SUMMARY_SELECT`: `approverId: true`·`approver: {…}` 제거 → 추가:
  ```ts
  approvers: { orderBy: { order: 'asc' }, select: { userId: true, decision: true, user: { select: { name: true } } } },
  ```
- `getOrThrow` select: `approverId: true` 제거(approve가 자체 트랜잭션에서 재조회하므로 불필요), `reviewerId`·`authorId`·`status`·`id` 유지.
- `assertAssigneeRoles(reviewerId, approverIds)` 배치화:
  ```ts
  private async assertAssigneeRoles(reviewerId?: string | null, approverIds?: string[] | null) {
    if (reviewerId) {
      const r = await this.prisma.user.findUnique({ where: { id: reviewerId }, select: { role: true } });
      if (!r || r.role !== Role.REVIEWER) throw new BadRequestException('검토자는 REVIEWER여야 합니다.');
    }
    if (approverIds && approverIds.length) {
      if (new Set(approverIds).size !== approverIds.length) throw new BadRequestException('결재자가 중복되었습니다.');
      const rows = await this.prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, role: true } });
      if (rows.length !== approverIds.length || rows.some((u) => u.role !== Role.APPROVER))
        throw new BadRequestException('결재자는 모두 APPROVER여야 합니다.');
    }
  }
  ```
- `create`: `assertAssigneeRoles(dto.reviewerId, dto.approverIds)`; data에서 `approverId` 제거 → `approvers: { create: (dto.approverIds ?? []).map((userId, i) => ({ userId, order: i })) }`; 감사 metadata `approverIds: dto.approverIds`.
- `toSummary(row, currentUserId: string)`:
  ```ts
  private toSummary(row: SummaryPayload, currentUserId: string) {
    const { author, reviewer, approvers, ...rest } = row;
    const approved = approvers.filter((a) => a.decision === 'APPROVE').length;
    return {
      ...rest,
      authorName: author?.name ?? null,
      reviewerName: reviewer?.name ?? null,
      approverNames: approvers.map((a) => a.user?.name ?? null),
      approvalProgress: { approved, required: approvers.length },
      myApprovalPending:
        rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
        approvers.some((a) => a.userId === currentUserId && a.decision === null),
    };
  }
  ```
  `list(user)` → `rows.map((r) => this.toSummary(r, user.userId))`.
- `toDetail`: `approver` 구조분해 → `approvers`; 평탄화 `approvers: approvers.map(a => ({ userId: a.userId, name: a.user?.name ?? null, department: a.user?.department ?? null, order: a.order, decision: a.decision, comment: a.comment, decidedAt: a.decidedAt }))`. `approverName` 제거.
- `submit`: 지정 결재자 수 검증 추가(지역변수는 `changeRequest` — getOrThrow 반환). `getOrThrow` select에 `targetEnv: true` 추가 선행:
  ```ts
    const required = await this.policy.getRequired(changeRequest.targetEnv);
    const count = await this.prisma.changeRequestApprover.count({ where: { changeRequestId: id } });
    if (!changeRequest.reviewerId || count !== required)
      throw new BadRequestException(`제출하려면 검토자 1명과 결재자 ${required}명을 지정해야 합니다.`);
  ```
  (기존 `if (!changeRequest.reviewerId || !changeRequest.approverId)` 블록을 위로 교체.)
- `visibilityWhere` APPROVER: `return { approvers: { some: { userId: user.userId } }, status: { not: ChangeRequestStatus.DRAFT } };`
- `setAssignees(user, id, dto: { reviewerId?: string; approverIds?: string[] })`: 권한 체크 그대로. `assertAssigneeRoles(dto.reviewerId, dto.approverIds)`. 교체:
  ```ts
    await this.prisma.$transaction(async (tx) => {
      if (dto.reviewerId !== undefined) await tx.changeRequest.update({ where: { id }, data: { reviewerId: dto.reviewerId } });
      if (dto.approverIds !== undefined) {
        await tx.changeRequestApprover.deleteMany({ where: { changeRequestId: id } });
        await tx.changeRequestApprover.createMany({ data: dto.approverIds.map((userId, i) => ({ changeRequestId: id, userId, order: i })) });
      }
    });
  ```
  감사 metadata `{ reviewerId, approverIds }`.

- [ ] **Step 3: 서비스 — approve() 인터랙티브 재작성 (핵심)**

`approve`를 교체(import: `ApprovalDecision`, `ConflictException`):
```ts
  async approve(actor: CurrentUserPayload, id: string, dto: DecisionDto) {
    const authorId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ChangeRequest WHERE id = ${id} FOR UPDATE`;
      const cr = await tx.changeRequest.findUnique({ where: { id }, select: { id: true, status: true, authorId: true } });
      if (!cr) throw new NotFoundException('변경요청을 찾을 수 없습니다.');
      if (cr.status !== ChangeRequestStatus.REVIEW_APPROVED)
        throw new ConflictException(`현재 상태(${cr.status})에서는 결재할 수 없습니다.`);
      const mine = await tx.changeRequestApprover.findUnique({
        where: { changeRequestId_userId: { changeRequestId: id, userId: actor.userId } },
      });
      if (!mine) throw new ForbiddenException('지정된 결재자만 결재할 수 있습니다.');
      if (mine.decision !== null) throw new ConflictException('이미 결재하셨습니다.');

      const decision: ApprovalDecision = dto.decision === Decision.APPROVE ? ApprovalDecision.APPROVE : ApprovalDecision.REJECT;
      await tx.changeRequestApprover.update({
        where: { id: mine.id }, data: { decision, comment: dto.comment ?? null, decidedAt: new Date() },
      });

      const all = await tx.changeRequestApprover.findMany({ where: { changeRequestId: id }, select: { decision: true } });
      const approved = all.filter((a) => a.decision === ApprovalDecision.APPROVE).length;
      const progress = `${approved}/${all.length}`;
      const transition = decision === ApprovalDecision.REJECT ? 'FINAL_REJECT'
        : approved === all.length ? 'FINAL_APPROVE' : null;

      if (transition) {
        const toStatus = getNextStatus(cr.status, transition);
        await tx.changeRequest.update({ where: { id }, data: { status: toStatus } });
        await tx.statusHistory.create({ data: { changeRequestId: id, fromStatus: cr.status, toStatus, actorId: actor.userId, comment: dto.comment ?? null } });
      }
      await tx.auditLog.create({ data: this.audit.buildData({
        actor, action: AuditAction.CR_APPROVED, targetType: AuditTargetType.CHANGE_REQUEST, targetId: id,
        summary: transition === 'FINAL_APPROVE' ? `최종 승인 (CR ${id})` : transition === 'FINAL_REJECT' ? `최종 반려 (CR ${id})` : `결재 진행 ${progress} (CR ${id})`,
        metadata: { decision, progress, comment: dto.comment ?? undefined },
      }) });
      return cr.authorId;
    });
    return this.findOne({ userId: authorId, role: Role.DEVELOPER }, id);
  }
```

- [ ] **Step 4: 테스트 재작성 + 신규 (RED→GREEN)**

**깨지는 기존 테스트 6종을 반드시 함께 수정한다(critic M2 — 이걸 놓치면 스위트 적색):**
1. **생성자 3인자 일괄 치환**: `new ChangeRequestService(prisma, audit)` 모든 호출부(`makeService`, `svc()` 헬퍼, applyTransition-audit 테스트 등)를 `(prisma, audit, policyMock)`으로. `policyMock = { getRequired: () => Promise.resolve(1) }`.
2. **applyTransition-audit 테스트("tx 배열 길이 3" 단언)**: approve를 호출하던 케이스 → 이제 approve는 배열이 아닌 함수 tx라 무효. 이 단언은 **submit/review 경로로 이동**하거나(applyTransition은 submit/review에 존치) approve용을 삭제하고 아래 신규 approve 테스트로 대체.
3. **assignment-gates "rejects approve by a non-assigned approver"**: `svc()` 헬퍼의 prisma mock에 `$transaction(fn)`·`$queryRaw`·`changeRequestApprover.findUnique`를 추가(아래 `txPrisma` 패턴 사용). 미지정자 → ForbiddenException 유지.
4. **display-name 테스트 2종(`toSummary`/`toDetail` fallback)**: findMany/findFirst mock 반환에 **`approvers: []`**(또는 `[{userId, decision, user:{name}}]`)를 추가. 없으면 `approvers.filter/map`에서 TypeError.
5. **visibility "APPROVER" 단언**: 기대값 `{approverId:'boss'}` → **`{ approvers: { some: { userId: 'boss' } }, status: { not: 'DRAFT' } }`**.
6. **submit 해피패스**: mock prisma에 `changeRequestApprover.count`(정책 수와 일치하는 값) 추가 + getOrThrow stored에 `targetEnv` + 생성자 policyMock.

신규 케이스(핵심):
```ts
// helper: 인터랙티브 $transaction mock
function txPrisma(state) {
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    changeRequest: {
      findUnique: () => Promise.resolve(state.cr),
      update: (a) => { state.cr.status = a.data.status; return Promise.resolve({}); },
    },
    changeRequestApprover: {
      findUnique: ({ where }) => Promise.resolve(state.approvers.find((x) => x.userId === where.changeRequestId_userId.userId) ?? null),
      update: ({ where, data }) => { const r = state.approvers.find((x) => x.id === where.id); Object.assign(r, data); return Promise.resolve({}); },
      findMany: () => Promise.resolve(state.approvers),
    },
    statusHistory: { create: () => Promise.resolve({}) },
    auditLog: { create: (a) => a },
  };
  return { $transaction: (fn) => fn(tx), changeRequest: { findFirst: () => Promise.resolve({ id: state.cr.id, files: [], statusHistory: [], author: {name:'A'}, reviewer: null, approvers: state.approvers }) } };
}

it('transitions to FINAL_APPROVED only when all assigned approvers approved', async () => {
  const state = { cr: { id:'c1', status:'REVIEW_APPROVED', authorId:'a' }, approvers: [
    { id:'x1', userId:'p1', decision:null }, { id:'x2', userId:'p2', decision:'APPROVE' } ] };
  const svc = new ChangeRequestService(txPrisma(state) as any, { buildData: (x)=>x } as any, {} as any);
  await svc.approve({ userId:'p1', role:'APPROVER', name:'P1', department:'d' } as any, 'c1', { decision:'APPROVE' } as any);
  expect(state.cr.status).toBe('FINAL_APPROVED');
});

it('stays REVIEW_APPROVED on partial approval', async () => {
  const state = { cr:{ id:'c1', status:'REVIEW_APPROVED', authorId:'a' }, approvers:[
    { id:'x1', userId:'p1', decision:null }, { id:'x2', userId:'p2', decision:null } ] };
  const svc = new ChangeRequestService(txPrisma(state) as any, { buildData:(x)=>x } as any, {} as any);
  await svc.approve({ userId:'p1', role:'APPROVER', name:'P1', department:'d' } as any, 'c1', { decision:'APPROVE' } as any);
  expect(state.cr.status).toBe('REVIEW_APPROVED');
});

it('rejects immediately on any REJECT', async () => {
  const state = { cr:{ id:'c1', status:'REVIEW_APPROVED', authorId:'a' }, approvers:[
    { id:'x1', userId:'p1', decision:null }, { id:'x2', userId:'p2', decision:'APPROVE' } ] };
  const svc = new ChangeRequestService(txPrisma(state) as any, { buildData:(x)=>x } as any, {} as any);
  await svc.approve({ userId:'p1', role:'APPROVER', name:'P1', department:'d' } as any, 'c1', { decision:'REJECT' } as any);
  expect(state.cr.status).toBe('FINAL_REJECTED');
});

it('rejects a non-assigned approver (403) and a double decision (409)', async () => {
  const base = () => ({ cr:{ id:'c1', status:'REVIEW_APPROVED', authorId:'a' }, approvers:[{ id:'x1', userId:'p1', decision:null }] });
  const s1 = base(); const svc1 = new ChangeRequestService(txPrisma(s1) as any, { buildData:(x)=>x } as any, {} as any);
  await expect(svc1.approve({ userId:'nope', role:'APPROVER' } as any, 'c1', { decision:'APPROVE' } as any)).rejects.toBeTruthy();
  const s2 = base(); s2.approvers[0].decision = 'APPROVE';
  const svc2 = new ChangeRequestService(txPrisma(s2) as any, { buildData:(x)=>x } as any, {} as any);
  await expect(svc2.approve({ userId:'p1', role:'APPROVER' } as any, 'c1', { decision:'APPROVE' } as any)).rejects.toBeTruthy();
});
```
(생성자 인자는 `(prisma, audit, policy)` 순 — 기존 `new ChangeRequestService(prisma, audit)` 호출을 전부 `(prisma, audit, policyMock)`로 갱신. submit 테스트의 policy mock은 `{ getRequired: () => Promise.resolve(1) }`.)

- [ ] **Step 5: 전체 스위트 + 빌드**

Run: `pnpm --filter @dbflow/api test && pnpm --filter @dbflow/api build`
Expected: 전체 GREEN(기존 단일-결재 시나리오는 approvers 1행으로 재현) + 컴파일 성공.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/change-request
git commit -m "feat(api): multi-approver assignment + unanimous approval collection (interactive tx + FOR UPDATE)"
```

---

### Task 4: 프론트 — 결재 정책 페이지 + API + 네비 + 감사 옵션

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/app/(app)/approval-policy/page.tsx`
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/icons.tsx`
- Modify: `apps/web/app/(app)/audit/page.tsx`

**Interfaces:** Consumes `GET/PATCH /approval-policy`.

- [ ] **Step 1: api 클라이언트**

`lib/api.ts`:
```ts
export type ApprovalPolicyRow = { env: 'DEV'|'STAGING'|'PROD'; requiredApprovals: number };
export function listApprovalPolicy() { return apiFetch<ApprovalPolicyRow[]>(`/approval-policy`); }
export function updateApprovalPolicy(env: string, requiredApprovals: number) {
  return apiFetch<unknown>(`/approval-policy`, { method: 'PATCH', body: JSON.stringify({ env, requiredApprovals }) });
}
```

- [ ] **Step 2: 감사 필터 옵션**

`audit/page.tsx`: `ACTION_OPTIONS`에 `'APPROVAL_POLICY_UPDATED'`, `TARGET_TYPE_OPTIONS`에 `'APPROVAL_POLICY'` 추가.

- [ ] **Step 3: 정책 페이지**

`app/(app)/approval-policy/page.tsx`: `useUser()` ADMIN 아니면 "접근 불가". `PageHeader title="결재 정책"`. `listApprovalPolicy()` 로드 → 표(환경 / 필요 결재자 수 `<input type=number min=1 max=5>` 또는 select 1~5). 변경 시 `updateApprovalPolicy(env, n)` 낙관적 반영 + 실패 시 되돌림·에러 배너. sql-review 페이지 패턴·토큰 재사용.

- [ ] **Step 4: 사이드바 + 아이콘**

`sidebar.tsx`: ADMIN 네비 `{ href:'/approval-policy', label:'결재 정책', Icon: UsersCheckIcon, roles:['ADMIN'] }`(SQL 리뷰 정책 옆). `icons.tsx`: `UsersCheckIcon` 기존 스타일로 추가.

- [ ] **Step 5: tsc + build + Commit**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
```bash
git add apps/web/lib/api.ts "apps/web/app/(app)/approval-policy" apps/web/components/sidebar.tsx apps/web/components/icons.tsx "apps/web/app/(app)/audit/page.tsx"
git commit -m "feat(web): admin approval policy page, nav, audit filter options"
```

---

### Task 5: 프론트 — 생성 폼 N개 결재자 + 상세 결재 진행 + 대시보드 KPI

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/(app)/change-requests/new/page.tsx`
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx`
- Modify: `apps/web/app/(app)/dashboard/page.tsx`

**Interfaces:** Consumes 다중 결재자 summary/detail(Task 3), `listApprovalPolicy`(Task 4).

- [ ] **Step 1: api 타입 갱신**

`lib/api.ts`: `ChangeRequestSummary`에서 `approverId`/`approverName` 제거 → `approverNames: (string|null)[]`, `approvalProgress: { approved: number; required: number }`, `myApprovalPending: boolean` 추가. `ChangeRequestDetail`(또는 상세 타입)에서 단일 `approverId/approverName` → `approvers: { userId: string; name: string|null; department: string|null; order: number; decision: 'APPROVE'|'REJECT'|null; comment: string|null; decidedAt: string|null }[]`. `CreateChangeRequestInput.approverId` → `approverIds?: string[]`. `setAssignees` 인자 `approverIds?: string[]`.

- [ ] **Step 2: 생성 폼 — N개 결재자 셀렉트**

`new/page.tsx`: 마운트/환경변경 시 `listApprovalPolicy()`로 대상환경의 `requiredApprovals`(N) 조회 → 결재자 셀렉트를 **N개** 렌더(각 `listUsersByRole('APPROVER')`, 중복 선택 방지). state `approverIds: string[]`. 제출 검증: N개 전부 선택. `createChangeRequest`에 `approverIds` 전달.

- [ ] **Step 3: 상세 — 결재 진행 UI**

`[id]/page.tsx`: 단일 `approverName`/`approverId` 사용부를 `cr.approvers`로 교체. 결재자 리스트(이름·부서 + 상태 뱃지: 승인/반려/대기), 진행률 배지(`approvalProgress` 또는 `approved/total`). 내 결정 버튼: 내가 `approvers`에 있고 `decision===null`이며 상태 `REVIEW_APPROVED`면 승인/반려 노출(결정했으면 내 결정 표시). `AssigneePanel`의 단일 결재자 셀렉트 → N개 배열(재지정 `setAssignees({approverIds})`).

- [ ] **Step 4: 대시보드 KPI — myApprovalPending**

`dashboard/page.tsx`: `CardDef.match` 시그니처를 `(status: ChangeRequestStatus) => boolean`에서 **요약 행 전체를 받도록** 확장(`(cr: ChangeRequestSummary) => boolean`). **호출부 2곳 모두 교체**: KPI 카드 집계의 `c.match(it.status)` → `c.match(it)`, 그리고 `buildSummary`/focus 카드의 `focus.match(it.status)` → `focus.match(it)`. `CARDS_BY_ROLE`의 **모든 카드**(3역할 전체) 화살표를 `(s) => s === …`에서 `(cr) => cr.status === …`로 바꾼다(tsc가 미변경분을 잡음). APPROVER "결재 대기" 카드만 `(cr) => cr.myApprovalPending`으로 교체. (`change-requests/page.tsx`의 `FILTERS.match`는 목록 필터로 여기선 미변경 — 목록은 status 필터 유지.)

- [ ] **Step 5: tsc + build + Commit**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
```bash
git add apps/web
git commit -m "feat(web): N-approver create form, approval progress detail, myApprovalPending KPI"
```

---

### Task 6: 통합 검증

**Files:** 없음

- [ ] **Step 1: 백엔드 전체 테스트** — Run `pnpm --filter @dbflow/api test` → 전체 PASS.
- [ ] **Step 2: 프론트 빌드** — Run `pnpm --filter @dbflow/web build` → `/approval-policy` 포함 컴파일, tsc 0.
- [ ] **Step 3: 라이브 E2E(수동, api 새 코드 재기동: `lsof -ti tcp:3001 | xargs -r kill -9; ./start.sh --no-install`)**
  - **무회귀**: 정책 전부 1 상태에서 기존 흐름(개발자 생성→검토→결재 1명→최종승인) 그대로 동작.
  - admin이 `/approval-policy`에서 PROD=2 설정(감사 `APPROVAL_POLICY_UPDATED` 기록, dev PATCH 403).
  - 개발자가 PROD 대상 CR을 결재자 2명 지정해 생성·제출(1명만 지정 시 제출 400).
  - 검토 승인 후: 결재자 A 승인 → 상태 `REVIEW_APPROVED` 유지, 상세 "결재 1/2". 결재자 B 승인 → `FINAL_APPROVED`.
  - 다른 CR: A 승인 후 B **반려** → 즉시 `FINAL_REJECTED`.
  - 미지정 사용자 결재 403, 같은 결재자 재결재 409.
  - A 대시보드: 자신이 승인 끝낸 "결재 1/2" CR이 "결재 대기"에 안 잡힘(myApprovalPending).
  - `--seed` 없이 재기동해도 `approval_policy` 3행 유지.
- [ ] **Step 4: 최종 커밋(있으면)** — `git add -A && git commit -m "chore: approval flow integration verified" || true`

---

## Self-Review (작성자 확인 완료)

- **스펙 커버리지**: §3 모델/마이그레이션→T1, §6 정책 API→T2, §4 approve 수집+§5 create/submit/reassign+§7 summary/visibility→T3, §6 UI+감사옵션→T4, §7 생성폼/상세/KPI→T5. 전 항목 매핑.
- **플레이스홀더**: 각 코드 스텝에 실제 코드. approve 인터랙티브 tx·마이그레이션 백필 순서·N+1 배치화 구체화.
- **타입 일관성**: `approverIds`·`approvers`·`approvalProgress`·`myApprovalPending`·`getRequired`·생성자 `(prisma, audit, policy)`가 T1~T5 일치. `CardDef.match` 시그니처 확장(T5-4)을 명시.
- **무회귀 이중 보장**: T1 백필+정책1, T3 기존 단일-결재 테스트를 approvers 1행으로 재현, T6 라이브 무회귀.
- **주의**: T3는 `change-request.service.spec.ts`에서 (a) 생성자 3번째 인자(policy mock) 추가, (b) approve 테스트를 인터랙티브 tx mock으로 재작성, (c) submit 테스트에 policy.getRequired mock — 세 가지를 함께 해야 스위트가 통과. 마이그레이션(T1)은 **백필→drop 순서**가 유실 방지 핵심.
