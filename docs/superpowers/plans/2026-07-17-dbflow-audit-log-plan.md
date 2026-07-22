# 감사 로그(Audit Log) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DBFlow의 모든 의미 있는 변경·인증 이벤트(성공·실패)를 불변(append-only + DB 트리거) AuditLog에 서비스 레벨에서 기록하고, ADMIN이 조회·내보내기할 수 있게 한다.

**Architecture:** 신규 `@Global() AuditModule`이 `AuditService`(`buildData`/`record`)를 제공한다. 성공 이벤트는 각 도메인 서비스에서 명시 기록(CR 상태전이는 기존 `$transaction` 배열에 넣어 원자적, apply/rollback은 Execution 확정 후 best-effort). 보안 실패(로그인 실패·403)는 글로벌 `AuditExceptionFilter`가 기록. actor 스냅샷은 `JwtStrategy.validate` 반환 확장으로 추가 쿼리 없이 확보.

**Tech Stack:** NestJS 10, Prisma 5 (MySQL, raw SQL 트리거), class-validator, Jest(`new Service(mockPrisma)` 패턴). Next.js 14 App Router(프론트는 test 인프라 없음 → `tsc --noEmit` + build + 수동 확인).

**참조 스펙:** `docs/superpowers/specs/2026-07-17-dbflow-audit-log-design.md`

## Global Constraints

- 백엔드 단위테스트: `new Service(mockPrisma)` 직접 생성(Nest TestingModule 없음). 실행 `pnpm --filter @dbflow/api test`.
- 새 런타임 의존성 금지(CSV는 수기 직렬화). 프론트 새 라이브러리 금지, 시맨틱 토큰만.
- **민감정보 절대 미기록**: 대상DB 비밀번호/passwordEnc, SQL 본문(참조만).
- AuditLog는 **수정·삭제 API/서비스 메서드 없음**. DB 트리거로 UPDATE/DELETE 물리 차단.
- CR 상태전이 audit은 `applyTransition`의 `$transaction([...])` 배열 **안**에 넣는다(원자성). apply/rollback audit은 Execution 확정 **후** best-effort(원격 DB라 원자성 불가; Execution이 증빙).
- actor 스냅샷은 `request.user`(=CurrentUserPayload 확장)에서 전달. JWT 토큰 payload는 확장하지 않는다.
- 커밋 트레일러: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 마이그레이션: `pnpm --filter @dbflow/api exec prisma migrate dev --name <name>`.

## 공유 인터페이스 (전 태스크 공통)

```ts
// src/audit/audit.types.ts (Task 2에서 생성)
export type AuditActorSnapshot = {
  userId?: string | null; name?: string | null;
  role?: string | null; department?: string | null;
};
export type AuditInput = {
  actor?: AuditActorSnapshot | null;
  action: AuditAction;                    // @prisma/client enum
  targetType: AuditTargetType;            // @prisma/client enum
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  outcome?: AuditOutcome;                 // default SUCCESS
  ip?: string | null;
  userAgent?: string | null;
};
// AuditService.buildData(input): Prisma.AuditLogUncheckedCreateInput   // 트랜잭션 배열용
// AuditService.record(input): Promise<void>                            // best-effort(내부 try/catch)
```

`CurrentUserPayload`(Task 3에서 확장) = `{ userId: string; role: Role; name: string; department: string }`.

---

### Task 1: AuditLog 스키마 · 마이그레이션 · 변조차단 트리거

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_audit_log/migration.sql` (prisma 생성 후 트리거 SQL 수동 추가)

**Interfaces:**
- Produces: `AuditLog` 모델, enums `AuditAction`/`AuditTargetType`/`AuditOutcome`.

- [ ] **Step 1: 스키마에 enum + 모델 추가**

`apps/api/prisma/schema.prisma` 끝에 추가:
```prisma
enum AuditAction {
  LOGIN_SUCCESS
  LOGIN_FAILURE
  ACCESS_DENIED
  USER_CREATED
  USER_PROFILE_UPDATED
  CR_CREATED
  CR_SUBMITTED
  CR_REVIEWED
  CR_APPROVED
  CR_ASSIGNEES_CHANGED
  CR_APPLIED
  CR_ROLLED_BACK
  TARGET_DB_CREATED
  TARGET_DB_UPDATED
  TARGET_DB_DELETED
}

enum AuditTargetType { CHANGE_REQUEST  USER  TARGET_DATABASE  EXECUTION  AUTH }
enum AuditOutcome    { SUCCESS  FAILURE }

model AuditLog {
  id         String          @id @default(cuid())
  createdAt  DateTime        @default(now())
  actorId    String?
  actorName  String?
  actorRole  String?
  actorDept  String?
  action     AuditAction
  targetType AuditTargetType
  targetId   String?
  summary    String          @db.Text
  metadata   Json?
  outcome    AuditOutcome    @default(SUCCESS)
  ip         String?
  userAgent  String?         @db.Text

  @@index([createdAt])
  @@index([actorId])
  @@index([action])
  @@index([targetType, targetId])
  @@map("audit_log")
}
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm --filter @dbflow/api exec prisma migrate dev --name audit_log`
Expected: `audit_log` 테이블 생성 마이그레이션 + 적용.

- [ ] **Step 3: 트리거 SQL을 마이그레이션 파일에 추가**

방금 생성된 `migration.sql` 끝에 append(그리고 재적용):
```sql
DROP TRIGGER IF EXISTS audit_log_no_update;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON `audit_log`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';

