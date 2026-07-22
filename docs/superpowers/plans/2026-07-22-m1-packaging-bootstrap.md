# M1 패키징 + 관리자 부트스트랩 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `git clone` → `.env` 작성 → `docker compose up` → 관리자 로그인이 되는 셀프호스팅 패키징 (스펙: `docs/superpowers/specs/2026-07-22-m1-packaging-bootstrap-design.md`).

**Architecture:** api/web 프로덕션 멀티스테이지 Dockerfile + 루트 compose(mysql·api·web, api 포트 미공개). web은 Route Handler 프록시(`/api/*`)로 api에 접근(런타임 env). api는 부팅 시 env fail-fast 검증 + `BootstrapService`가 seed.ts를 대체(관리자 env 생성, 데모 opt-in).

**Tech Stack:** NestJS 10, Prisma 5, Next.js 14 App Router(standalone), pnpm 9 workspace, node:22-bookworm-slim, MySQL 8.

## Global Constraints

- 작업 브랜치: `feat/m1-packaging` (master에서 분기, 완료 후 PR)
- Node 22 / pnpm 9 (`packageManager: pnpm@9.0.0`), 컨테이너 베이스는 `node:22-bookworm-slim` 고정 (alpine 금지 — argon2/prisma glibc)
- `pnpm install`은 Docker에서 항상 `--frozen-lockfile`
- 기존 개발 워크플로(`./start.sh`, `docker/docker-compose.yml`, `stop.sh`) 회귀 금지. `stop.sh`·`docker/docker-compose.yml`은 수정하지 않는다
- 시크릿을 리포/이미지에 넣지 않는다: `.dockerignore`에 `.env` 필수, 커밋 전 `git status`로 .env 미포함 확인
- 데모 계정 비밀번호 `password1234`, 관리자 부트스트랩 env 이름은 `DBFLOW_ADMIN_EMAIL`/`DBFLOW_ADMIN_PASSWORD`, 데모 플래그는 `DBFLOW_DEMO=true` (스펙 고정)
- api 테스트: `pnpm --filter @dbflow/api test` 전체 통과 유지

---

### Task 1: api env fail-fast 검증

**Files:**
- Create: `apps/api/src/config/validate-env.ts`
- Create: `apps/api/src/config/validate-env.spec.ts`
- Create: `apps/api/test/setup-env.ts`
- Modify: `apps/api/jest.config.js`
- Modify: `apps/api/src/main.ts:1-14`
- Modify: `apps/api/src/auth/auth.module.ts:12`
- Modify: `apps/api/src/auth/jwt.strategy.ts:11`

**Interfaces:**
- Produces: `validateEnv(env?: NodeJS.ProcessEnv): string[]` (에러 메시지 배열, 빈 배열 = 통과). 모듈 로드 시 side-effect로 `.env` 로드 + 검증 실패 시 `process.exit(1)` (`NODE_ENV=test`면 skip). Task 2~9는 "JWT_SECRET/APP_ENCRYPTION_KEY는 항상 유효하게 존재"를 전제로 한다.

- [ ] **Step 1: 브랜치 생성**

```bash
git checkout -b feat/m1-packaging master
```

- [ ] **Step 2: jest env 셋업 파일 작성** (fallback 제거로 깨질 테스트 선제 대응)

`apps/api/test/setup-env.ts`:
```ts
// 테스트 전용 env — fail-fast 검증을 통과하는 유효한 값
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-0123456789-0123456789';
process.env.APP_ENCRYPTION_KEY =
  process.env.APP_ENCRYPTION_KEY ?? '1111111111111111111111111111111111111111111111111111111111111111';
```

`apps/api/jest.config.js`에 한 줄 추가:
```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
};
```

- [ ] **Step 3: validateEnv 실패 테스트 작성**

