# 환경별 SQL 리뷰 정책 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하드코딩된 lint 규칙 심각도 + DEV 강등을, 환경(DEV/STAGING/PROD)×규칙별 설정 가능한 SQL 리뷰 정책(DISABLED/INFO/WARN/BLOCK)으로 승격하고, ADMIN이 관리하며 정책 변경을 감사한다.

**Architecture:** `lint.engine.ts`를 순수 유지한 채 `lintFiles(files, policyMap)`로 정책화하고, `effectiveSeverity`는 **폴백 함수로 존치**한다. 신규 `SqlReviewService.getPolicyMap(env)`가 DB 정책행을 규칙 카탈로그와 병합해 결손을 `effectiveSeverity`로 채운 **완전한 Map**을 반환(캐싱 없음, DB 실패 시 base 폴백). 정책 21행은 **데이터 마이그레이션**으로 삽입해 `migrate deploy`만으로 무회귀 보장. ADMIN 전용 그리드 UI로 편집, 변경은 감사 로그에 남는다.

**Tech Stack:** NestJS 10, Prisma 5(MySQL, raw SQL 데이터 마이그레이션), class-validator, Jest(`new Service(mockPrisma)` 패턴). Next.js 14 App Router(프론트 테스트 인프라 없음 → `tsc --noEmit` + build + 수동).

**참조 스펙:** `docs/superpowers/specs/2026-07-19-dbflow-sql-review-policy-design.md`

## Global Constraints

- 백엔드 단위테스트: `new Service(mockPrisma)` 직접 생성(Nest TestingModule 없음). 실행 `pnpm --filter @dbflow/api test`.
- 새 런타임 의존성 금지. 프론트 새 라이브러리 금지, 시맨틱 토큰만.
- **무회귀**: 기본 정책 = 현행 `effectiveSeverity`+base 정확 재현. `effectiveSeverity`는 **삭제 금지**(폴백 존치). 정책 21행은 **데이터 마이그레이션**으로 삽입(선택적 seed 아님).
- 강제 수준: `DISABLED`(끔·미보고) / `INFO` / `WARN` / `BLOCK`(적용 게이트 차단). `DISABLED`는 그리드 드롭다운 전용(뱃지 아님, LintItem 미생성).
- 기본 정책표: DROP_DATABASE·DROP_TABLE·TRUNCATE·DELETE_WITHOUT_WHERE·UPDATE_WITHOUT_WHERE → DEV `WARN` / STAGING `BLOCK` / PROD `BLOCK`; ALTER_DROP_COLUMN → 전 환경 `WARN`; DROP_INDEX → 전 환경 `INFO`.
- 정책 API GET/PATCH는 **ADMIN 전용**. 정책 변경은 `AuditAction.SQL_POLICY_UPDATED`/`AuditTargetType.SQL_REVIEW_POLICY`로 감사.
- 캐싱 없음. `getPolicyMap` DB 실패 시 base(=`effectiveSeverity`) 폴백(fail-closed, 적용 자체는 막지 않음).
- 커밋 트레일러: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## 공유 인터페이스 (전 태스크 공통)

```ts
// @prisma/client (Task 1)
enum SqlReviewLevel { DISABLED  INFO  WARN  BLOCK }

// lint.engine.ts (Task 2)
export type PolicyMap = Map<string, SqlReviewLevel>;             // ruleKey → level
export function lintFiles(files: LintFileInput[], policy: PolicyMap): LintResult;
export function effectiveSeverity(base: LintSeverity, env: TargetEnv): LintSeverity;  // 존치
export const RULE_CATALOG: { ruleKey: string; base: LintSeverity; message: string }[]; // matches 제외 노출

// SqlReviewService (Task 3)
getPolicyMap(env: TargetEnv): Promise<PolicyMap>;               // 완전한 7키 Map, 결손/실패는 effectiveSeverity
listCatalogWithLevels(): Promise<{ ruleKey; base; message; levels: Record<TargetEnv, SqlReviewLevel> }[]>;
update(env: TargetEnv, ruleKey: string, level: SqlReviewLevel, actor: AuditActorSnapshot): Promise<void>;
```

---

### Task 1: 스키마 · enum · 데이터 마이그레이션(21행) · 감사 enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_sql_review_policy/migration.sql` (prisma 생성 후 21행 INSERT 추가)
- Modify: `apps/api/prisma/seed.ts` (dev 편의 upsert)