DROP TRIGGER IF EXISTS audit_log_no_delete;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON `audit_log`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
```
트리거는 prisma가 재실행하지 않으므로 직접 적용: `pnpm --filter @dbflow/api exec prisma migrate reset --force` (dev, seed 재생성) 하거나, `docker compose -f docker/docker-compose.yml exec -T mysql mysql -udbflow -pdbflow dbflow < <(그 SQL)`. **권장: reset --force**(트리거 포함 전체 재적용 + seed).

- [ ] **Step 4: 트리거 동작 확인**

Run: `docker compose -f docker/docker-compose.yml exec -T mysql mysql -udbflow -pdbflow dbflow -e "INSERT INTO audit_log (id,createdAt,action,targetType,summary,outcome) VALUES ('t1',NOW(),'LOGIN_SUCCESS','AUTH','x','SUCCESS'); UPDATE audit_log SET summary='y' WHERE id='t1';"`
Expected: INSERT 성공, UPDATE는 `ERROR 1644 ... audit_log is append-only`. 이후 `DELETE FROM audit_log WHERE id='t1'`도 동일 차단됨(확인 후 무시 — 삭제 안 되므로 테스트 행은 남음, 무해).

- [ ] **Step 5: 클라이언트 재생성 + Commit**

```bash
pnpm --filter @dbflow/api exec prisma generate
git add apps/api/prisma
git commit -m "feat(api): AuditLog append-only model with tamper-blocking triggers"
```

---

### Task 2: AuditService + AuditModule (@Global)

**Files:**
- Create: `apps/api/src/audit/audit.types.ts`
- Create: `apps/api/src/audit/audit.service.ts`
- Create: `apps/api/src/audit/audit.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/audit/audit.service.spec.ts`

**Interfaces:**
- Consumes: `AuditLog` 모델·enums (Task 1).
- Produces: `AuditService.buildData(input: AuditInput): Prisma.AuditLogUncheckedCreateInput`, `AuditService.record(input: AuditInput): Promise<void>`. `@Global() AuditModule` exports `AuditService`.

- [ ] **Step 1: 타입 파일**

`apps/api/src/audit/audit.types.ts`:
```ts
import { AuditAction, AuditTargetType, AuditOutcome } from '@prisma/client';

export type AuditActorSnapshot = {
  userId?: string | null; name?: string | null;
  role?: string | null; department?: string | null;
};