`apps/api/src/config/validate-env.spec.ts`:
```ts
import { validateEnv } from './validate-env';

const VALID = {
  JWT_SECRET: 'a-sufficiently-long-real-secret-value',
  APP_ENCRYPTION_KEY: 'ab'.repeat(32),
} as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('유효한 env는 통과한다', () => {
    expect(validateEnv(VALID)).toEqual([]);
  });

  it('JWT_SECRET 미설정/기본값/짧은 값을 거부한다', () => {
    expect(validateEnv({ ...VALID, JWT_SECRET: undefined })).not.toEqual([]);
    expect(validateEnv({ ...VALID, JWT_SECRET: 'change-me-in-prod' })).not.toEqual([]);
    expect(validateEnv({ ...VALID, JWT_SECRET: 'short' })).not.toEqual([]);
  });

  it('APP_ENCRYPTION_KEY 미설정/제로/비-hex/길이 오류를 거부한다', () => {
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: undefined })).not.toEqual([]);
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: '0'.repeat(64) })).not.toEqual([]);
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: 'zz'.repeat(32) })).not.toEqual([]);
    expect(validateEnv({ ...VALID, APP_ENCRYPTION_KEY: 'ab'.repeat(16) })).not.toEqual([]);
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm --filter @dbflow/api test -- validate-env`
Expected: FAIL — `Cannot find module './validate-env'`

- [ ] **Step 5: validate-env.ts 구현**

`apps/api/src/config/validate-env.ts`:
```ts
/**
 * 부팅 전 env 로드 + fail-fast 검증 (단일 지점).
 * main.ts의 "첫 번째 import"여야 한다 — auth.module 등이 모듈 스코프에서
 * process.env를 읽기 전에 .env 로드가 끝나 있어야 하기 때문.
 */

function tryLoadDotenv() {
  // Node 20.12+/22 내장. cwd(개발: apps/api)의 .env를 로드하고, 없으면(컨테이너) 무시.
  // 이미 설정된 process.env를 덮어쓰지 않는다.
  const p = process as NodeJS.Process & { loadEnvFile?: (path?: string) => void };
  try {
    p.loadEnvFile?.();
  } catch {
    /* .env 없음 — 컨테이너/CI는 process env 사용 */
  }
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];

  const jwt = env.JWT_SECRET;
  if (!jwt || jwt === 'change-me-in-prod' || jwt.length < 16) {
    errors.push(
      'JWT_SECRET이 없거나 기본값/16자 미만입니다. 생성: openssl rand -hex 32',
    );
  }

  const key = env.APP_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key) || /^0+$/.test(key)) {
    errors.push(
      'APP_ENCRYPTION_KEY는 64자 hex여야 하며 전부 0일 수 없습니다. 생성: openssl rand -hex 32',
    );
  }

  return errors;
}

tryLoadDotenv();
if (process.env.NODE_ENV !== 'test') {
  const errors = validateEnv();
  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[dbflow] 부팅 중단 — 환경변수 오류:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test -- validate-env`
Expected: PASS (3 tests)

- [ ] **Step 7: main.ts 첫 import + fallback 제거**

`apps/api/src/main.ts` 1행에 추가 (기존 import들보다 위):
```ts
import './config/validate-env'; // 반드시 첫 import — .env 로드 + fail-fast
```

`apps/api/src/auth/auth.module.ts:12`:
```ts
      secret: process.env.JWT_SECRET as string,
```

`apps/api/src/auth/jwt.strategy.ts:11`:
```ts
      secretOrKey: process.env.JWT_SECRET as string,
```

- [ ] **Step 8: 전체 테스트 + fail-fast 수동 확인**

Run: `pnpm --filter @dbflow/api test`
Expected: 전체 PASS (setup-env.ts 덕분에 fallback 제거에도 통과)

Run: `cd apps/api && JWT_SECRET=change-me-in-prod APP_ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) DATABASE_URL=mysql://x pnpm exec ts-node -e "require('./src/config/validate-env')"`
Expected: `[dbflow] 부팅 중단 — 환경변수 오류:` 출력 + exit code 1 (`echo $?` → 1)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/config apps/api/test apps/api/jest.config.js apps/api/src/main.ts apps/api/src/auth
git commit -m "feat(api): fail-fast env validation, remove insecure JWT_SECRET fallback"
```

---

### Task 2: BootstrapService — 관리자 env 부트스트랩 + 데모 시드 (seed.ts 대체)

**Files:**
- Create: `apps/api/src/bootstrap/bootstrap.service.ts`
- Create: `apps/api/src/bootstrap/bootstrap.module.ts`
- Create: `apps/api/src/bootstrap/bootstrap.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (BootstrapModule import 추가)
- Delete: `apps/api/prisma/seed.ts`
- Modify: `apps/api/package.json` (`"prisma": { "seed": ... }` 블록 제거)