**Interfaces:**
- Produces: `SqlReviewLevel` enum, `SqlReviewRule` 모델, `AuditAction.SQL_POLICY_UPDATED`, `AuditTargetType.SQL_REVIEW_POLICY`, DB에 21행.

- [ ] **Step 1: 스키마에 enum·모델·감사 enum 값 추가**

`apps/api/prisma/schema.prisma`에 추가:
```prisma
enum SqlReviewLevel { DISABLED  INFO  WARN  BLOCK }

model SqlReviewRule {
  id        String         @id @default(cuid())
  env       TargetEnv
  ruleKey   String
  level     SqlReviewLevel
  updatedAt DateTime       @updatedAt

  @@unique([env, ruleKey])
  @@index([env])
  @@map("sql_review_rule")
}
```
그리고 기존 `enum AuditAction { … }`에 `SQL_POLICY_UPDATED` 한 줄, `enum AuditTargetType { … }`에 `SQL_REVIEW_POLICY` 한 줄 추가.

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm --filter @dbflow/api exec prisma migrate dev --name sql_review_policy`
Expected: `sql_review_rule` 테이블 + enum 확장 마이그레이션 생성·적용.

- [ ] **Step 3: 21행 데이터 삽입을 마이그레이션에 추가**

방금 생성된 `migration.sql` 끝에 append(그리고 재적용). cuid 대신 결정적 id 사용:
```sql
INSERT INTO `sql_review_rule` (`id`,`env`,`ruleKey`,`level`,`updatedAt`) VALUES
 ('srr_dev_drop_database','DEV','DROP_DATABASE','WARN',NOW(3)),
 ('srr_dev_drop_table','DEV','DROP_TABLE','WARN',NOW(3)),
 ('srr_dev_truncate','DEV','TRUNCATE','WARN',NOW(3)),
 ('srr_dev_delete_no_where','DEV','DELETE_WITHOUT_WHERE','WARN',NOW(3)),
 ('srr_dev_update_no_where','DEV','UPDATE_WITHOUT_WHERE','WARN',NOW(3)),
 ('srr_dev_alter_drop_column','DEV','ALTER_DROP_COLUMN','WARN',NOW(3)),
 ('srr_dev_drop_index','DEV','DROP_INDEX','INFO',NOW(3)),
 ('srr_stg_drop_database','STAGING','DROP_DATABASE','BLOCK',NOW(3)),
 ('srr_stg_drop_table','STAGING','DROP_TABLE','BLOCK',NOW(3)),
 ('srr_stg_truncate','STAGING','TRUNCATE','BLOCK',NOW(3)),
 ('srr_stg_delete_no_where','STAGING','DELETE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_stg_update_no_where','STAGING','UPDATE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_stg_alter_drop_column','STAGING','ALTER_DROP_COLUMN','WARN',NOW(3)),
 ('srr_stg_drop_index','STAGING','DROP_INDEX','INFO',NOW(3)),
 ('srr_prod_drop_database','PROD','DROP_DATABASE','BLOCK',NOW(3)),
 ('srr_prod_drop_table','PROD','DROP_TABLE','BLOCK',NOW(3)),
 ('srr_prod_truncate','PROD','TRUNCATE','BLOCK',NOW(3)),
 ('srr_prod_delete_no_where','PROD','DELETE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_prod_update_no_where','PROD','UPDATE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_prod_alter_drop_column','PROD','ALTER_DROP_COLUMN','WARN',NOW(3)),
 ('srr_prod_drop_index','PROD','DROP_INDEX','INFO',NOW(3));
