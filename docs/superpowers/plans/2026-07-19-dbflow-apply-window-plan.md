# 변경 작업창 · 동결 기간 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 환경별 주간 작업창 + 절대 동결 기간으로 apply 경로를 시간 게이트한다 (스펙: `docs/superpowers/specs/2026-07-19-dbflow-apply-window-design.md`).

**Architecture:** 신규 테이블 2개(`apply_window`, `freeze_period`) + `apply-schedule` NestJS 모듈(판정+CRUD+감사) → `ApplyService.apply()`에 1줄 게이트 삽입. 프론트는 ADMIN 관리 페이지 + CR 상세 적용 패널 배너. 스케줄러 없음(수동 게이트만).

**Tech Stack:** NestJS 10 + Prisma 5 + MySQL 8 / Next.js 14 App Router + Tailwind.

## Global Constraints

- 판정은 **Asia/Seoul 벽시계**. API는 `TZ=Asia/Seoul`로 기동(start.sh 주입) + 부팅 시 TZ 불일치 경고 로그 + `GET /apply-schedule`이 `timezone` 노출.
- **fail-closed**: 판정 쿼리 예외는 그대로 전파(적용 중단). 절대 catch 후 `allowed: true` 폴백 금지.
- 게이트 대상은 **apply만**. lint/dry-run/rollback은 게이트하지 않는다.
- **동결이 작업창보다 우선**. 창 0행 환경은 항상 허용(무회귀).
- `GET /apply-schedule`·`GET /apply-schedule/status`는 로그인 공통, mutation은 **메서드 레벨** `@Roles(Role.ADMIN)`(컨트롤러 레벨 @Roles 금지).
- 동결 시각 계약: 프론트가 `YYYY-MM-DDTHH:mm` 문자열 전달 → API가 `+09:00` 고정 오프셋으로 UTC instant 변환.
- 창 검증: `0 <= startMinute < endMinute <= 1440`(1440 = 24:00 자정 종료). 자정 넘김 창 금지.
- 게이트 거부(409)는 감사하지 않음. 창/동결 mutation은 감사(`APPLY_WINDOW_UPDATED`/`FREEZE_UPDATED`, targetType `APPLY_SCHEDULE`).
- 백엔드 유닛 테스트는 `new Service(mockPrisma, ...)` 패턴(Nest TestingModule 금지). 프론트는 tsc+build 검증.

---

### Task 1: 스키마 · 마이그레이션 · 감사 enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_apply_window_freeze/migration.sql` (prisma 자동 생성)

**Interfaces:** Produces `ApplyWindow`, `FreezePeriod` 모델, `AuditAction.APPLY_WINDOW_UPDATED`/`FREEZE_UPDATED`, `AuditTargetType.APPLY_SCHEDULE`.

- [ ] **Step 1: 스키마 편집**

`schema.prisma`에 모델 2개 추가(SqlReviewRule 모델 근처):

```prisma
model ApplyWindow {
  id          String    @id @default(cuid())
  env         TargetEnv
  dayOfWeek   Int       // 0=일 ~ 6=토
  startMinute Int       // 0~1439 (02:00 = 120)
  endMinute   Int       // exclusive, 최대 1440(=24:00)
  @@index([env])
  @@map("apply_window")
}

model FreezePeriod {
  id          String    @id @default(cuid())
  env         TargetEnv
  startsAt    DateTime
  endsAt      DateTime
  reason      String
  createdById String
  createdBy   User      @relation("freezeCreator", fields: [createdById], references: [id])
  createdAt   DateTime  @default(now())
  @@index([env])
  @@map("freeze_period")
}
```

`User` 모델 관계에 추가: `createdFreezes FreezePeriod[] @relation("freezeCreator")`

`AuditAction`에 `APPLY_WINDOW_UPDATED`, `FREEZE_UPDATED` 추가. `AuditTargetType`에 `APPLY_SCHEDULE` 추가.

- [ ] **Step 2: 마이그레이션 생성·적용**

신규 테이블만이라 백필 불필요 — 일반 `migrate dev`로 충분:

Run: `pnpm --filter @dbflow/api exec prisma migrate dev --name apply_window_freeze`
Expected: 마이그레이션 생성·적용, 클라이언트 재생성.

- [ ] **Step 3: 확인 + Commit**

Run: `docker exec -i project-dbflow-mysql-1 mysql -udbflow -pdbflow dbflow -e "SHOW TABLES LIKE '%apply_window%'; SHOW TABLES LIKE '%freeze%';"`
Expected: 두 테이블 존재.

```bash
git add apps/api/prisma
git commit -m "feat(api): ApplyWindow + FreezePeriod schema, apply-schedule audit enums"
```

---

### Task 2: ApplyScheduleService · 컨트롤러 · 모듈 (TDD)