**Interfaces:**
- Consumes: `PrismaService`(`../prisma/prisma.service`), `argon2.hash`
- Produces: 부팅 시 자동 실행되는 `BootstrapService.onApplicationBootstrap()`. 동작 규약(Task 5·8·9가 의존): ① `DBFLOW_ADMIN_EMAIL`+`DBFLOW_ADMIN_PASSWORD` 설정 && 해당 email 계정 없음 → ADMIN 생성(기존 계정은 절대 덮어쓰지 않음) ② `DBFLOW_DEMO === 'true'` → 데모 4계정·sqlReviewRule·approvalPolicy upsert(멱등) ③ 이후에도 사용자 0명 → 안내 메시지 출력 후 `process.exit(1)`

- [ ] **Step 1: 실패 테스트 작성**

`apps/api/src/bootstrap/bootstrap.service.spec.ts`:
```ts
import { BootstrapService } from './bootstrap.service';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

function mockPrisma(userCount: number) {
  return {
    user: {
      count: jest.fn().mockResolvedValue(userCount),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    sqlReviewRule: { upsert: jest.fn().mockResolvedValue({}) },
    approvalPolicy: { upsert: jest.fn().mockResolvedValue({}) },
  };
}

describe('BootstrapService', () => {
  const ENV_KEYS = ['DBFLOW_ADMIN_EMAIL', 'DBFLOW_ADMIN_PASSWORD', 'DBFLOW_DEMO'];
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });
  afterEach(() => exitSpy.mockRestore());

  it('사용자 0명 + env 없음 + 데모 아님 → 부팅 거부(exit 1)', async () => {
    const prisma = mockPrisma(0);
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('admin env 설정 시 없는 계정이면 ADMIN 생성, 이후 사용자 존재로 통과', async () => {
    process.env.DBFLOW_ADMIN_EMAIL = 'root@corp.io';
    process.env.DBFLOW_ADMIN_PASSWORD = 'secret-password';
    const prisma = mockPrisma(1); // 생성 후 count 시점엔 1명
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'root@corp.io', role: 'ADMIN', passwordHash: 'hashed' }),
      }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('기존 계정이 있으면 덮어쓰지 않는다', async () => {
    process.env.DBFLOW_ADMIN_EMAIL = 'root@corp.io';
    process.env.DBFLOW_ADMIN_PASSWORD = 'secret-password';
    const prisma = mockPrisma(1);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('DBFLOW_DEMO=true → 데모 계정 4개 + 규칙 21개 + 정책 3개 upsert', async () => {
    process.env.DBFLOW_DEMO = 'true';
    const prisma = mockPrisma(4);
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(prisma.user.upsert).toHaveBeenCalledTimes(4);
    expect(prisma.sqlReviewRule.upsert).toHaveBeenCalledTimes(21);
    expect(prisma.approvalPolicy.upsert).toHaveBeenCalledTimes(3);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @dbflow/api test -- bootstrap`
Expected: FAIL — `Cannot find module './bootstrap.service'`

- [ ] **Step 3: 구현**