export type AuditInput = {
  actor?: AuditActorSnapshot | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  outcome?: AuditOutcome;
  ip?: string | null;
  userAgent?: string | null;
};
```

- [ ] **Step 2: 실패 테스트 (buildData 매핑 + record가 예외를 삼킴)**

`apps/api/src/audit/audit.service.spec.ts`:
```ts
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('buildData maps actor snapshot and defaults outcome to SUCCESS', () => {
    const svc = new AuditService({} as any);
    const data = svc.buildData({
      actor: { userId: 'u1', name: '개발자', role: 'DEVELOPER', department: '개발팀' },
      action: 'CR_APPROVED' as any, targetType: 'CHANGE_REQUEST' as any,
      targetId: 'c1', summary: '승인',
    });
    expect(data).toMatchObject({
      actorId: 'u1', actorName: '개발자', actorRole: 'DEVELOPER', actorDept: '개발팀',
      action: 'CR_APPROVED', targetType: 'CHANGE_REQUEST', targetId: 'c1',
      summary: '승인', outcome: 'SUCCESS',
    });
  });

  it('record swallows persistence errors (audit must never break the caller)', async () => {
    const prisma: any = { auditLog: { create: () => Promise.reject(new Error('db down')) } };
    const svc = new AuditService(prisma);
    await expect(svc.record({ action: 'LOGIN_SUCCESS' as any, targetType: 'AUTH' as any, summary: 'x' }))
      .resolves.toBeUndefined();
  });

  it('record persists via buildData', async () => {
    let captured: any = null;
    const prisma: any = { auditLog: { create: (a: any) => { captured = a; return Promise.resolve({}); } } };
    const svc = new AuditService(prisma);
    await svc.record({ action: 'USER_CREATED' as any, targetType: 'USER' as any, targetId: 'u9', summary: '생성' });
    expect(captured.data).toMatchObject({ action: 'USER_CREATED', targetId: 'u9', outcome: 'SUCCESS' });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @dbflow/api test -- audit.service`
Expected: FAIL (AuditService 미존재).

- [ ] **Step 4: AuditService 구현**

`apps/api/src/audit/audit.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditInput } from './audit.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** 트랜잭션 배열($transaction)에 넣을 create data를 만든다. */
  buildData(input: AuditInput): Prisma.AuditLogUncheckedCreateInput {
    return {
      actorId: input.actor?.userId ?? null,
      actorName: input.actor?.name ?? null,
      actorRole: input.actor?.role ?? null,
      actorDept: input.actor?.department ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      summary: input.summary,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      outcome: input.outcome ?? AuditOutcome.SUCCESS,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    };
  }

  /** best-effort 기록 — 감사 실패가 호출자를 절대 깨뜨리지 않는다. */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.buildData(input) });
    } catch (err) {
      this.logger.error(`audit record failed: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test -- audit.service`
Expected: PASS

- [ ] **Step 6: @Global AuditModule + AppModule 등록**

`apps/api/src/audit/audit.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}
```
`apps/api/src/app.module.ts` imports에 `AuditModule` 추가(맨 앞).

- [ ] **Step 7: 빌드 + Commit**

Run: `pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/audit apps/api/src/app.module.ts
git commit -m "feat(api): global AuditService with buildData and best-effort record"
```

---

### Task 3: actor 스냅샷 — CurrentUserPayload 확장

**Files:**
- Modify: `apps/api/src/auth/current-user.decorator.ts`
- Modify: `apps/api/src/auth/jwt.strategy.ts`

**Interfaces:**
- Produces: `CurrentUserPayload = { userId: string; role: Role; name: string; department: string }`.

- [ ] **Step 1: CurrentUserPayload 확장**

`current-user.decorator.ts`의 인터페이스:
```ts
export interface CurrentUserPayload {
  userId: string;
  role: Role;
  name: string;
  department: string;
}
```

- [ ] **Step 2: JwtStrategy.validate 반환 확장 (추가 쿼리 없음)**

`jwt.strategy.ts`의 `validate`는 이미 `findById`로 User 전체를 로드한다. 반환을 교체:
```ts
  async validate(payload: { sub: string; role: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return { userId: user.id, role: user.role, name: user.name, department: user.department };
  }
```

- [ ] **Step 3: 빌드 확인**

Run: `pnpm --filter @dbflow/api build`
Expected: 성공(타입 확장이 기존 사용처와 호환 — 기존은 userId/role만 읽음).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/current-user.decorator.ts apps/api/src/auth/jwt.strategy.ts
git commit -m "feat(api): carry name/department in request.user for audit snapshots"
```

---

### Task 4: AuditExceptionFilter — 로그인 실패 · 권한거부

**Files:**
- Create: `apps/api/src/audit/audit-exception.filter.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/audit/audit-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `AuditService.record` (Task 2), `CurrentUserPayload` (Task 3).
- Produces: 글로벌 필터가 `UnauthorizedException`(로그인) → `LOGIN_FAILURE`, `ForbiddenException` → `ACCESS_DENIED` 기록 후 예외 재던짐.

- [ ] **Step 1: 실패 테스트**

`apps/api/src/audit/audit-exception.filter.spec.ts`:
```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuditExceptionFilter } from './audit-exception.filter';

function ctx(req: any) {
  const res = { }; // 응답은 재던짐 경로로 위임하므로 미사용
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

describe('AuditExceptionFilter', () => {
  it('records LOGIN_FAILURE for UnauthorizedException on /auth/login', () => {
    const records: any[] = [];
    const audit: any = { record: (i: any) => { records.push(i); return Promise.resolve(); } };
    const filter = new AuditExceptionFilter(audit);
    expect(() =>
      filter.catch(new UnauthorizedException('bad'), ctx({ method: 'POST', url: '/auth/login', body: { email: 'a@b.c' }, ip: '1.2.3.4', headers: {} })),
    ).toThrow(UnauthorizedException);
    expect(records[0]).toMatchObject({ action: 'LOGIN_FAILURE', targetType: 'AUTH', outcome: 'FAILURE' });
    expect(records[0].metadata.email).toBe('a@b.c');
  });

  it('records ACCESS_DENIED for ForbiddenException with actor from request.user', () => {
    const records: any[] = [];
    const audit: any = { record: (i: any) => { records.push(i); return Promise.resolve(); } };
    const filter = new AuditExceptionFilter(audit);
    const user = { userId: 'u1', role: 'DEVELOPER', name: 'D', department: '개발팀' };
    expect(() =>
      filter.catch(new ForbiddenException('no'), ctx({ method: 'POST', url: '/change-requests/c1/approve', user, ip: '1.1.1.1', headers: {} })),
    ).toThrow(ForbiddenException);
    expect(records[0]).toMatchObject({ action: 'ACCESS_DENIED', outcome: 'FAILURE', actor: { userId: 'u1' } });
  });

  it('does not record for other exceptions', () => {
    const records: any[] = [];
    const audit: any = { record: (i: any) => { records.push(i); return Promise.resolve(); } };
    const filter = new AuditExceptionFilter(audit);
    class Other extends Error {}
    expect(() => filter.catch(new Other('x'), ctx({ method: 'GET', url: '/x', headers: {} }))).toThrow();
    expect(records).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @dbflow/api test -- audit-exception`
Expected: FAIL (필터 미존재).

- [ ] **Step 3: 필터 구현**

`apps/api/src/audit/audit-exception.filter.ts`:
```ts
import {
  ArgumentsHost, Catch, ExceptionFilter,
  ForbiddenException, UnauthorizedException,
} from '@nestjs/common';
import { AuditService } from './audit.service';

@Catch()
export class AuditExceptionFilter implements ExceptionFilter {
  constructor(private readonly audit: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost): never {
    const req = host.switchToHttp().getRequest();
    const ip = req?.ip ?? null;
    const userAgent = req?.headers?.['user-agent'] ?? null;

    if (exception instanceof UnauthorizedException && String(req?.url).includes('/auth/login')) {
      void this.audit.record({
        action: 'LOGIN_FAILURE' as any, targetType: 'AUTH' as any, outcome: 'FAILURE' as any,
        summary: '로그인 실패', metadata: { email: req?.body?.email ?? null }, ip, userAgent,
      });
    } else if (exception instanceof ForbiddenException) {
      const user = req?.user;
      void this.audit.record({
        action: 'ACCESS_DENIED' as any, targetType: 'AUTH' as any, outcome: 'FAILURE' as any,
        summary: `권한 거부: ${req?.method} ${req?.url}`,
        actor: user ? { userId: user.userId, name: user.name, role: user.role, department: user.department } : null,
        metadata: { method: req?.method, path: req?.url }, ip, userAgent,
      });
    }
    throw exception; // 응답 동작 불변 — 원래 예외를 그대로 재던진다.
  }
}
```
참고: `@Catch()`(인자 없음)는 모든 예외를 받되, 위 조건 외에는 기록 없이 재던지므로 기존 에러 응답이 유지된다.

- [ ] **Step 4: main.ts에 글로벌 필터 등록**

`main.ts`에서 app 생성 후:
```ts
import { AuditExceptionFilter } from './audit/audit-exception.filter';
import { AuditService } from './audit/audit.service';
// ...
  app.useGlobalFilters(new AuditExceptionFilter(app.get(AuditService)));
```
(`AuditService`는 `@Global() AuditModule`로 DI 컨테이너에 있으므로 `app.get`으로 획득.)

- [ ] **Step 5: 테스트 통과 + 빌드**

Run: `pnpm --filter @dbflow/api test -- audit-exception && pnpm --filter @dbflow/api build`
Expected: PASS + 컴파일 성공.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/audit apps/api/src/main.ts
git commit -m "feat(api): audit login failures and access-denied via global exception filter"
```

---

### Task 5: 로그인 성공 감사

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.module.ts` (AuditService는 @Global이라 import 불필요; 확인만)

**Interfaces:**
- Consumes: `AuditService.record`.

- [ ] **Step 1: auth.service에 AuditService 주입 + 로그인 성공 기록**

`auth.service.ts` 생성자에 `private readonly audit: AuditService` 추가(import). `validateAndLogin`의 성공 return 직전:
```ts
    await this.audit.record({
      actor: { userId: user.id, name: user.name, role: user.role, department: user.department },
      action: 'LOGIN_SUCCESS' as any, targetType: 'AUTH' as any, targetId: user.id,
      summary: `로그인: ${user.email}`,
    });
```
(로그인 실패는 Task 4 필터가 담당하므로 여기선 성공만.)

- [ ] **Step 2: 빌드 + 라이브 확인**

Run: `pnpm --filter @dbflow/api build`
Expected: 성공. AuditModule이 @Global이라 AuthModule 수정 없이 주입됨(안 되면 AuthModule imports에 AuditModule 추가).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): audit successful logins"
```

---

### Task 6: change-request 감사 (트랜잭션 내부 + 서비스 시그니처)

**Files:**
- Modify: `apps/api/src/change-request/change-request.service.ts`
- Modify: `apps/api/src/change-request/change-request.controller.ts`
- Modify: `apps/api/src/change-request/change-request.service.spec.ts`

**Interfaces:**
- Consumes: `AuditService.buildData`/`record`, `CurrentUserPayload`.
- Produces: submit/review/approve/setAssignees/create가 각각 CR_SUBMITTED/REVIEWED/APPROVED/ASSIGNEES_CHANGED/CR_CREATED를 기록. **CR 전이 audit은 `applyTransition`의 `$transaction` 배열 안**.

- [ ] **Step 1: 서비스에 AuditService 주입 + actor 전달로 시그니처 변경**

`change-request.service.ts` 생성자에 `private readonly audit: AuditService`. `submit`/`review`/`approve`는 현재 `actorId: string`을 받는데, 스냅샷을 위해 **`actor: CurrentUserPayload`** 로 변경. 컨트롤러도 `user.userId` → `user` 전달로 변경.
- `applyTransition(changeRequest, action, actor, comment)`에 `actor: CurrentUserPayload` 전달.

- [ ] **Step 2: applyTransition의 $transaction 배열에 audit 추가**

`applyTransition` 내부 `$transaction([...])`에 세 번째 요소로:
```ts
      this.prisma.auditLog.create({
        data: this.audit.buildData({
          actor: { userId: actor.userId, name: actor.name, role: actor.role, department: actor.department },
          action: AUDIT_ACTION_BY_TRANSITION[action],   // 아래 매핑
          targetType: 'CHANGE_REQUEST' as any,
          targetId: changeRequest.id,
          summary: `${AUDIT_SUMMARY[action]} (CR ${changeRequest.id})`,
          metadata: { fromStatus: changeRequest.status, toStatus, comment: comment ?? undefined },
        }),
      }),
```
파일 상단에 매핑 상수:
```ts
const AUDIT_ACTION_BY_TRANSITION: Record<TransitionAction, AuditAction> = {
  SUBMIT: 'CR_SUBMITTED' as AuditAction,
  REVIEW_APPROVE: 'CR_REVIEWED' as AuditAction,
  REVIEW_REJECT: 'CR_REVIEWED' as AuditAction,
  FINAL_APPROVE: 'CR_APPROVED' as AuditAction,
  FINAL_REJECT: 'CR_APPROVED' as AuditAction,
};
const AUDIT_SUMMARY: Record<TransitionAction, string> = {
  SUBMIT: '제출', REVIEW_APPROVE: '검토 승인', REVIEW_REJECT: '검토 반려',
  FINAL_APPROVE: '최종 승인', FINAL_REJECT: '최종 반려',
};
```
(REVIEW_REJECT도 CR_REVIEWED로 기록하되 metadata의 toStatus로 승인/반려 구분.)

- [ ] **Step 3: create · setAssignees 기록**

`create`: CR 생성 후(트랜잭션 아님, 단일 create) `await this.audit.record({ actor, action:'CR_CREATED', targetType:'CHANGE_REQUEST', targetId: created.id, summary:'변경요청 생성', metadata:{ targetEnv: dto.targetEnv, reviewerId: dto.reviewerId, approverId: dto.approverId } })`. `create`도 `actor: CurrentUserPayload`를 받도록 시그니처 변경(현재 `authorId: string`).
`setAssignees`: update 후 `await this.audit.record({ actor: user snapshot, action:'CR_ASSIGNEES_CHANGED', targetType:'CHANGE_REQUEST', targetId:id, summary:'지정자 변경', metadata:{ reviewerId: dto.reviewerId, approverId: dto.approverId } })`. `setAssignees`는 이미 `user: AuthUser`를 받는데, 스냅샷 위해 `CurrentUserPayload`로 확장(컨트롤러가 `user` 전달 중).

- [ ] **Step 4: 테스트 — 전이 시 audit이 트랜잭션 배열에 포함되는지**

`change-request.service.spec.ts`에 추가(mock prisma의 `$transaction`이 받은 배열 길이/내용 확인). 기존 svc 헬퍼가 `$transaction`을 스텁하도록 확장:
```ts
it('records CR_APPROVED inside the transition transaction', async () => {
  const calls: any = { tx: null };
  const prisma: any = {
    changeRequest: {
      findUnique: () => Promise.resolve({ id:'c1', status:'REVIEW_APPROVED', authorId:'a', reviewerId:'r', approverId:'p1' }),
      update: () => ({}), findUniqueOrThrow: () => Promise.resolve({ id:'c1', status:'FINAL_APPROVED', files:[], statusHistory:[], author:{name:'A'}, reviewer:null, approver:null }),
    },
    statusHistory: { create: () => ({}) },
    auditLog: { create: (a:any) => a },
    $transaction: (arr:any[]) => { calls.tx = arr; return Promise.resolve([]); },
  };
  const audit = new AuditService(prisma);
  const svc = new ChangeRequestService(prisma, audit);   // 생성자 인자 순서는 구현에 맞춤
  const actor = { userId:'p1', role:'APPROVER', name:'결재자', department:'인프라팀' } as any;
  await svc.approve(actor, 'c1', { decision:'APPROVE' } as any);
  expect(calls.tx).toHaveLength(3);  // update + statusHistory.create + auditLog.create
});
```
(주의: 생성자 시그니처가 `(prisma, audit)`가 되도록 구현. 기존 테스트들의 `new ChangeRequestService(prisma)` 호출도 `(prisma, new AuditService(prisma))`로 일괄 갱신.)

- [ ] **Step 5: 테스트 RED→GREEN**

Run: `pnpm --filter @dbflow/api test -- change-request.service`
먼저 FAIL(3 미충족/시그니처) 확인 후 구현하여 PASS. 그리고 전체 `pnpm --filter @dbflow/api test`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/change-request
git commit -m "feat(api): audit CR create/submit/review/approve/reassign (transitions atomic)"
```

---

### Task 7: apply / rollback 감사 (Execution 확정 후)

**Files:**
- Modify: `apps/api/src/apply/apply.service.ts`
- Modify: `apps/api/src/apply/rollback.service.ts`
- Modify: `apps/api/src/apply/apply.service.spec.ts` (있으면) / rollback spec

**Interfaces:**
- Consumes: `AuditService.record`.
- Produces: apply → `CR_APPLIED`(outcome=Execution 상태), rollback → `CR_ROLLED_BACK`.

- [ ] **Step 1: apply.service — 최종 Execution 상태로 audit**

`apply.service.ts` 생성자에 `AuditService` 주입. `apply(actor, changeRequestId, dto)`의 `return this.getExecutionDetail(execution.id)` **직전**(성공·실패 양 경로가 합류하는 지점)에서:
```ts
    const finalExec = await this.prisma.execution.findUniqueOrThrow({ where: { id: execution.id }, select: { status: true, targetDatabaseId: true } });
    await this.audit.record({
      actor: { userId: actor.userId, name: actor.name, role: actor.role, department: actor.department },
      action: 'CR_APPLIED' as any, targetType: 'EXECUTION' as any, targetId: execution.id,
      outcome: finalExec.status === 'SUCCESS' ? ('SUCCESS' as any) : ('FAILURE' as any),
      summary: `적용 ${finalExec.status} (CR ${changeRequestId})`,
      metadata: { changeRequestId, targetDatabaseId: finalExec.targetDatabaseId, executionStatus: finalExec.status },
    });
```
주의: `ApplyActor`가 name/department를 포함하도록 컨트롤러가 `@CurrentUser() user`(=CurrentUserPayload) 전체를 넘기는지 확인. 안 넘기면 `apply.controller.ts`에서 `user`를 그대로 서비스에 전달하도록 조정(SQL/비밀번호는 기록 안 함).

- [ ] **Step 2: rollback.service — audit**

`rollback.service.ts` 생성자에 `AuditService` 주입. `rollback(actor, executionId)`의 반환 직전:
```ts
    await this.audit.record({
      actor: { userId: actor.userId, name: actor.name, role: actor.role, department: actor.department },
      action: 'CR_ROLLED_BACK' as any, targetType: 'EXECUTION' as any, targetId: rollback.id,
      outcome: hadHardFailure ? ('FAILURE' as any) : ('SUCCESS' as any),
      summary: `롤백 (원본 실행 ${executionId})`,
      metadata: { sourceExecutionId: executionId, rollbackExecutionId: rollback.id },
    });
```

- [ ] **Step 3: 테스트**

apply/rollback service spec에 "audit.record가 최종 상태로 1회 호출" 테스트를 mock으로 추가(있는 spec 패턴 따름). 생성자에 audit 인자 추가로 기존 spec의 서비스 생성도 갱신.

- [ ] **Step 4: 테스트 + 빌드 + Commit**

Run: `pnpm --filter @dbflow/api test && pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/apply
git commit -m "feat(api): audit apply/rollback outcomes after execution finalize"
```

---

### Task 8: users / target-database 감사

**Files:**
- Modify: `apps/api/src/users/users.service.ts` (+ spec)
- Modify: `apps/api/src/target-database/target-database.service.ts` (+ spec)

**Interfaces:**
- Consumes: `AuditService.record`. users/target-db 서비스 메서드가 actor 스냅샷을 받도록 시그니처 조정(컨트롤러가 `@CurrentUser() user` 전달).

- [ ] **Step 1: users.service — create/updateMe 감사**

`UsersService` 생성자에 `AuditService`. `create`는 관리자 컨트롤러 호출이므로 actor를 받도록 시그니처에 `actor: AuditActorSnapshot` 추가(컨트롤러 `create`가 `@CurrentUser() user` 전달). 생성 후:
```ts
    await this.audit.record({ actor, action:'USER_CREATED' as any, targetType:'USER' as any, targetId: created.id, summary:`계정 생성: ${created.email}`, metadata:{ role: created.role, department: created.department } });
```
`updateMe(id, data, actor)`: 수정 후 `USER_PROFILE_UPDATED`, targetId=id, metadata=변경필드 키 목록(telegramChatId 값은 기록하되 비밀 아님 — 그대로). 컨트롤러 `updateMe`가 `@CurrentUser() user` 전달.

- [ ] **Step 2: target-database.service — create/update/delete 감사**

`TargetDatabaseService` 생성자에 `AuditService`. `create`/`update`/`delete`에 `actor: AuditActorSnapshot` 인자 추가(컨트롤러가 `@CurrentUser() user` 전달). 각 성공 후:
```ts
// create
await this.audit.record({ actor, action:'TARGET_DB_CREATED' as any, targetType:'TARGET_DATABASE' as any, targetId: created.id, summary:`대상DB 생성: ${created.name}`, metadata:{ env: created.env, dbType: created.dbType, host: created.host } });
// update — 비밀번호 값 금지, 변경여부 플래그만
await this.audit.record({ actor, action:'TARGET_DB_UPDATED' as any, targetType:'TARGET_DATABASE' as any, targetId: id, summary:`대상DB 수정: ${updated.name}`, metadata:{ credentialChanged: dto.password != null } });
// delete
await this.audit.record({ actor, action:'TARGET_DB_DELETED' as any, targetType:'TARGET_DATABASE' as any, targetId: id, summary:'대상DB 삭제' });
```
`testConnection`은 감사하지 않음(비파괴).

- [ ] **Step 3: 테스트(각 서비스 spec에 audit 호출 검증) + 전체 스위트**

Run: `pnpm --filter @dbflow/api test`
Expected: 전체 GREEN(생성자 audit 인자 추가로 기존 spec 갱신 포함).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/users apps/api/src/target-database
git commit -m "feat(api): audit user creation/profile update and target-db CRUD"
```

---

### Task 9: 감사 조회 API (ADMIN)

**Files:**
- Create: `apps/api/src/audit/audit.controller.ts`
- Create: `apps/api/src/audit/dto/query-audit.dto.ts`
- Modify: `apps/api/src/audit/audit.service.ts` (list 메서드)
- Modify: `apps/api/src/audit/audit.module.ts` (controller 등록)
- Modify: `apps/api/src/audit/audit.service.spec.ts`

**Interfaces:**
- Produces: `GET /audit-logs?actor=&action=&targetType=&outcome=&from=&to=&page=` (ADMIN). `AuditService.list(query): { items, total, page, pageSize }`.

- [ ] **Step 1: 쿼리 DTO**

`query-audit.dto.ts`:
```ts
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AuditOutcome, AuditTargetType } from '@prisma/client';