**Files:**
- Create: `apps/api/src/apply-schedule/apply-schedule.service.ts` (+ `.spec.ts`)
- Create: `apps/api/src/apply-schedule/apply-schedule.controller.ts`
- Create: `apps/api/src/apply-schedule/apply-schedule.module.ts`
- Create: `apps/api/src/apply-schedule/dto/apply-schedule.dto.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 모델, `AuditService.record`(글로벌), `AuditActorSnapshot`(`../audit/audit.types`), auth 데코레이터들.
- Produces: `checkApplyAllowed(env, now?)`, `assertApplyAllowed(env)`, `list()`, CRUD 4종. `ApplyScheduleModule`은 **`exports: [ApplyScheduleService]`**. 라우트: `GET /apply-schedule`, `GET /apply-schedule/status?env=`, `POST|DELETE /apply-schedule/windows(:id)`, `POST|DELETE /apply-schedule/freezes(:id)`.

- [ ] **Step 1: 실패 테스트 작성**

`apply-schedule.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { ApplyScheduleService } from './apply-schedule.service';

// 화요일 03:00 KST 고정 시각 (2026-07-21은 화요일)
const TUE_0300 = new Date(2026, 6, 21, 3, 0, 0);

function svc(windows: any[] = [], freezes: any[] = []) {
  const prisma: any = {
    applyWindow: { findMany: () => Promise.resolve(windows) },
    freezePeriod: {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          freezes.find((f) => f.startsAt <= where.startsAt.lte && f.endsAt > where.startsAt.lte) ?? null,
        ),
    },
  };
  return new ApplyScheduleService(prisma, { record: () => Promise.resolve() } as any);
}

describe('ApplyScheduleService.checkApplyAllowed', () => {
  it('allows when no windows configured (무회귀)', async () => {
    expect((await svc().checkApplyAllowed('PROD' as any, TUE_0300)).allowed).toBe(true);
  });

  it('allows inside a window, denies outside with nextWindow', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }]; // 화 02:00~04:00
    expect((await svc(win).checkApplyAllowed('PROD' as any, TUE_0300)).allowed).toBe(true);
    const out = await svc(win).checkApplyAllowed('PROD' as any, new Date(2026, 6, 21, 5, 0));
    expect(out).toMatchObject({ allowed: false, reason: 'OUT_OF_WINDOW' });
    expect((out as any).nextWindow).toMatchObject({ dayOfWeek: 2, startMinute: 120 }); // 다음 주 화
  });

  it('boundary: startMinute==now allowed, endMinute==now denied', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 180, endMinute: 240, env: 'PROD' }];
    expect((await svc(win).checkApplyAllowed('PROD' as any, TUE_0300)).allowed).toBe(true); // 03:00 == start
    expect((await svc(win).checkApplyAllowed('PROD' as any, new Date(2026, 6, 21, 4, 0))).allowed).toBe(false); // 04:00 == end
  });

  it('freeze wins over an open window', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }];
    const frz = [{ startsAt: new Date(2026, 6, 20), endsAt: new Date(2026, 6, 25), reason: '분기말', env: 'PROD' }];
    const r = await svc(win, frz).checkApplyAllowed('PROD' as any, TUE_0300);
    expect(r).toMatchObject({ allowed: false, reason: 'FROZEN' });
    expect((r as any).freeze.reason).toBe('분기말');
  });

  it('freeze boundary: startsAt==now frozen, endsAt==now allowed', async () => {
    const at = TUE_0300;
    const f1 = [{ startsAt: at, endsAt: new Date(2026, 6, 25), reason: 'x', env: 'PROD' }];
    expect((await svc([], f1).checkApplyAllowed('PROD' as any, at)).allowed).toBe(false);
    const f2 = [{ startsAt: new Date(2026, 6, 20), endsAt: at, reason: 'x', env: 'PROD' }];
    expect((await svc([], f2).checkApplyAllowed('PROD' as any, at)).allowed).toBe(true);
  });

  it('nextWindow wraps the week (일요일 밤 → 화요일 창)', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }];
    const sunNight = new Date(2026, 6, 19, 23, 0); // 일요일
    const r = await svc(win).checkApplyAllowed('PROD' as any, sunNight);
    expect((r as any).nextWindow).toMatchObject({ dayOfWeek: 2, startMinute: 120, endMinute: 240 });
  });

  it('assertApplyAllowed throws 409 with 한국어 메시지', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }];
    await expect(
      svc(win).assertApplyAllowed('PROD' as any, new Date(2026, 6, 21, 5, 0)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc(win).assertApplyAllowed('PROD' as any, new Date(2026, 6, 21, 5, 0)),
    ).rejects.toThrow(/다음 작업창: 화 02:00~04:00/);
  });
});