`apps/api/src/bootstrap/bootstrap.service.ts` (시드 데이터는 기존 `prisma/seed.ts`에서 그대로 이식):
```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

const DEMO_USERS = [
  { email: 'dev@dbflow.io', name: '개발자', department: '개발팀', role: 'DEVELOPER' as const },
  { email: 'dba@dbflow.io', name: '검토자', department: 'DBA팀', role: 'REVIEWER' as const },
  { email: 'approver@dbflow.io', name: '결재자', department: '인프라팀', role: 'APPROVER' as const },
  { email: 'admin@dbflow.io', name: '관리자', department: '운영팀', role: 'ADMIN' as const },
];

const DEMO_RULE_LEVELS = {
  DEV:     { DROP_DATABASE: 'WARN', DROP_TABLE: 'WARN', TRUNCATE: 'WARN', DELETE_WITHOUT_WHERE: 'WARN', UPDATE_WITHOUT_WHERE: 'WARN', ALTER_DROP_COLUMN: 'WARN', DROP_INDEX: 'INFO' },
  STAGING: { DROP_DATABASE: 'BLOCK', DROP_TABLE: 'BLOCK', TRUNCATE: 'BLOCK', DELETE_WITHOUT_WHERE: 'BLOCK', UPDATE_WITHOUT_WHERE: 'BLOCK', ALTER_DROP_COLUMN: 'WARN', DROP_INDEX: 'INFO' },
  PROD:    { DROP_DATABASE: 'BLOCK', DROP_TABLE: 'BLOCK', TRUNCATE: 'BLOCK', DELETE_WITHOUT_WHERE: 'BLOCK', UPDATE_WITHOUT_WHERE: 'BLOCK', ALTER_DROP_COLUMN: 'WARN', DROP_INDEX: 'INFO' },
} as const;

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.createAdminFromEnv();
    if (process.env.DBFLOW_DEMO === 'true') await this.seedDemo();
    await this.assertAnyUserExists();
  }

  /** DBFLOW_ADMIN_EMAIL/PASSWORD가 있고 해당 계정이 없으면 ADMIN 1회 생성. 기존 계정은 건드리지 않는다. */
  private async createAdminFromEnv() {
    const email = process.env.DBFLOW_ADMIN_EMAIL;
    const password = process.env.DBFLOW_ADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;

    await this.prisma.user.create({
      data: {
        email,
        name: 'Administrator',
        department: 'admin',
        role: 'ADMIN',
        passwordHash: await argon2.hash(password),
      },
    });
    this.logger.log(`관리자 계정 생성됨: ${email}`);
  }

  /** 데모 계정·SQL 검토 규칙·결재 정책 upsert (멱등 — 반복 기동 무해) */
  private async seedDemo() {
    for (const u of DEMO_USERS) {
      await this.prisma.user.upsert({
        where: { email: u.email },
        update: { department: u.department, role: u.role },
        create: { ...u, passwordHash: await argon2.hash('password1234') },
      });
    }
    for (const [env, rules] of Object.entries(DEMO_RULE_LEVELS)) {
      for (const [ruleKey, level] of Object.entries(rules)) {
        await this.prisma.sqlReviewRule.upsert({
          where: { env_ruleKey: { env: env as never, ruleKey } },
          update: { level: level as never },
          create: { env: env as never, ruleKey, level: level as never },
        });
      }
    }
    for (const env of ['DEV', 'STAGING', 'PROD'] as const) {
      await this.prisma.approvalPolicy.upsert({ where: { env }, update: {}, create: { env, requiredApprovals: 1 } });
    }
    this.logger.log('데모 시드 완료 (DBFLOW_DEMO=true)');
  }

  /** 로그인 가능한 사용자가 하나도 없으면 부팅을 중단시킨다 (로그인 불가 상태로 뜨는 것 방지) */
  private async assertAnyUserExists() {
    const count = await this.prisma.user.count();
    if (count > 0) return;
    this.logger.error(
      '사용자가 없어 로그인할 수 없습니다. DBFLOW_ADMIN_EMAIL/DBFLOW_ADMIN_PASSWORD를 설정하거나 DBFLOW_DEMO=true로 기동하세요.',
    );
    process.exit(1);
  }
}
```

`apps/api/src/bootstrap/bootstrap.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({ providers: [BootstrapService, PrismaService] })
export class BootstrapModule {}
```

`apps/api/src/app.module.ts`: imports 배열 끝에 `BootstrapModule` 추가 + `import { BootstrapModule } from './bootstrap/bootstrap.module';`

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @dbflow/api test -- bootstrap`
Expected: PASS (4 tests)

- [ ] **Step 5: seed.ts 제거**

```bash
git rm apps/api/prisma/seed.ts
```
`apps/api/package.json`에서 `"prisma": { "seed": "ts-node prisma/seed.ts" }` 블록 삭제.

- [ ] **Step 6: 전체 테스트 + Commit**

Run: `pnpm --filter @dbflow/api test`
Expected: 전체 PASS

```bash
git add apps/api/src/bootstrap apps/api/src/app.module.ts apps/api/package.json
git commit -m "feat(api): BootstrapService replaces prisma seed (env admin bootstrap + opt-in demo)"
```

---

### Task 3: /health DB ping + CORS env

**Files:**
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/app.module.ts` (providers에 PrismaService)
- Modify: `apps/api/src/main.ts:23` (enableCors)

**Interfaces:**
- Produces: `GET /health` → 200 `{ status: 'ok' }` (DB 접속 실패 시 500). Task 8의 compose healthcheck이 사용. `DBFLOW_CORS_ORIGINS`(콤마 구분) env — 미설정 시 현행 `origin: true`.

- [ ] **Step 1: health controller에 DB ping 추가**