export class QueryAuditDto {
  @IsOptional() @IsString() actor?: string;
  @IsOptional() @IsEnum(AuditAction) action?: AuditAction;
  @IsOptional() @IsEnum(AuditTargetType) targetType?: AuditTargetType;
  @IsOptional() @IsEnum(AuditOutcome) outcome?: AuditOutcome;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}
```

- [ ] **Step 2: list 테스트 (where 조립 + 페이지네이션)**

`audit.service.spec.ts`에 추가:
```ts
it('list builds where filters and paginates (pageSize 50)', async () => {
  let args: any = null;
  const prisma: any = {
    auditLog: {
      findMany: (a: any) => { args = a; return Promise.resolve([{ id: '1' }]); },
      count: () => Promise.resolve(1),
    },
  };
  const svc = new AuditService(prisma);
  const res = await svc.list({ action: 'CR_APPROVED' as any, from: '2026-01-01', page: 2 });
  expect(args.where).toMatchObject({ action: 'CR_APPROVED', createdAt: { gte: new Date('2026-01-01') } });
  expect(args.skip).toBe(50); expect(args.take).toBe(50);
  expect(res).toMatchObject({ total: 1, page: 2, pageSize: 50 });
});
```

- [ ] **Step 3: list 구현 (audit.service.ts)**

```ts
  async list(q: {
    actor?: string; action?: AuditAction; targetType?: AuditTargetType;
    outcome?: AuditOutcome; from?: string; to?: string; page?: number;
  }) {
    const pageSize = 50;
    const page = q.page && q.page > 0 ? q.page : 1;
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.actor ? { actorId: q.actor } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
```
(import `AuditAction, AuditTargetType, AuditOutcome`.)

- [ ] **Step 4: 컨트롤러 (ADMIN)**

`audit.controller.ts`:
```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() q: QueryAuditDto) {
    return this.audit.list(q);
  }
}
```
`audit.module.ts`의 `controllers: [AuditController]` 추가.

- [ ] **Step 5: 테스트 + 빌드 + Commit**

Run: `pnpm --filter @dbflow/api test -- audit.service && pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/audit
git commit -m "feat(api): admin audit-log query endpoint with filters and pagination"
```

---

### Task 10: 감사 내보내기 API (CSV / JSON)

**Files:**
- Modify: `apps/api/src/audit/audit.controller.ts`
- Modify: `apps/api/src/audit/audit.service.ts`
- Modify: `apps/api/src/audit/audit.service.spec.ts`

**Interfaces:**
- Produces: `GET /audit-logs/export?<filters>&format=csv|json` (ADMIN). `AuditService.exportRows(query)` → 필터된 전체 행(페이지네이션 없음), `toCsv(rows)`.

- [ ] **Step 1: toCsv 테스트**

```ts
it('toCsv escapes commas/quotes and serializes metadata', () => {
  const svc = new AuditService({} as any);
  const csv = svc.toCsv([{ id:'1', createdAt: new Date('2026-01-01T00:00:00Z'), actorName:'A,B', action:'CR_APPROVED', targetType:'CHANGE_REQUEST', targetId:'c1', summary:'x"y', outcome:'SUCCESS', metadata:{ k:1 }, actorId:'u1', actorRole:'APPROVER', actorDept:'인프라팀', ip:null, userAgent:null } as any]);
  const [header, row] = csv.trim().split('\n');
  expect(header).toContain('createdAt,actorName,action');
  expect(row).toContain('"A,B"');       // 콤마 → 따옴표 감쌈
  expect(row).toContain('"x""y"');      // 따옴표 이스케이프
  expect(row).toContain('{""k"":1}');   // metadata JSON 직렬화 후 CSV 이스케이프
});
```

- [ ] **Step 2: exportRows + toCsv 구현**

`audit.service.ts`:
```ts
  exportRows(q: Parameters<AuditService['list']>[0]) {
    // list와 동일 where, 페이지네이션 없이 최신순 전체(내보내기 상한 10000)
    const where = this.buildWhere(q);           // list의 where 조립을 private buildWhere로 추출해 공유
    return this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10000 });
  }

  toCsv(rows: any[]): string {
    const cols = ['id','createdAt','actorId','actorName','actorRole','actorDept','action','targetType','targetId','outcome','summary','metadata','ip','userAgent'];
    const esc = (v: unknown) => {
      const s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
    return lines.join('\n') + '\n';
  }
```
(`list`의 where 조립을 `private buildWhere(q)`로 리팩터해 `list`/`exportRows`가 공유 — DRY.)

- [ ] **Step 3: export 라우트**

`audit.controller.ts`에 추가(import `Query`, `Res`, `Response` from express, `BadRequestException`):
```ts
  @Get('export')
  async export(@Query() q: QueryAuditExportDto, @Res() res: Response) {
    const rows = await this.audit.exportRows(q);
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
      return res.send(this.audit.toCsv(rows));
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.json"');
    return res.send(JSON.stringify(rows));
  }
```
`QueryAuditExportDto`는 `QueryAuditDto`를 extends 하고 `@IsEnum(['csv','json'] 대신) @IsIn(['csv','json']) format`을 추가(기본 'json'). `@IsOptional() @IsIn(['csv','json']) format?: 'csv'|'json';`
주의: `/audit-logs/export`가 `/audit-logs/:id`류와 충돌하지 않도록 export 라우트를 list보다 먼저/구체 경로로 둔다(여기선 `:id` 라우트 없음 — 무해).

- [ ] **Step 4: 테스트 + 빌드 + Commit**

Run: `pnpm --filter @dbflow/api test -- audit.service && pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/audit
git commit -m "feat(api): audit-log CSV/JSON export endpoint"
```

---

### Task 11: 프론트 — 감사 페이지 + API + 네비

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/app/(app)/audit/page.tsx`
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/icons.tsx` (감사 아이콘, 없으면)

**Interfaces:**
- Consumes: `GET /audit-logs`, `GET /audit-logs/export`.

- [ ] **Step 1: api 클라이언트**

`apps/web/lib/api.ts`에 타입 + 함수:
```ts
export type AuditLogRow = {
  id: string; createdAt: string; actorId: string | null; actorName: string | null;
  actorRole: string | null; actorDept: string | null; action: string;
  targetType: string; targetId: string | null; summary: string;
  metadata: unknown; outcome: 'SUCCESS' | 'FAILURE'; ip: string | null; userAgent: string | null;
};
export type AuditQuery = { actor?: string; action?: string; targetType?: string; outcome?: string; from?: string; to?: string; page?: number };

export function listAuditLogs(q: AuditQuery) {
  const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '') as [string, string][]);
  return apiFetch<{ items: AuditLogRow[]; total: number; page: number; pageSize: number }>(`/audit-logs?${p.toString()}`);
}
export function auditExportUrl(q: AuditQuery, format: 'csv' | 'json') {
  const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== '')), format } as any);
  return `${API_BASE}/audit-logs/export?${p.toString()}`;
}
```
(`API_BASE`는 파일 상단 상수 재사용. 내보내기는 인증 헤더가 필요하므로 새 창 링크 대신 `apiFetch`로 blob 받아 다운로드하는 방식으로 구현 — 아래 페이지 참고.)

- [ ] **Step 2: 감사 페이지**

`apps/web/app/(app)/audit/page.tsx` — `useUser()`로 ADMIN 아니면 "접근 불가" 카드. `PageHeader title="감사 로그"`. 필터 바(액션/대상유형/결과 select + from/to date input + 행위자 텍스트). 테이블(시각·행위자(이름/부서/역할)·액션·대상·결과 뱃지·summary), 행 클릭 시 metadata 펼침(details). 페이지네이션(page prev/next, total/pageSize 기반). "CSV 내보내기"/"JSON 내보내기" 버튼 → `apiFetch`로 blob 받아 `URL.createObjectURL`+`<a download>` 트리거(인증 헤더 유지). 토큰: 기존 `target-databases`/`change-requests` 테이블 패턴·시맨틱 토큰 재사용. outcome=FAILURE는 red 뱃지, SUCCESS는 emerald.

- [ ] **Step 3: 사이드바 ADMIN 네비 + 아이콘**

`sidebar.tsx`의 NAV에 `{ href:'/audit', label:'감사 로그', Icon: ShieldIcon, roles:['ADMIN'] }` 추가. `icons.tsx`에 `ShieldIcon`(기존 아이콘 스타일과 동일한 stroke/viewBox) 추가.

- [ ] **Step 4: tsc + build**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
Expected: 0 errors + `/audit` 라우트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): admin audit-log page with filters, detail, and export"
```