```
재적용: `pnpm --filter @dbflow/api exec prisma migrate reset --force` (dev, 전체 재적용 + seed) — 트리거·감사·이 데이터까지 전부 반영.

- [ ] **Step 4: seed.ts에 동일 정책 upsert(dev 편의)**

`apps/api/prisma/seed.ts` `main()` 끝에 추가(마이그레이션이 진실 소스이나 reset 후 dev 편의로 idempotent 유지):
```ts
const LEVELS = {
  DEV:     { DROP_DATABASE:'WARN', DROP_TABLE:'WARN', TRUNCATE:'WARN', DELETE_WITHOUT_WHERE:'WARN', UPDATE_WITHOUT_WHERE:'WARN', ALTER_DROP_COLUMN:'WARN', DROP_INDEX:'INFO' },
  STAGING: { DROP_DATABASE:'BLOCK', DROP_TABLE:'BLOCK', TRUNCATE:'BLOCK', DELETE_WITHOUT_WHERE:'BLOCK', UPDATE_WITHOUT_WHERE:'BLOCK', ALTER_DROP_COLUMN:'WARN', DROP_INDEX:'INFO' },
  PROD:    { DROP_DATABASE:'BLOCK', DROP_TABLE:'BLOCK', TRUNCATE:'BLOCK', DELETE_WITHOUT_WHERE:'BLOCK', UPDATE_WITHOUT_WHERE:'BLOCK', ALTER_DROP_COLUMN:'WARN', DROP_INDEX:'INFO' },
} as const;
for (const [env, rules] of Object.entries(LEVELS)) {
  for (const [ruleKey, level] of Object.entries(rules)) {
    await prisma.sqlReviewRule.upsert({
      where: { env_ruleKey: { env: env as any, ruleKey } },
      update: { level: level as any },
      create: { env: env as any, ruleKey, level: level as any },
    });
  }
}
```

- [ ] **Step 5: 클라이언트 재생성 + 행 확인 + Commit**

Run: `pnpm --filter @dbflow/api exec prisma generate && docker compose -f docker/docker-compose.yml exec -T mysql mysql -udbflow -pdbflow dbflow -e "SELECT env,ruleKey,level FROM sql_review_rule ORDER BY env,ruleKey;"`
Expected: 21행, 위 표와 일치.
```bash
git add apps/api/prisma
git commit -m "feat(api): SqlReviewRule schema + 21-row default policy migration + audit enums"
```

---

### Task 2: lint 엔진 정책화 (순수 유지, effectiveSeverity 존치)

**Files:**
- Modify: `apps/api/src/apply/lint.engine.ts`
- Modify: `apps/api/src/apply/lint.engine.spec.ts`

**Interfaces:**
- Consumes: `SqlReviewLevel` (Task 1).
- Produces: `PolicyMap = Map<string, SqlReviewLevel>`, `lintFiles(files, policy: PolicyMap): LintResult`, `effectiveSeverity`(존치), `RULE_CATALOG`.

- [ ] **Step 1: 실패 테스트 작성 (정책 Map 기반 lint + DISABLED 스킵)**

`lint.engine.spec.ts`를 새 시그니처로 갱신(기존 `lintFiles(files, env)`·`effectiveSeverity` 테스트를 아래로 교체/보강):
```ts
import { lintFiles, effectiveSeverity, RULE_CATALOG, type PolicyMap } from './lint.engine';

function mapOf(entries: Record<string, string>): PolicyMap {
  return new Map(Object.entries(entries) as any);
}

describe('lintFiles(files, policy)', () => {
  const dropTable = [{ filename: 'a.sql', content: 'DROP TABLE users;' }];

  it('emits BLOCK when policy sets the rule to BLOCK', () => {
    const r = lintFiles(dropTable, mapOf({ DROP_TABLE: 'BLOCK' }));
    expect(r.maxSeverity).toBe('BLOCK');
    expect(r.items[0].rule).toBe('DROP_TABLE');
  });

  it('emits WARN when policy downgrades the rule', () => {
    const r = lintFiles(dropTable, mapOf({ DROP_TABLE: 'WARN' }));
    expect(r.maxSeverity).toBe('WARN');
  });

  it('skips the rule entirely when DISABLED', () => {
    const r = lintFiles(dropTable, mapOf({ DROP_TABLE: 'DISABLED' }));
    expect(r.items).toHaveLength(0);
  });
});

describe('effectiveSeverity (fallback, retained)', () => {
  it('downgrades BLOCK→WARN on DEV', () => {
    expect(effectiveSeverity('BLOCK', 'DEV' as any)).toBe('WARN');
  });
  it('keeps base on STAGING/PROD', () => {
    expect(effectiveSeverity('BLOCK', 'PROD' as any)).toBe('BLOCK');
  });
});