`apps/api/src/health/health.controller.ts` 전체:
```ts
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`; // DB까지 살아있어야 healthy
    return { status: 'ok' };
  }
}
```

`apps/api/src/app.module.ts`: `providers: [PrismaService]` 추가 + import 문 추가 (HealthController가 AppModule 소속이므로).

- [ ] **Step 2: CORS env 파싱**

`apps/api/src/main.ts`의 `app.enableCors(...)` 교체:
```ts
  const corsOrigins = process.env.DBFLOW_CORS_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : true,
    credentials: true,
  });
```

- [ ] **Step 3: 동작 확인 + Commit**

Run: `./start.sh --no-install` 후 `curl -s http://localhost:3001/health`
Expected: `{"status":"ok"}`

Run: `pnpm --filter @dbflow/api test`
Expected: 전체 PASS

```bash
git add apps/api/src/health apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(api): /health DB ping + DBFLOW_CORS_ORIGINS"
```

---

### Task 4: web Route Handler 프록시 + API_BASE 전환 + standalone

**Files:**
- Create: `apps/web/app/api/[...path]/route.ts`
- Modify: `apps/web/lib/api.ts:3`
- Modify: `apps/web/next.config.js`

**Interfaces:**
- Consumes: api 서버(개발 `http://localhost:3001`, compose `http://api:3001` — env `DBFLOW_API_URL`)
- Produces: web same-origin `/api/*` → api 전달. `lib/api.ts`의 모든 호출(login·apiFetch·downloadAuditExport)이 `/api` 경유. Task 7·8이 `output: 'standalone'` 빌드 산출물에 의존.

- [ ] **Step 1: 프록시 route 작성**

`apps/web/app/api/[...path]/route.ts`:
```ts
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * same-origin API 프록시: /api/* → ${DBFLOW_API_URL}/*
 * 요청 시점에 env를 읽으므로 사전 빌드된 이미지에서도 런타임 설정 가능
 * (rewrites는 빌드 시 routes-manifest에 구워져 불가 — 스펙 §2).
 */
const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'accept-language'];
// undici가 자동 압축 해제하므로 인코딩/길이 헤더는 그대로 넘기면 불일치 발생
const DROP_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const apiUrl = process.env.DBFLOW_API_URL ?? 'http://localhost:3001';
  const search = new URL(req.url).search;
  const target = `${apiUrl}/${params.path.join('/')}${search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    // @ts-expect-error -- undici는 스트리밍 body에 duplex 지정을 요구
    duplex: 'half',
    cache: 'no-store',
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROP_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
```

- [ ] **Step 2: API_BASE 기본값 변경**

`apps/web/lib/api.ts:3`:
```ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';
```

- [ ] **Step 3: next.config.js standalone**

`apps/web/next.config.js` 전체:
```js
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // 모노레포: 트레이싱 루트를 리포 루트로 고정해야 standalone이 workspace 의존성을 포함한다
  experimental: { outputFileTracingRoot: path.join(__dirname, '../../') },
};

module.exports = nextConfig;
```

- [ ] **Step 4: 개발 모드 경유 확인**

Run: `./start.sh --no-install` 후
```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dev@dbflow.io","password":"password1234"}'
```
Expected: `{"accessToken":...}` (프록시 경유 로그인 성공)

브라우저에서 `http://localhost:3000` 로그인 → 대시보드 로드, 감사 로그 페이지에서 CSV 내보내기 다운로드 정상.

- [ ] **Step 5: standalone 빌드 확인 + Commit**

Run: `pnpm --filter @dbflow/web build`
Expected: 성공, `apps/web/.next/standalone/` 생성됨

```bash
git add apps/web/app/api apps/web/lib/api.ts apps/web/next.config.js
git commit -m "feat(web): same-origin /api route-handler proxy + standalone output"
```

---

### Task 5: start.sh 시크릿 생성·데모 기본화 + .env.example 확장

**Files:**
- Modify: `start.sh:28-32` (.env 생성부), `start.sh:66-70` (시드부), `start.sh:75-76` (api 기동부)
- Modify: `.env.example`

**Interfaces:**
- Consumes: Task 1 fail-fast 규칙, Task 2 `DBFLOW_DEMO` 규약
- Produces: 루트 `.env.example` — start.sh(개발)와 Task 8 compose(프로덕션)가 공유하는 단일 예시 파일

- [ ] **Step 1: .env.example 확장**