---

### Task 12: 통합 검증

**Files:** 없음(검증 전용)

- [ ] **Step 1: 백엔드 전체 테스트**

Run: `pnpm --filter @dbflow/api test`
Expected: 전체 PASS(신규 audit 테스트 포함).

- [ ] **Step 2: 프론트 빌드**

Run: `pnpm --filter @dbflow/web build`
Expected: `/audit` 포함 전 라우트 컴파일, tsc 0.

- [ ] **Step 3: 라이브 E2E (수동)**

`./start.sh --no-install`(또는 api 재기동으로 새 코드 반영). 확인:
- 로그인(성공) → `LOGIN_SUCCESS` 기록
- 틀린 비번 로그인 → `LOGIN_FAILURE` 기록(actor 미상, email metadata)
- 개발자가 검토자 미지정 CR을 남의 것 검토 시도(403) → `ACCESS_DENIED` 기록
- CR 생성/제출/검토/결재 → 각 audit + StatusHistory 양쪽
- 적용/롤백 → `CR_APPLIED`/`CR_ROLLED_BACK`(outcome=Execution 상태)
- admin `/audit`에서 필터 조회 + CSV/JSON 내보내기
- `docker compose ... mysql -e "UPDATE audit_log SET summary='x' LIMIT 1"` → **트리거로 거부(ERROR 1644)**
- 대상DB 비밀번호가 어떤 audit metadata에도 없음(grep 확인)