describe('RULE_CATALOG', () => {
  it('exposes 7 rules with key/base/message (no matcher)', () => {
    expect(RULE_CATALOG).toHaveLength(7);
    expect(RULE_CATALOG.map((r) => r.ruleKey)).toContain('DROP_TABLE');
    expect((RULE_CATALOG as any)[0].matches).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @dbflow/api test -- lint.engine`
Expected: FAIL (시그니처 불일치 / RULE_CATALOG 미존재).

- [ ] **Step 3: 엔진 구현 변경**

`lint.engine.ts`:
- 상단에 `import { SqlReviewLevel } from '@prisma/client';` 추가, `export type PolicyMap = Map<string, SqlReviewLevel>;`.
- `RULES` 배열은 그대로 두고, matcher를 제외한 카탈로그 export 추가:
```ts
export const RULE_CATALOG: { ruleKey: string; base: LintSeverity; message: string }[] =
  RULES.map((r) => ({ ruleKey: r.rule, base: r.base, message: r.message }));
```
- `effectiveSeverity`는 **그대로 유지**(삭제 금지).
- `lintFiles`를 정책 기반으로 교체:
```ts
export function lintFiles(files: LintFileInput[], policy: PolicyMap): LintResult {
  const items: LintItem[] = [];
  for (const file of files) {
    for (const stmt of analyzeSql(file.content)) {
      for (const rule of RULES) {
        if (!rule.matches(stmt)) continue;
        const level = policy.get(rule.rule);
        if (level === 'DISABLED' || level == null) continue; // DISABLED 또는 결손 → 미보고
        items.push({
          filename: file.filename,
          line: stmt.line,
          rule: rule.rule,
          severity: level, // 'INFO' | 'WARN' | 'BLOCK'
          message: rule.message,
        });
      }
    }
  }
  const maxSeverity = items.reduce<LintSeverity>(
    (max, i) => (SEVERITY_ORDER[i.severity] > SEVERITY_ORDER[max] ? i.severity : max),
    'INFO',
  );
  return { items, maxSeverity };
}
```
(주의: `level == null`은 방어용 — 정상 경로에서 `getPolicyMap`이 완전한 Map을 주므로 발생하지 않음. `severity: level`은 DISABLED 제외 시 `INFO|WARN|BLOCK`이라 `LintSeverity`와 호환; 필요 시 `level as LintSeverity`.)
- `hasBlock`은 그대로.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test -- lint.engine`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/apply/lint.engine.ts apps/api/src/apply/lint.engine.spec.ts
git commit -m "feat(api): policy-driven lintFiles; retain effectiveSeverity as fallback; export RULE_CATALOG"
```

---

### Task 3: SqlReviewService (정책 로딩·수정·감사) + 모듈

**Files:**
- Create: `apps/api/src/sql-review/sql-review.service.ts`
- Create: `apps/api/src/sql-review/sql-review.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/sql-review/sql-review.service.spec.ts`

**Interfaces:**
- Consumes: `RULE_CATALOG`/`effectiveSeverity`/`PolicyMap` (Task 2), `AuditService` (@Global), `AuditActorSnapshot`.
- Produces: `getPolicyMap(env)`, `listCatalogWithLevels()`, `update(env, ruleKey, level, actor)`. `SqlReviewModule` exports `SqlReviewService`.

- [ ] **Step 1: 실패 테스트 (완전한 Map + 결손/실패 폴백 + update 감사)**

`sql-review.service.spec.ts`:
```ts
import { SqlReviewService } from './sql-review.service';

describe('SqlReviewService.getPolicyMap', () => {
  it('returns a complete 7-key map, filling DB gaps with effectiveSeverity', async () => {
    const prisma: any = { sqlReviewRule: { findMany: () => Promise.resolve([{ ruleKey: 'DROP_TABLE', level: 'BLOCK' }]) } };
    const svc = new SqlReviewService(prisma, { record: () => Promise.resolve() } as any);
    const map = await svc.getPolicyMap('DEV' as any);
    expect(map.size).toBe(7);
    expect(map.get('DROP_TABLE')).toBe('BLOCK');       // DB row
    expect(map.get('TRUNCATE')).toBe('WARN');           // gap → effectiveSeverity(BLOCK, DEV)=WARN
    expect(map.get('DROP_INDEX')).toBe('INFO');         // gap → base INFO
  });

  it('fails closed to base map when the DB query throws', async () => {
    const prisma: any = { sqlReviewRule: { findMany: () => Promise.reject(new Error('db down')) } };
    const svc = new SqlReviewService(prisma, { record: () => Promise.resolve() } as any);
    const map = await svc.getPolicyMap('PROD' as any);
    expect(map.size).toBe(7);
    expect(map.get('DROP_TABLE')).toBe('BLOCK');         // PROD base
  });
});

describe('SqlReviewService.update', () => {
  it('upserts the level and records an audit event', async () => {
    let upserted: any = null; const records: any[] = [];
    const prisma: any = {
      sqlReviewRule: {
        findUnique: () => Promise.resolve({ level: 'WARN' }),
        upsert: (a: any) => { upserted = a; return Promise.resolve({}); },
      },
    };
    const svc = new SqlReviewService(prisma, { record: (i: any) => { records.push(i); return Promise.resolve(); } } as any);
    await svc.update('DEV' as any, 'TRUNCATE', 'BLOCK' as any, { userId: 'a', name: '관리자', role: 'ADMIN', department: '운영팀' });
    expect(upserted.create).toMatchObject({ env: 'DEV', ruleKey: 'TRUNCATE', level: 'BLOCK' });
    expect(records[0]).toMatchObject({ action: 'SQL_POLICY_UPDATED', targetType: 'SQL_REVIEW_POLICY' });
    expect(records[0].metadata).toMatchObject({ env: 'DEV', ruleKey: 'TRUNCATE', from: 'WARN', to: 'BLOCK' });
  });

  it('rejects an unknown ruleKey', async () => {
    const svc = new SqlReviewService({} as any, { record: () => Promise.resolve() } as any);
    await expect(svc.update('DEV' as any, 'NOPE', 'BLOCK' as any, {} as any)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @dbflow/api test -- sql-review.service`
Expected: FAIL (미존재).

- [ ] **Step 3: 서비스 구현**

`apps/api/src/sql-review/sql-review.service.ts`:
```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditTargetType, SqlReviewLevel, TargetEnv } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';
import { RULE_CATALOG, effectiveSeverity, type PolicyMap } from '../apply/lint.engine';

const RULE_KEYS = new Set(RULE_CATALOG.map((r) => r.ruleKey));

@Injectable()
export class SqlReviewService {
  private readonly logger = new Logger(SqlReviewService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** 완전한 7키 정책 Map. DB 결손/실패는 effectiveSeverity(base, env)로 채운다(fail-closed). */
  async getPolicyMap(env: TargetEnv): Promise<PolicyMap> {
    let byKey = new Map<string, SqlReviewLevel>();
    try {
      const rows = await this.prisma.sqlReviewRule.findMany({ where: { env }, select: { ruleKey: true, level: true } });
      byKey = new Map(rows.map((r) => [r.ruleKey, r.level]));
    } catch (err) {
      this.logger.error(`sql review policy load failed, using base fallback: ${(err as Error).message}`);
    }
    const map: PolicyMap = new Map();
    for (const rule of RULE_CATALOG) {
      map.set(rule.ruleKey, byKey.get(rule.ruleKey) ?? (effectiveSeverity(rule.base, env) as SqlReviewLevel));
    }
    return map;
  }

  /** 그리드 렌더용: 카탈로그 + 환경별 현재 level. */
  async listCatalogWithLevels() {
    const rows = await this.prisma.sqlReviewRule.findMany();
    const lvl = (env: TargetEnv, key: string, base: string) =>
      rows.find((r) => r.env === env && r.ruleKey === key)?.level ??
      (effectiveSeverity(base as any, env) as SqlReviewLevel);
    return RULE_CATALOG.map((r) => ({
      ruleKey: r.ruleKey, base: r.base, message: r.message,
      levels: {
        DEV: lvl('DEV', r.ruleKey, r.base),
        STAGING: lvl('STAGING', r.ruleKey, r.base),
        PROD: lvl('PROD', r.ruleKey, r.base),
      },
    }));
  }

  async update(env: TargetEnv, ruleKey: string, level: SqlReviewLevel, actor: AuditActorSnapshot) {
    if (!RULE_KEYS.has(ruleKey)) throw new BadRequestException('알 수 없는 규칙입니다.');
    const prev = await this.prisma.sqlReviewRule.findUnique({ where: { env_ruleKey: { env, ruleKey } }, select: { level: true } });
    await this.prisma.sqlReviewRule.upsert({
      where: { env_ruleKey: { env, ruleKey } },
      update: { level },
      create: { env, ruleKey, level },
    });
    await this.audit.record({
      actor, action: AuditAction.SQL_POLICY_UPDATED, targetType: AuditTargetType.SQL_REVIEW_POLICY,
      targetId: `${env}:${ruleKey}`, summary: `SQL 리뷰 정책 변경: ${env}/${ruleKey} → ${level}`,
      metadata: { env, ruleKey, from: prev?.level ?? null, to: level },
    });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test -- sql-review.service`
Expected: PASS

- [ ] **Step 5: 모듈 + AppModule 등록**

`apps/api/src/sql-review/sql-review.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { SqlReviewService } from './sql-review.service';

@Module({
  imports: [PassportModule],
  providers: [SqlReviewService, PrismaService],
  exports: [SqlReviewService],
})
export class SqlReviewModule {}
```
`app.module.ts` imports에 `SqlReviewModule` 추가.

- [ ] **Step 6: 빌드 + Commit**

Run: `pnpm --filter @dbflow/api build`
```bash
git add apps/api/src/sql-review apps/api/src/app.module.ts
git commit -m "feat(api): SqlReviewService — policy map, catalog+levels, audited update"
```

---

### Task 4: 정책 API (ADMIN GET/PATCH)

**Files:**
- Create: `apps/api/src/sql-review/sql-review.controller.ts`
- Create: `apps/api/src/sql-review/dto/update-policy.dto.ts`
- Modify: `apps/api/src/sql-review/sql-review.module.ts`

**Interfaces:**
- Produces: `GET /sql-review-policy`(ADMIN) → 카탈로그+levels, `PATCH /sql-review-policy`(ADMIN) body `{env, ruleKey, level}`.

- [ ] **Step 1: DTO**

`apps/api/src/sql-review/dto/update-policy.dto.ts`:
```ts
import { IsEnum, IsIn } from 'class-validator';
import { SqlReviewLevel, TargetEnv } from '@prisma/client';
import { RULE_CATALOG } from '../../apply/lint.engine';

const RULE_KEYS = RULE_CATALOG.map((r) => r.ruleKey);

export class UpdatePolicyDto {
  @IsEnum(TargetEnv) env!: TargetEnv;
  @IsIn(RULE_KEYS) ruleKey!: string;
  @IsEnum(SqlReviewLevel) level!: SqlReviewLevel;
}
```

- [ ] **Step 2: 컨트롤러**

`apps/api/src/sql-review/sql-review.controller.ts`:
```ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SqlReviewService } from './sql-review.service';
import { UpdatePolicyDto } from './dto/update-policy.dto';

@Controller('sql-review-policy')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class SqlReviewController {
  constructor(private readonly svc: SqlReviewService) {}

  @Get()
  list() {
    return this.svc.listCatalogWithLevels();
  }

  @Patch()
  update(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdatePolicyDto) {
    return this.svc.update(dto.env, dto.ruleKey, dto.level, {
      userId: user.userId, name: user.name, role: user.role, department: user.department,
    });
  }
}
```
`sql-review.module.ts`의 `controllers: [SqlReviewController]` 추가.

- [ ] **Step 3: 빌드 + 수동 확인**

Run: `pnpm --filter @dbflow/api build`
Expected: 성공. (수동: admin 토큰으로 `GET /sql-review-policy` 200 + 7행 · `PATCH` 200, dev 토큰은 403)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/sql-review
git commit -m "feat(api): admin SQL review policy endpoints (GET/PATCH)"
```

---

### Task 5: apply 서비스 정책 연동 (호출부 2곳 + 모듈 + 테스트)

**Files:**
- Modify: `apps/api/src/apply/apply.service.ts`
- Modify: `apps/api/src/apply/apply.module.ts`
- Modify: `apps/api/src/apply/apply.service.spec.ts`

**Interfaces:**
- Consumes: `SqlReviewService.getPolicyMap` (Task 3), `lintFiles(files, policyMap)` (Task 2).

- [ ] **Step 1: apply.service에 SqlReviewService 주입 + 두 호출부 교체**

`apply.service.ts` 생성자에 `private readonly sqlReview: SqlReviewService` 추가(import). 적용 게이트(현행 `const lint = lintFiles(changeRequest.files, target.env);`)를:
```ts
    const policy = await this.sqlReview.getPolicyMap(target.env);
    const lint = lintFiles(changeRequest.files, policy);
```
`lint()` 미리보기(현행 `const result = lintFiles(changeRequest.files, changeRequest.targetEnv);`)를:
```ts
    const policy = await this.sqlReview.getPolicyMap(changeRequest.targetEnv);
    const result = lintFiles(changeRequest.files, policy);
```
`hasBlock`·게이트 예외 로직·배치(트랜잭션 밖)는 그대로.

- [ ] **Step 2: ApplyModule에 SqlReviewService 제공**

`apply.module.ts`: `imports: [PassportModule, SqlReviewModule]` (import 문 추가). `SqlReviewModule`이 `SqlReviewService`를 export하므로 주입 가능.

- [ ] **Step 3: apply.service.spec 하네스 갱신 (회귀 보존)**

`apply.service.spec.ts`의 `new ApplyService(prisma, backups as any, audit as any)`를 4번째 인자로 갱신. 기본 정책 Map을 반환하는 mock을 상단에 정의:
```ts
import { RULE_CATALOG, effectiveSeverity } from './lint.engine';
const defaultPolicy = (env: any) =>
  new Map(RULE_CATALOG.map((r) => [r.ruleKey, effectiveSeverity(r.base, env)]));
const sqlReview = { getPolicyMap: (env: any) => Promise.resolve(defaultPolicy(env)) };
// ...
const service = new ApplyService(prisma, backups as any, audit as any, sqlReview as any);
```
이러면 기존 게이트 테스트(`DROP TABLE` PROD 차단 / DEV 통과)가 **정책 경유로도 동일 결과**로 통과한다. (기존 lint 게이트 테스트 케이스는 그대로 유지.)

- [ ] **Step 4: 전체 테스트 + 빌드**

Run: `pnpm --filter @dbflow/api test && pnpm --filter @dbflow/api build`
Expected: 전체 PASS(기존 게이트 회귀 포함) + 컴파일 성공.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/apply
git commit -m "feat(api): apply lint gate and preview use env SQL review policy"
```

---

### Task 6: 프론트 — 정책 그리드 + API + 네비 + 감사 필터 옵션

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/app/(app)/sql-review/page.tsx`
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/icons.tsx`
- Modify: `apps/web/app/(app)/audit/page.tsx`

**Interfaces:**
- Consumes: `GET /sql-review-policy`, `PATCH /sql-review-policy`.

- [ ] **Step 1: api 클라이언트**

`apps/web/lib/api.ts`에 추가:
```ts
export type SqlReviewLevel = 'DISABLED' | 'INFO' | 'WARN' | 'BLOCK';
export type SqlReviewRuleRow = {
  ruleKey: string; base: string; message: string;
  levels: { DEV: SqlReviewLevel; STAGING: SqlReviewLevel; PROD: SqlReviewLevel };
};
export function listSqlReviewPolicy() {
  return apiFetch<SqlReviewRuleRow[]>(`/sql-review-policy`);
}
export function updateSqlReviewPolicy(env: string, ruleKey: string, level: SqlReviewLevel) {
  return apiFetch<unknown>(`/sql-review-policy`, { method: 'PATCH', body: JSON.stringify({ env, ruleKey, level }) });
}
```

- [ ] **Step 2: 감사 필터 옵션에 새 값 추가 (M2)**

`apps/web/app/(app)/audit/page.tsx`의 하드코딩 `ACTION_OPTIONS`에 `'SQL_POLICY_UPDATED'` 추가, `TARGET_TYPE_OPTIONS`에 `'SQL_REVIEW_POLICY'` 추가(기존 배열에 문자열 원소만 추가, 순서 무관).

- [ ] **Step 3: 정책 그리드 페이지**

`apps/web/app/(app)/sql-review/page.tsx` — `useUser()`로 ADMIN 아니면 "접근 불가" 카드. `PageHeader title="SQL 리뷰 정책"`. `listSqlReviewPolicy()` 로드 → **테이블**: 행=규칙(`ruleKey` + `message`), 열=DEV/STAGING/PROD, 셀=`<select>`(DISABLED/INFO/WARN/BLOCK). 변경 시 `updateSqlReviewPolicy(env, ruleKey, level)` 호출 → 성공 시 로컬 상태 반영(낙관적) + 실패 시 에러 배너·되돌림. 토큰: 기존 `target-databases`/`audit` 테이블 패턴(`bg-card`,`ring-border`,`inputClass`) 재사용. BLOCK 셀은 강조(예: red 텍스트), DISABLED는 muted.

- [ ] **Step 4: 사이드바 ADMIN 네비 + 아이콘**

`sidebar.tsx`의 NAV에 `{ href:'/sql-review', label:'SQL 리뷰 정책', Icon: ShieldCheckIcon, roles:['ADMIN'] }` 추가(감사 로그 항목 옆). `icons.tsx`에 `ShieldCheckIcon`(기존 아이콘 스타일과 동일한 stroke/viewBox) 추가.

- [ ] **Step 5: tsc + build**

Run: `pnpm --filter @dbflow/web exec tsc --noEmit && pnpm --filter @dbflow/web build`
Expected: 0 errors + `/sql-review` 라우트 컴파일.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): admin SQL review policy grid, nav, audit filter options"
```

---

### Task 7: 통합 검증

**Files:** 없음(검증 전용)

- [ ] **Step 1: 백엔드 전체 테스트**

Run: `pnpm --filter @dbflow/api test`
Expected: 전체 PASS(신규 sql-review + lint.engine 정책화 + apply 게이트 회귀 포함).

- [ ] **Step 2: 프론트 빌드**

Run: `pnpm --filter @dbflow/web build`
Expected: `/sql-review` 포함 전 라우트 컴파일, tsc 0.

- [ ] **Step 3: 라이브 E2E (수동, api 새 코드로 재기동)**

`./stop.sh; lsof -ti tcp:3001 | xargs -r kill -9; ./start.sh --no-install` (또는 api 재기동으로 새 코드 반영 — 이전 교훈: 옛 프로세스가 3001 물면 kill).
확인:
- **무회귀**: 기본 정책으로 DEV `DROP TABLE` 적용 통과(강등), PROD/STAGING 적용 차단(BLOCK).
- admin(`admin@dbflow.io`)으로 `/sql-review` 그리드 조회·수정 가능, dev 토큰 `PATCH`는 403.
- **정책 반영**: DEV의 `TRUNCATE`를 `BLOCK`으로 변경 → DEV 대상 CR 적용/미리보기에서 BLOCK 차단됨. `DISABLED`로 변경 → 해당 규칙 미표시.
- **감사**: 정책 변경이 `/audit`에 `SQL_POLICY_UPDATED`로 남고, 감사 필터에서 조회됨.
- `--seed` 없이 재기동해도 21행이 남아있음(데이터 마이그레이션): `SELECT COUNT(*) FROM sql_review_rule;` = 21.

- [ ] **Step 4: 최종 커밋(있으면)**

```bash
git add -A && git commit -m "chore: sql review policy integration verified" || true
```

---

## Self-Review (작성자 확인 완료)

- **스펙 커버리지**: §3 모델/enum→T1, §4 기본표(데이터 마이그레이션)→T1, §5 엔진 정책화+effectiveSeverity 존치→T2, `SqlReviewService`(getPolicyMap 완전Map·fail-closed·update 감사)→T3, §7 API(ADMIN)→T4, §6 소비처 2곳+ApplyModule→T5, §8 UI+§9 감사연동+M2 감사옵션→T6. 전 항목 매핑.
- **플레이스홀더**: 각 코드 스텝에 실제 코드. T6 프론트 그리드는 기존 테이블 패턴 참조를 토큰·동작으로 구체화.
- **타입 일관성**: `PolicyMap`·`RULE_CATALOG`·`getPolicyMap`·`listCatalogWithLevels`·`update`·`SqlReviewLevel`·`UpdatePolicyDto` 시그니처가 T2~T6에서 일치. `ApplyService` 생성자 4번째 인자(SqlReviewService)를 T5가 추가하고 spec 하네스도 갱신.
- **무회귀 이중 보장 검증 포인트**: T1(데이터 마이그레이션 21행) + T2/T3(effectiveSeverity 폴백) + T5(기본 정책 Map == 현행 게이트 회귀 테스트) + T7 Step3(라이브 무회귀).
- **주의**: T5는 `apply.service.spec`의 수동 인스턴스화에 SqlReviewService mock을 추가해야 기존 게이트 테스트가 통과(그 mock은 `effectiveSeverity` 기반 기본 정책 Map을 반환).