`.env.example` 전체:
```bash
# ── api ──────────────────────────────────────────────────────────
DATABASE_URL="mysql://dbflow:dbflow@localhost:3306/dbflow"
# 필수. 기본값이면 부팅 거부. 생성: openssl rand -hex 32
JWT_SECRET="change-me-in-prod"
PORT=3001
# 필수. AES-256-GCM 키(64 hex). 전부 0이면 부팅 거부. 생성: openssl rand -hex 32
APP_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
# 적용 전 백업 시 테이블당 데이터 스냅샷 최대 행수 (초과 시 스키마만 백업)
BACKUP_MAX_ROWS=100000

# ── 최초 관리자 부트스트랩 (사용자 0명일 때 필수 — docs/open-source-strategy.md §4-C) ──
DBFLOW_ADMIN_EMAIL=""
DBFLOW_ADMIN_PASSWORD=""
# true면 데모 4계정(password1234)·SQL 검토 규칙·결재 정책을 시드 (평가용)
DBFLOW_DEMO=false

# ── docker compose (셀프호스팅) ──────────────────────────────────
MYSQL_PASSWORD="change-me-mysql"
MYSQL_ROOT_PASSWORD="change-me-mysql-root"
# api를 직접 노출하는 배포에서만 필요 (콤마 구분). 기본: 모든 오리진 허용
# DBFLOW_CORS_ORIGINS="https://dbflow.example.com"
```

- [ ] **Step 2: start.sh 수정**

`start.sh`의 `# 0) .env 준비` 블록 교체:
```bash
# 0) .env 준비 (최초 생성 시 실제 시크릿 자동 생성 — fail-fast 통과)
if [ ! -f "$ROOT/apps/api/.env" ]; then
  log ".env 생성 (.env.example 복사 + 시크릿 생성)"
  cp "$ROOT/.env.example" "$ROOT/apps/api/.env"
  JWT_GEN="$(openssl rand -hex 32)"
  KEY_GEN="$(openssl rand -hex 32)"
  sed -i.bak \
    -e "s/^JWT_SECRET=.*/JWT_SECRET=\"$JWT_GEN\"/" \
    -e "s/^APP_ENCRYPTION_KEY=.*/APP_ENCRYPTION_KEY=\"$KEY_GEN\"/" \
    "$ROOT/apps/api/.env"
  rm -f "$ROOT/apps/api/.env.bak"
fi

# 0-1) 구버전 .env(기본 시크릿) 감지 — fail-fast에 걸리므로 안내 후 중단
if grep -q 'change-me-in-prod' "$ROOT/apps/api/.env" \
   || grep -Eq '^APP_ENCRYPTION_KEY="?0{64}"?' "$ROOT/apps/api/.env"; then
  echo "apps/api/.env에 기본 시크릿이 남아 있습니다. 파일을 지우고 ./start.sh를 다시 실행하면 재생성됩니다:" >&2
  echo "  rm apps/api/.env && ./start.sh" >&2
  exit 1
fi
```

`# 5) (옵션) 시드` 블록 삭제하고 주석으로 대체:
```bash
# 5) 시드는 api 부팅 시 BootstrapService가 수행 (개발은 항상 DBFLOW_DEMO=true)
```

api 기동 라인 교체 (`--seed` 파싱은 no-op 호환으로 유지):
```bash
TZ="${TZ:-Asia/Seoul}" DBFLOW_DEMO=true nohup pnpm --filter @dbflow/api start:dev >"$RUN_DIR/api.log" 2>&1 &
```

- [ ] **Step 3: 빈 DB 회귀 확인**

```bash
./stop.sh --all
docker volume rm project-dbflow_mysqldata
rm apps/api/.env
./start.sh
```
Expected: 기동 완료 후 `curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"dev@dbflow.io","password":"password1234"}'` → accessToken 반환 (빈 DB에서 plain start.sh로 데모 로그인 — 크래시 루프 없음)

- [ ] **Step 4: Commit**

```bash
git add start.sh .env.example
git commit -m "feat(dev): start.sh generates real secrets, always-demo dev boot; expand .env.example"
```

---

### Task 6: .dockerignore + api Dockerfile

**Files:**
- Create: `.dockerignore`
- Create: `apps/api/Dockerfile`

**Interfaces:**
- Consumes: Task 1~3의 api 코드 (빌드 대상)
- Produces: `docker build -f apps/api/Dockerfile .`로 빌드되는 api 이미지. entrypoint: `prisma migrate deploy && node dist/main.js`. Task 8 compose가 사용.

- [ ] **Step 1: .dockerignore 작성**