describe('ApplyScheduleService CRUD', () => {
  it('createFreeze converts KST wall-clock to UTC instant (+09:00)', async () => {
    let created: any = null;
    const prisma: any = {
      freezePeriod: { create: (a: any) => { created = a.data; return Promise.resolve({ id: 'f1', ...a.data }); } },
    };
    const rec: any[] = [];
    const s = new ApplyScheduleService(prisma, { record: (i: any) => { rec.push(i); return Promise.resolve(); } } as any);
    await s.createFreeze(
      { env: 'PROD', startsAt: '2026-09-30T00:00', endsAt: '2026-10-02T00:00', reason: '분기말 동결' } as any,
      { userId: 'a', name: 'A', role: 'ADMIN', department: '운영팀' } as any,
    );
    expect(created.startsAt.toISOString()).toBe('2026-09-29T15:00:00.000Z'); // KST 00:00 = UTC 전일 15:00
    expect(rec[0]).toMatchObject({ action: 'FREEZE_UPDATED', targetType: 'APPLY_SCHEDULE' });
  });

  it('createWindow rejects start >= end', async () => {
    const s = new ApplyScheduleService({} as any, { record: () => Promise.resolve() } as any);
    await expect(
      s.createWindow({ env: 'PROD', dayOfWeek: 2, startMinute: 240, endMinute: 120 } as any, { userId: 'a' } as any),
    ).rejects.toThrow(/시작이 종료보다/);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run `pnpm --filter @dbflow/api test -- apply-schedule` → FAIL(모듈 없음).

- [ ] **Step 3: 서비스 구현**

`apply-schedule.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, TargetEnv } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function fmtMin(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fmtKst(d: Date): string {
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' });
}

/** 스펙 §4 계약: 'YYYY-MM-DDTHH:mm'(KST 벽시계) → UTC instant */
function parseKst(value: string): Date {
  return new Date(`${value}:00+09:00`);
}

type WindowRow = { dayOfWeek: number; startMinute: number; endMinute: number };

export type ScheduleStatus =
  | { allowed: true }
  | { allowed: false; reason: 'FROZEN'; freeze: { reason: string; endsAt: Date } }
  | { allowed: false; reason: 'OUT_OF_WINDOW'; nextWindow: WindowRow | null };

@Injectable()
export class ApplyScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 스펙 §3. 판정 쿼리 예외는 전파(fail-closed) — catch 후 allowed:true 폴백 금지. */
  async checkApplyAllowed(env: TargetEnv, now = new Date()): Promise<ScheduleStatus> {
    const freeze = await this.prisma.freezePeriod.findFirst({
      where: { env, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { reason: true, endsAt: true },
    });
    if (freeze) return { allowed: false, reason: 'FROZEN', freeze };

    const windows = await this.prisma.applyWindow.findMany({
      where: { env },
      select: { dayOfWeek: true, startMinute: true, endMinute: true },
    });
    if (windows.length === 0) return { allowed: true }; // 무창 = 항상 허용(무회귀)

    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();
    const open = windows.some((w) => w.dayOfWeek === day && w.startMinute <= minute && minute < w.endMinute);
    if (open) return { allowed: true };
    return { allowed: false, reason: 'OUT_OF_WINDOW', nextWindow: this.findNextWindow(windows, day, minute) };
  }

  /** now 이후 7일 내 최근접 창(오늘부터 요일 순환 스캔 — 주간 반복이라 항상 존재). */
  private findNextWindow(windows: WindowRow[], day: number, minute: number): WindowRow | null {
    for (let offset = 0; offset <= 7; offset++) {
      const d = (day + offset) % 7;
      const next = windows
        .filter((w) => w.dayOfWeek === d && (offset > 0 || w.startMinute > minute))
        .sort((a, b) => a.startMinute - b.startMinute)[0];
      if (next) return next;
    }
    return null;
  }

  async assertApplyAllowed(env: TargetEnv, now = new Date()): Promise<void> {
    const status = await this.checkApplyAllowed(env, now);
    if (status.allowed) return;
    if (status.reason === 'FROZEN') {
      throw new ConflictException(`동결 기간입니다: ${status.freeze.reason} (${fmtKst(status.freeze.endsAt)}까지)`);
    }
    const w = status.nextWindow;
    throw new ConflictException(
      w
        ? `적용 작업창이 아닙니다. 다음 작업창: ${DAY_LABELS[w.dayOfWeek]} ${fmtMin(w.startMinute)}~${fmtMin(w.endMinute)}`
        : '적용 작업창이 아닙니다.',
    );
  }

  /** 스펙 §4: freezes는 진행중·미래만(과거는 감사 잔재), timezone은 TZ 어서션 노출용. */
  async list() {
    const now = new Date();
    const [windows, freezes] = await Promise.all([
      this.prisma.applyWindow.findMany({
        orderBy: [{ env: 'asc' }, { dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.freezePeriod.findMany({
        where: { endsAt: { gt: now } },
        orderBy: { startsAt: 'asc' },
        include: { createdBy: { select: { name: true } } },
      }),
    ]);
    return {
      windows,
      freezes,
      serverTime: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  async createWindow(
    dto: { env: TargetEnv; dayOfWeek: number; startMinute: number; endMinute: number },
    actor: AuditActorSnapshot,
  ) {
    if (dto.startMinute >= dto.endMinute) {
      throw new BadRequestException('작업창 시작이 종료보다 빨라야 합니다.');
    }
    const row = await this.prisma.applyWindow.create({ data: dto });
    await this.audit.record({
      actor,
      action: AuditAction.APPLY_WINDOW_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: row.id,
      summary: `작업창 추가: ${dto.env} ${DAY_LABELS[dto.dayOfWeek]} ${fmtMin(dto.startMinute)}~${fmtMin(dto.endMinute)}`,
      metadata: { op: 'CREATE', ...dto },
    });
    return row;
  }

  async deleteWindow(id: string, actor: AuditActorSnapshot) {
    const row = await this.prisma.applyWindow.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('작업창을 찾을 수 없습니다.');
    await this.prisma.applyWindow.delete({ where: { id } });
    await this.audit.record({
      actor,
      action: AuditAction.APPLY_WINDOW_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: id,
      summary: `작업창 삭제: ${row.env} ${DAY_LABELS[row.dayOfWeek]} ${fmtMin(row.startMinute)}~${fmtMin(row.endMinute)}`,
      metadata: { op: 'DELETE', env: row.env, dayOfWeek: row.dayOfWeek, startMinute: row.startMinute, endMinute: row.endMinute },
    });
    return { ok: true };
  }

  async createFreeze(
    dto: { env: TargetEnv; startsAt: string; endsAt: string; reason: string },
    actor: AuditActorSnapshot,
  ) {
    const startsAt = parseKst(dto.startsAt);
    const endsAt = parseKst(dto.endsAt);
    if (!(startsAt < endsAt)) {
      throw new BadRequestException('동결 시작이 종료보다 빨라야 합니다.');
    }
    const row = await this.prisma.freezePeriod.create({
      data: { env: dto.env, startsAt, endsAt, reason: dto.reason, createdById: actor.userId },
    });
    await this.audit.record({
      actor,
      action: AuditAction.FREEZE_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: row.id,
      summary: `동결 등록: ${dto.env} ${fmtKst(startsAt)}~${fmtKst(endsAt)} (${dto.reason})`,
      metadata: { op: 'CREATE', env: dto.env, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: dto.reason },
    });
    return row;
  }

  async deleteFreeze(id: string, actor: AuditActorSnapshot) {
    const row = await this.prisma.freezePeriod.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('동결 기간을 찾을 수 없습니다.');
    await this.prisma.freezePeriod.delete({ where: { id } });
    await this.audit.record({
      actor,
      action: AuditAction.FREEZE_UPDATED,
      targetType: AuditTargetType.APPLY_SCHEDULE,
      targetId: id,
      summary: `동결 해제: ${row.env} (${row.reason})`,
      metadata: { op: 'DELETE', env: row.env, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), reason: row.reason },
    });
    return { ok: true };
  }
}
```

- [ ] **Step 4: 통과 확인** — Run `pnpm --filter @dbflow/api test -- apply-schedule` → PASS.

- [ ] **Step 5: DTO + 컨트롤러 + 모듈 + app.module**

`dto/apply-schedule.dto.ts`:

```ts
import { IsEnum, IsInt, Length, Matches, Max, Min } from 'class-validator';
import { TargetEnv } from '@prisma/client';

export class QueryScheduleStatusDto {
  @IsEnum(TargetEnv) env!: TargetEnv; // 스펙 critic M1: 필수·검증
}

export class CreateApplyWindowDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @IsInt() @Min(0) @Max(6) dayOfWeek!: number;
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(1) @Max(1440) endMinute!: number; // 1440 = 24:00(자정 종료)
}

export class CreateFreezeDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAt!: string; // KST 벽시계(critic I2)
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) endsAt!: string;
  @Length(1, 200) reason!: string;
}
```

`apply-schedule.controller.ts` (approval-policy 패턴 — 컨트롤러 레벨 @Roles 금지):

```ts
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApplyScheduleService } from './apply-schedule.service';
import { CreateApplyWindowDto, CreateFreezeDto, QueryScheduleStatusDto } from './dto/apply-schedule.dto';

@Controller('apply-schedule')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ApplyScheduleController {
  constructor(private readonly svc: ApplyScheduleService) {}

  @Get()
  list() { return this.svc.list(); }                 // 로그인 공통(관리 페이지·배너)

  @Get('status')
  status(@Query() q: QueryScheduleStatusDto) {       // 로그인 공통(CR 상세 배너)
    return this.svc.checkApplyAllowed(q.env);
  }

  @Post('windows')
  @Roles(Role.ADMIN)
  createWindow(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateApplyWindowDto) {
    return this.svc.createWindow(dto, this.actor(user));
  }

  @Delete('windows/:id')
  @Roles(Role.ADMIN)
  deleteWindow(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.deleteWindow(id, this.actor(user));
  }

  @Post('freezes')
  @Roles(Role.ADMIN)
  createFreeze(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFreezeDto) {
    return this.svc.createFreeze(dto, this.actor(user));
  }

  @Delete('freezes/:id')
  @Roles(Role.ADMIN)
  deleteFreeze(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.deleteFreeze(id, this.actor(user));
  }

  private actor(user: CurrentUserPayload) {
    return { userId: user.userId, name: user.name, role: user.role, department: user.department };
  }
}
```

`apply-schedule.module.ts` (exports 필수 — 스펙 §5):

```ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyScheduleController } from './apply-schedule.controller';
import { ApplyScheduleService } from './apply-schedule.service';

@Module({
  imports: [PassportModule],
  controllers: [ApplyScheduleController],
  providers: [ApplyScheduleService, PrismaService],
  exports: [ApplyScheduleService],
})
export class ApplyScheduleModule {}
```

`app.module.ts` imports 배열에 `ApplyScheduleModule` 추가.

- [ ] **Step 6: 빌드 + Commit**

Run: `pnpm --filter @dbflow/api build`
Expected: 클린.

```bash
git add apps/api/src/apply-schedule apps/api/src/app.module.ts
git commit -m "feat(api): apply-schedule module — window/freeze evaluation, admin CRUD, audited"
```

---

### Task 3: apply 게이트 통합 + TZ 강제

**Files:**
- Modify: `apps/api/src/apply/apply.service.ts`
- Modify: `apps/api/src/apply/apply.module.ts`
- Modify: `apps/api/src/apply/apply.service.spec.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `start.sh`

**Interfaces:**
- Consumes: `ApplyScheduleService.assertApplyAllowed(env)` (Task 2).
- Produces: apply 경로 시간 게이트. lint/dry-run/rollback은 비게이트 유지.

- [ ] **Step 1: 실패 테스트 — 게이트 거부 시 409 + Execution 미생성**

`apply.service.spec.ts`의 **기존 팩토리 이름은 `makeService()`**(52행 정의, 86행에서 `new ApplyService(prisma, backups as any, audit as any, sqlReview as any)` 호출 — 유일한 호출부). 이를 다음과 같이 확장한다:

1. 팩토리 안에 `const schedule = { assertApplyAllowed: jest.fn().mockResolvedValue(undefined) };` 추가.
2. 86행 생성자를 `new ApplyService(prisma, backups as any, audit as any, sqlReview as any, schedule as any)`로 변경.
3. `makeService`의 반환 객체에 `schedule` 추가.

신규 테스트 — **Execution 생성은 `tx.execution.create`**(인터랙티브 tx 내부)이며 `prisma.execution`에는 `create`가 없다. 같은 파일의 lint-gate 테스트(135행 부근)가 쓰는 단언 패턴을 그대로 따른다. `ConflictException`은 1행에서 이미 import됨:

```ts
it('rejects apply outside the window (409) without creating an execution', async () => {
  const { service, tx, schedule } = makeService();
  schedule.assertApplyAllowed.mockRejectedValueOnce(
    new ConflictException('적용 작업창이 아닙니다. 다음 작업창: 화 02:00~04:00'),
  );
  await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' }))
    .rejects.toBeInstanceOf(ConflictException);
  expect(tx.execution.create).not.toHaveBeenCalled();
});
```

(`APPROVER`·`'cr1'`·`'db1'`은 기존 테스트들이 쓰는 실제 픽스처 — 파일에서 확인 후 동일하게 사용.)

Run: `pnpm --filter @dbflow/api test -- apply.service` → FAIL(생성자 인자 수 불일치 후 컴파일 에러 → 구현으로 해소).

- [ ] **Step 2: 게이트 삽입**

`apply.service.ts`:
- import: `import { ApplyScheduleService } from '../apply-schedule/apply-schedule.service';`
- 생성자 5번째 인자: `private readonly schedule: ApplyScheduleService,`
- `apply()`의 `// 4. Approval gate.` 블록(= `this.assertApprovalGate(...)`) **직후**, MYSQL 체크 전에:

```ts
    // 4.2 Time gate: apply window / freeze (스펙 §5). lint/dry-run/rollback은 비게이트.
    await this.schedule.assertApplyAllowed(target.env);
```

`apply.module.ts` imports에 `ApplyScheduleModule` 추가.

- [ ] **Step 3: 통과 확인** — Run `pnpm --filter @dbflow/api test -- apply` → PASS(기존+신규 전부).

- [ ] **Step 4: TZ 강제 (스펙 critic C1)**

`main.ts` bootstrap 첫머리에:

```ts
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz !== 'Asia/Seoul') {
    // eslint-disable-next-line no-console
    console.warn(
      `[dbflow] 서버 타임존이 Asia/Seoul이 아닙니다(현재: ${tz}). 적용 작업창 판정이 어긋날 수 있습니다 — TZ=Asia/Seoul로 기동하세요.`,
    );
  }
```

`start.sh`의 API 기동 라인을 TZ 주입으로 교체:

```bash
TZ="${TZ:-Asia/Seoul}" nohup pnpm --filter @dbflow/api start:dev >"$RUN_DIR/api.log" 2>&1 &
```

- [ ] **Step 5: 전체 스위트 + 빌드 + Commit**

Run: `pnpm --filter @dbflow/api test && pnpm --filter @dbflow/api build`
Expected: 전체 GREEN + 클린 빌드.

```bash
git add apps/api/src/apply apps/api/src/main.ts start.sh
git commit -m "feat(api): time-gate apply with window/freeze check, enforce TZ=Asia/Seoul"
```

---

### Task 4: 프론트 — 작업창·동결 관리 페이지 + 네비 + 감사 옵션

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/app/(app)/apply-schedule/page.tsx`
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/icons.tsx`
- Modify: `apps/web/app/(app)/audit/page.tsx`

**Interfaces:** Consumes Task 2 라우트 전부. Produces `getApplySchedule`/`getScheduleStatus`/`createApplyWindow`/`deleteApplyWindow`/`createFreeze`/`deleteFreeze` + 타입(Task 5가 재사용).

- [ ] **Step 1: api 클라이언트**

`lib/api.ts`(approval-policy 섹션 뒤, 기존 `TargetEnv` 타입 재사용):

```ts
export type ApplyWindowRow = { id: string; env: TargetEnv; dayOfWeek: number; startMinute: number; endMinute: number };
export type FreezePeriodRow = {
  id: string; env: TargetEnv; startsAt: string; endsAt: string; reason: string;
  createdBy?: { name: string | null };
};
export type ApplySchedule = { windows: ApplyWindowRow[]; freezes: FreezePeriodRow[]; serverTime: string; timezone: string };
export type ScheduleStatus = {
  allowed: boolean;
  reason?: 'FROZEN' | 'OUT_OF_WINDOW';
  nextWindow?: { dayOfWeek: number; startMinute: number; endMinute: number } | null;
  freeze?: { reason: string; endsAt: string };
};

export function getApplySchedule() { return apiFetch<ApplySchedule>(`/apply-schedule`); }
export function getScheduleStatus(env: TargetEnv) { return apiFetch<ScheduleStatus>(`/apply-schedule/status?env=${env}`); }
export function createApplyWindow(input: { env: TargetEnv; dayOfWeek: number; startMinute: number; endMinute: number }) {
  return apiFetch<ApplyWindowRow>(`/apply-schedule/windows`, { method: 'POST', body: JSON.stringify(input) });
}
export function deleteApplyWindow(id: string) {
  return apiFetch<unknown>(`/apply-schedule/windows/${id}`, { method: 'DELETE' });
}
export function createFreeze(input: { env: TargetEnv; startsAt: string; endsAt: string; reason: string }) {
  return apiFetch<FreezePeriodRow>(`/apply-schedule/freezes`, { method: 'POST', body: JSON.stringify(input) });
}
export function deleteFreeze(id: string) {
  return apiFetch<unknown>(`/apply-schedule/freezes/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: 감사 필터 옵션**

`audit/page.tsx`: `ACTION_OPTIONS`에 `'APPLY_WINDOW_UPDATED', 'FREEZE_UPDATED'`, `TARGET_TYPE_OPTIONS`에 `'APPLY_SCHEDULE'` 추가.

- [ ] **Step 3: 관리 페이지**

`app/(app)/apply-schedule/page.tsx` — approval-policy/sql-review 페이지 패턴(useUser ADMIN 게이트, PageHeader "작업창·동결", 에러 배너, 토큰 재사용). 구성:

- 마운트 시 `getApplySchedule()` 로드. `timezone !== 'Asia/Seoul'`이면 상단 경고 배너("서버 타임존 불일치({timezone}) — 창 판정이 어긋날 수 있습니다").
- **작업창 섹션**: 목록 테이블(환경/요일/시작~종료/삭제 버튼) + 추가 폼(환경 셀렉트, 요일 셀렉트 0~6 라벨 `['일','월','화','수','목','금','토']`, `<input type="time">` 2개). 변환: `"HH:mm"` → `h*60+m`; **종료 `"00:00"`은 `1440`으로 매핑**(폼에 "종료 00:00 = 24:00(자정)" 힌트 — critic I3). 제출 → `createApplyWindow` → 목록 재조회. 삭제 → confirm 없이 `deleteApplyWindow` → 재조회(mutation은 서버가 감사).
- **동결 섹션**: 목록(환경/기간 KST 표시/사유/등록자/해제 버튼) + 등록 폼(환경 셀렉트, `<input type="datetime-local">` 2개 — 값 문자열 그대로 전송, 사유 텍스트). 제출 → `createFreeze` → 재조회. 해제 → `deleteFreeze` → 재조회.
- 실패 시 에러 배너에 서버 메시지 표시(낙관적 갱신 대신 **재조회 방식** — 생성/삭제라 단순).
- 분→표시 헬퍼: `const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;` (1440 → "24:00").

- [ ] **Step 4: 사이드바 + 아이콘**

`icons.tsx`: `CalendarIcon` 추가(기존 `Base` 래퍼·스트로크 스타일 준수 — 달력 사각형+상단 고리 2개+내부 가로선). `sidebar.tsx`는 **두 곳** 수정: (1) 상단 icons import 목록에 `CalendarIcon` 추가(알파벳 순 유지), (2) ADMIN 그룹 '결재 정책' 다음에:

```ts
  { href: '/apply-schedule', label: '작업창·동결', Icon: CalendarIcon, roles: ['ADMIN'] },
```

- [ ] **Step 5: tsc + build + Commit**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`

```bash
git add apps/web/lib/api.ts "apps/web/app/(app)/apply-schedule" apps/web/components/sidebar.tsx apps/web/components/icons.tsx "apps/web/app/(app)/audit/page.tsx"
git commit -m "feat(web): admin apply-window/freeze page, nav, audit filter options"
```

---

### Task 5: 프론트 — CR 상세 적용 패널 배너

**Files:**
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx`

**Interfaces:** Consumes `getScheduleStatus(env)`(Task 4). `ApplyPanel`(약 550행)에 배너+버튼 비활성 추가.

- [ ] **Step 1: 배너 구현**

`ApplyPanel` 내부(critic M2 — DB 선택이 아니라 **마운트 시 `cr.targetEnv`로** 조회).
**⚠️ 훅 순서 주의**: `ApplyPanel`에는 612행 부근 `if (!roleAllowed) return null;` 조기 반환이 있다 — 신규 `useState`/`useEffect`는 반드시 **기존 훅들(561~570행)과 함께 조기 반환보다 위에** 배치(Rules of Hooks).

```tsx
const [schedule, setSchedule] = useState<ScheduleStatus | null>(null);
useEffect(() => {
  getScheduleStatus(cr.targetEnv).then(setSchedule).catch(() => setSchedule(null)); // 배너는 보조 — 조회 실패 시 미표시(서버 게이트가 최종 강제)
}, [cr.targetEnv]);
```

렌더(대상 DB 셀렉트 위):

```tsx
{schedule && !schedule.allowed && schedule.reason === 'FROZEN' && (
  <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
    🧊 동결 중: {schedule.freeze?.reason} ({new Date(schedule.freeze!.endsAt).toLocaleString('ko-KR')}까지)
  </div>
)}
{schedule && !schedule.allowed && schedule.reason === 'OUT_OF_WINDOW' && (
  <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600">
    적용 작업창이 아닙니다{schedule.nextWindow
      ? ` — 다음: ${DAY_LABELS[schedule.nextWindow.dayOfWeek]} ${fmtMin(schedule.nextWindow.startMinute)}~${fmtMin(schedule.nextWindow.endMinute)}`
      : ''}
  </div>
)}
{schedule?.allowed && (
  <p className="mt-3 text-sm text-emerald-500">지금 적용 가능한 시간대입니다.</p>
)}
```

- 적용 버튼은 `disabled={!canApply}`(740행 부근, `canApply`는 646~647행에서 파생) — **`canApply` 파생식에 `&& (schedule === null || schedule.allowed)` 항을 추가**하는 방식으로 반영(버튼 JSX에 리터럴 조건 덧대지 말 것).
- 배너는 기존 `{gate.allowed && matching.length > 0 && (...)}` 블록 안(대상 DB 셀렉트 위)에 렌더 — 결과적으로 FINAL_APPROVED 이전 CR에는 배너가 안 보이는데, 이는 **의도된 동작**(적용 가능 시점에만 시간 게이트가 의미 있음).
- `DAY_LABELS`/`fmtMin` 헬퍼는 파일 상단에 소형 const로 추가(Task 4 페이지와 중복 허용 — 3줄 헬퍼, 공용 모듈 신설은 과함).
- 기존 스타일 토큰(경고·에러 배너 클래스)은 파일 내 기존 배너들과 통일.

- [ ] **Step 2: tsc + build + Commit**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`

```bash
git add "apps/web/app/(app)/change-requests/[id]/page.tsx"
git commit -m "feat(web): apply-window/freeze banner and gate-aware apply button on CR detail"
```

---

### Task 6: 통합 검증

**Files:** 없음(버그 발견 시만 수정).

- [ ] **Step 1: 자동** — `pnpm --filter @dbflow/api test`(전체 GREEN) + `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`.
- [ ] **Step 2: 라이브 E2E** (API 재기동 `lsof -ti tcp:3001 | xargs -r kill -9; ./start.sh --no-install`, admin 계정으로 REST 검증 — 스펙 §10 성공 기준):
  1. **무회귀**: 창/동결 0행 상태에서 기존 apply 플로우 정상(FINAL_APPROVED CR 적용 성공).
  2. admin이 PROD에 **현재 시각을 비켜간 창** 등록 → PROD 적용 409 + "다음 작업창" 메시지. 이어서 **현재 시각을 포함하는 창** 추가 → 적용 성공.
  3. PROD 동결 등록(현재 포함 기간, 사유 "분기말 동결") → 창 열려 있어도 적용 409 + 사유 노출. 동결 해제 → 적용 성공.
  4. DEV(창 없음)는 위 과정 내내 적용 가능.
  5. 동결 중 rollback 정상 동작(게이트 비대상).
  6. 창/동결 mutation 4종이 감사 로그(`/audit-logs?action=APPLY_WINDOW_UPDATED` 등)에 기록.
  7. 비ADMIN: POST/DELETE 403, `GET /apply-schedule`·`/status` 200.
  8. `GET /apply-schedule`의 `timezone`이 `Asia/Seoul`(start.sh TZ 주입 확인).
- [ ] **Step 3: 체크리스트 §11 신설 (스펙 §8 산출물)**

`docs/feature-checklist.md`의 §10 뒤, `---`(추천 시나리오 구분선) 앞에 추가:

```markdown
## 11. 작업창 · 동결 (관리자)

- [ ] `/apply-schedule` — 관리자만 접근(그 외 "접근 불가"), 서버 타임존이 Asia/Seoul 아니면 경고 배너
- [ ] 작업창 추가(환경/요일/시작~종료) · 삭제 — 종료 00:00 입력은 24:00(자정)으로 표시
- [ ] 동결 등록(환경/기간 KST/사유) · 해제 — 과거 동결은 목록에 안 보임(의도)
- [ ] **게이트**: 창이 정의된 환경은 창 밖 적용 409 + "다음 작업창" 안내, 창 안 적용 성공
- [ ] **동결 우선**: 창 안이라도 동결 중이면 409 + 사유 노출, 해제 후 적용 성공
- [ ] **무회귀**: 창 없는 환경(기본 DEV)은 항상 적용 가능
- [ ] 동결 중에도 롤백은 정상 동작(게이트 비대상)
- [ ] CR 상세 적용 패널에 배너 3종(적용 가능/작업창 아님+다음 창/동결 중+사유) + 버튼 비활성
- [ ] 창/동결 변경이 감사 로그(`APPLY_WINDOW_UPDATED`/`FREEZE_UPDATED`)에 남고 필터로 조회됨
- [ ] 비ADMIN: 창/동결 POST·DELETE 403, 조회(GET)는 로그인 공통 200
```

```bash
git add docs/feature-checklist.md
git commit -m "docs: add apply window & freeze to feature checklist (§11)"
```

- [ ] **Step 4: 잔여 정리** — 테스트로 만든 창/동결 삭제(또는 DB reset).

---

## Self-Review (작성자 확인 완료)

- **스펙 커버리지**: §2 모델→T1, §3 판정+fail-closed→T2, §4 API·DTO·KST 계약→T2, §1 TZ 강제+§5 게이트→T3, §6 관리 페이지·배너→T4·T5, §7 감사→T1(enum)·T2(record)·T4(필터), §8 체크리스트 §11→T6 Step 3, §10 성공 기준→T6. 전 항목 매핑.
- **타입 일관성**: `ScheduleStatus` 판별 유니언이 서비스(T2)·api.ts(T4)·배너(T5)에서 동일 필드(`allowed/reason/nextWindow/freeze`). 생성자 순서 `(prisma, audit)`(T2), `ApplyService` 5인자 `(prisma, backups, audit, sqlReview, schedule)`(T3). `fmtMin`(1440→"24:00")·`DAY_LABELS` 서버·프론트 동일 규약.
- **파급 인지**: `apply.service.spec.ts` 생성자 호출부는 **86행 팩토리 1곳**(사전 확인) — T3 Step 1이 수정. `endMinute==1440` 케이스는 now분 최대 1439라 exclusive 비교로 안전.
- **주의**: T2 테스트의 freeze mock은 `where.startsAt.lte`(=now)로 조회 조건을 흉내 — 서비스 쿼리 형태(`startsAt: {lte: now}, endsAt: {gt: now}`)와 일치해야 한다. T5는 hot-path 파일 수정 — 배너 추가 외 기존 로직 변경 금지.