- [ ] **Step 4: 최종 커밋(있으면)**

```bash
git add -A && git commit -m "chore: audit-log integration verified" || true
```

---

## Self-Review (작성자 확인 완료)

- **스펙 커버리지**: §3 모델→T1, §4.1 스냅샷→T3, §4.2 성공기록(트랜잭션/서비스레벨)→T5·T6·T7·T8, §4.3 실패기록(ExceptionFilter)→T4, §5 민감정보→T6~T8(참조·플래그), §6 불변성(트리거)→T1, §7 조회/내보내기/ADMIN→T9·T10·T11. 전 항목 매핑됨.
- **플레이스홀더**: 각 코드 스텝에 실제 코드. T11 프론트 페이지는 기존 테이블/폼 패턴 참조를 구체 토큰·동작으로 명시.
- **타입 일관성**: `AuditInput`/`AuditActorSnapshot`/`buildData`/`record`/`list`/`exportRows`/`toCsv` 시그니처가 T2~T10에서 일치. `CurrentUserPayload` 확장(T3)을 T4~T8이 소비. 생성자 인자 추가(audit) 시 기존 spec의 서비스 생성 호출 일괄 갱신을 각 태스크에 명시.
- **주의(구현 순서)**: 생성자에 AuditService를 추가하는 태스크(T5~T8)는 해당 모듈의 기존 `.spec.ts`의 `new Service(prisma)` 호출을 `new Service(prisma, new AuditService(prisma))`로 함께 갱신해야 테스트가 깨지지 않음 — 각 태스크 Step에 포함.