`.dockerignore` (루트):
```
node_modules
**/node_modules
**/dist
**/.next
.git
.run
.omc
.worktrees
docs
*.md
# 시크릿 — 이미지 레이어에 절대 포함 금지
.env
**/.env
```

- [ ] **Step 2: prisma CLI를 dependencies로 승격**

`apps/api/package.json`: devDependencies의 `"prisma": "^5.10.0"`을 dependencies로 이동 후:
```bash
pnpm install
```

- [ ] **Step 3: api Dockerfile 작성**

`apps/api/Dockerfile`:
```dockerfile
# ── build: workspace 설치 → prisma generate → nest build ─────────
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @dbflow/api
COPY apps/api apps/api
RUN cd apps/api && pnpm exec prisma generate && pnpm run build
# 프로덕션 의존성만 남긴 배포본 (+ 배포본 위에서 generate 재실행: .prisma 클라이언트 보장)
RUN pnpm --filter @dbflow/api deploy --prod /out \
 && cd /out && ./node_modules/.bin/prisma generate

# ── runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim
# openssl/ca-certificates: Prisma 엔진(libssl)·TLS, tzdata: TZ=Asia/Seoul 적용
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out /app
EXPOSE 3001
# 마이그레이션 후 기동 (MySQL 준비는 compose depends_on(service_healthy)이 보장)
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
```

- [ ] **Step 4: 단독 빌드 확인**

Run: `docker build -f apps/api/Dockerfile -t dbflow-api:dev .`
Expected: 빌드 성공. 이어서 fail-fast 스모크:
```bash
docker run --rm -e DATABASE_URL=mysql://x -e JWT_SECRET=change-me-in-prod \
  -e APP_ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) dbflow-api:dev \
  sh -c "node dist/main.js"; echo "exit=$?"
```
Expected: `[dbflow] 부팅 중단` 메시지 + `exit=1`

- [ ] **Step 5: Commit**

```bash
git add .dockerignore apps/api/Dockerfile apps/api/package.json pnpm-lock.yaml
git commit -m "feat(docker): api production multi-stage Dockerfile + .dockerignore"
```

---

### Task 7: web Dockerfile

**Files:**
- Create: `apps/web/Dockerfile`

**Interfaces:**
- Consumes: Task 4의 standalone 설정 (`.next/standalone/apps/web/server.js` 경로 — 모노레포 트레이싱)
- Produces: `docker build -f apps/web/Dockerfile .` web 이미지, 런타임 env `DBFLOW_API_URL`. Task 8 compose가 사용.

- [ ] **Step 1: Dockerfile 작성**

`apps/web/Dockerfile` (빌드 인자 불필요 — 스펙 §2, `ARG` 추가 금지):
```dockerfile
# ── build ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @dbflow/web
COPY apps/web apps/web
RUN cd apps/web && pnpm run build

# ── runtime: standalone 산출물만 ─────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# 모노레포 standalone: server.js는 apps/web/ 하위에 생성된다
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```
(참고: `apps/web/public` 디렉토리는 현재 존재하지 않으므로 COPY 없음 — 생기면 추가)

- [ ] **Step 2: 단독 빌드·기동 확인**

```bash
docker build -f apps/web/Dockerfile -t dbflow-web:dev .
docker run --rm -p 3300:3000 dbflow-web:dev &
sleep 3 && curl -s -o /dev/null -w '%{http_code}' http://localhost:3300/login; docker stop $(docker ps -q --filter ancestor=dbflow-web:dev)
```
Expected: `200`

- [ ] **Step 3: Commit**

```bash
git add apps/web/Dockerfile
git commit -m "feat(docker): web standalone Dockerfile"
```

---

### Task 8: 루트 docker-compose.yml

**Files:**
- Create: `docker-compose.yml` (리포 루트)

**Interfaces:**
- Consumes: Task 6·7 Dockerfile, Task 5 `.env.example` 변수, Task 3 `/health`
- Produces: `docker compose up`으로 mysql→api(migrate 후)→web 순 기동되는 전체 스택. dev 스택(`project-dbflow` 프로젝트, `mysqldata` 볼륨, 3306 공개)과 완전 분리.

- [ ] **Step 1: compose 작성**

`docker-compose.yml`:
```yaml
# DBFlow 셀프호스팅 스택 — 사용법: cp .env.example .env && (시크릿 수정) && docker compose up -d
# 개발 스택(docker/docker-compose.yml, ./start.sh)과 프로젝트명·볼륨·포트가 분리되어 공존 가능.
name: dbflow

services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: dbflow
      MYSQL_USER: dbflow
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?".env에 MYSQL_PASSWORD를 설정하세요"}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?".env에 MYSQL_ROOT_PASSWORD를 설정하세요"}
    volumes:
      - dbflow_mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -u root -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 5s
      timeout: 5s
      retries: 30

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    env_file: .env
    environment:
      DATABASE_URL: mysql://dbflow:${MYSQL_PASSWORD}@mysql:3306/dbflow
      TZ: Asia/Seoul
    depends_on:
      mysql:
        condition: service_healthy
    restart: on-failure
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      DBFLOW_API_URL: http://api:3001
    ports:
      - "3000:3000"
    depends_on:
      api:
        condition: service_healthy
    restart: on-failure

volumes:
  dbflow_mysql_data:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): full-stack root compose (mysql+api+web, api internal-only)"
```

---

### Task 9: E2E 검증 (스펙 검증 계획 전체)

**Files:** 없음 (검증 전용 — 실패 시 해당 Task로 돌아가 수정)

- [ ] **Step 1: 클린 기동 → 관리자 로그인** (종료 기준 1)

```bash
docker compose down -v 2>/dev/null
cp .env.example .env
python3 - <<'EOF'
import re, secrets
p = open('.env').read()
p = re.sub(r'JWT_SECRET=.*', f'JWT_SECRET="{secrets.token_hex(32)}"', p)
p = re.sub(r'APP_ENCRYPTION_KEY=.*', f'APP_ENCRYPTION_KEY="{secrets.token_hex(32)}"', p)
p = p.replace('DBFLOW_ADMIN_EMAIL=""', 'DBFLOW_ADMIN_EMAIL="root@example.com"')
p = p.replace('DBFLOW_ADMIN_PASSWORD=""', 'DBFLOW_ADMIN_PASSWORD="m1-verify-password"')
p = p.replace('change-me-mysql-root', secrets.token_hex(16)).replace('change-me-mysql', secrets.token_hex(16))
open('.env','w').write(p)
EOF
docker compose up -d --build
docker compose logs -f api | head -30   # migrate deploy 성공 + 관리자 계정 생성 로그 확인
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"root@example.com","password":"m1-verify-password"}'
```
Expected: `{"accessToken":...}` + 브라우저 `http://localhost:3000` 로그인 화면 로드·로그인 성공

- [ ] **Step 2: fail-fast 3케이스** (종료 기준 2)

`.env`의 `JWT_SECRET`을 `change-me-in-prod`로 → `docker compose up -d api` → `docker compose logs api`에 `부팅 중단` + 재시작 루프 확인. 원복.
`.env`의 `APP_ENCRYPTION_KEY`를 0×64로 → 동일 확인. 원복.
`docker compose down -v` 후 `.env`에서 `DBFLOW_ADMIN_EMAIL/PASSWORD` 비움(데모 false) → up → `사용자가 없어 로그인할 수 없습니다` 로그 확인. 원복.

- [ ] **Step 3: 데모 모드** (종료 기준 3)

`docker compose down -v` → `.env`에 `DBFLOW_DEMO=true` → up → `dev@dbflow.io/password1234` 로그인 성공 확인. 원복.

- [ ] **Step 4: 멱등 재기동**

`docker compose restart api` → 로그에 에러 없음, 기존 로그인 유지.

- [ ] **Step 5: 개발 회귀** (종료 기준 4·5)

Task 5 Step 3의 빈 DB `./start.sh` 확인 재실행 + dev 스택과 compose 스택 동시 기동 시 충돌 없음(호스트 3000 제외) 확인 + `pnpm --filter @dbflow/api test` 전체 PASS.

- [ ] **Step 6: 프록시 다운로드** (스펙 검증 6)

compose 웹(`:3000`)에서 admin 로그인 → 감사 로그 → CSV 내보내기 → 파일 다운로드 정상.

- [ ] **Step 7: 마무리 Commit + PR**

검증 중 수정사항 커밋 후:
```bash
git push -u origin feat/m1-packaging
gh pr create --title "feat: M1 self-hosting packaging + admin bootstrap" --body "..."
```
PR 본문에 스펙 링크 + 검증 결과 요약. 리뷰는 기존 사이클(코드 리뷰 → 머지)로.
