# DBFlow MVP — Plan 1: Foundation + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the DBFlow monorepo (NestJS API + Next.js web + PostgreSQL metadata DB) and deliver working role-based authentication, so a user can log in and see a role-appropriate landing screen.

**Architecture:** pnpm workspace monorepo. `apps/api` is a NestJS backend using Prisma against PostgreSQL for metadata. `apps/web` is a Next.js (App Router) frontend with Tailwind, Toss-style UI. Auth is JWT-based with three roles (DEVELOPER, REVIEWER, APPROVER) enforced by a NestJS guard.

**Tech Stack:** Node 20+, pnpm, NestJS 10, Prisma 5, PostgreSQL 16, Next.js 14 (App Router), Tailwind CSS 3, argon2 (password hashing), @nestjs/jwt, Jest (API tests), Docker Compose.

## Global Constraints

- Node.js 20+ and pnpm 9+ (workspace `packageManager` field pinned).
- Target DBs (MySQL dev/prod) are NOT touched in this plan — only the PostgreSQL metadata DB.
- Passwords stored as argon2 hashes; never returned in any API response.
- Roles are exactly `DEVELOPER`, `REVIEWER`, `APPROVER` (uppercase) — used verbatim in DB, DTOs, and guards.
- All API tests run with `pnpm --filter @dbflow/api test`.
- UI follows Toss-style direction from the spec: generous whitespace, large type, one primary action per screen.

---

## File Structure

```
project-dbflow/
├── package.json                      # workspace root, scripts
├── pnpm-workspace.yaml
├── docker-compose.yml                # postgres (+ mysql dev/prod for later plans)
├── .env.example
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   ├── jest.config.js
│   │   ├── prisma/
│   │   │   └── schema.prisma          # User model
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── health/health.controller.ts
│   │       ├── prisma/prisma.service.ts
│   │       ├── auth/
│   │       │   ├── auth.module.ts
│   │       │   ├── auth.service.ts
│   │       │   ├── auth.controller.ts
│   │       │   ├── password.util.ts
│   │       │   ├── jwt.strategy.ts
│   │       │   ├── roles.decorator.ts
│   │       │   ├── roles.guard.ts
│   │       │   └── dto/login.dto.ts
│   │       └── users/
│   │           └── users.service.ts
│   └── web/
│       ├── package.json
│       ├── tailwind.config.ts
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── globals.css
│       │   ├── login/page.tsx
│       │   └── dashboard/page.tsx
│       └── lib/api.ts
```

---

## Task 1: Monorepo scaffold + NestJS health endpoint

**Files:**
- Create: `project-dbflow/package.json`, `project-dbflow/pnpm-workspace.yaml`, `project-dbflow/.env.example`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/jest.config.js`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/health/health.controller.ts`
- Test: `apps/api/src/health/health.controller.spec.ts`

**Interfaces:**
- Produces: `GET /health` → `{ status: 'ok' }`; NestJS app bootstrapped on port from `process.env.PORT ?? 3001`.

- [ ] **Step 1: Create workspace root files**

`project-dbflow/pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
```

`project-dbflow/package.json`:
```json
{
  "name": "dbflow",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "api:dev": "pnpm --filter @dbflow/api start:dev",
    "web:dev": "pnpm --filter @dbflow/web dev",
    "api:test": "pnpm --filter @dbflow/api test"
  }
}
```

`project-dbflow/.env.example`:
```
DATABASE_URL="postgresql://dbflow:dbflow@localhost:5432/dbflow?schema=public"
JWT_SECRET="change-me-in-prod"
PORT=3001
```

- [ ] **Step 2: Create the NestJS package and config**

`apps/api/package.json`:
```json
{
  "name": "@dbflow/api",
  "version": "0.0.1",
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/testing": "^10.3.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.11.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.4.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "strict": true,
    "skipLibCheck": true
  }
}
```

`apps/api/nest-cli.json`:
```json
{ "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

`apps/api/jest.config.js`:
```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
};
```

- [ ] **Step 3: Write the failing test**

`apps/api/src/health/health.controller.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok status', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const controller = moduleRef.get(HealthController);
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd project-dbflow && pnpm install && pnpm --filter @dbflow/api test`
Expected: FAIL — cannot find module `./health.controller`.

- [ ] **Step 5: Write minimal implementation**

`apps/api/src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

@Module({ controllers: [HealthController] })
export class AppModule {}
```

`apps/api/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors({ origin: true, credentials: true });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @dbflow/api test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
cd project-dbflow && git add . && git commit -m "feat: scaffold monorepo and NestJS health endpoint"
```

---

## Task 2: PostgreSQL via Docker + Prisma User model

**Files:**
- Create: `project-dbflow/docker-compose.yml`
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/prisma/prisma.service.ts`
- Modify: `apps/api/package.json` (add prisma deps + scripts)

**Interfaces:**
- Produces: `PrismaService` (extends `PrismaClient`, connects on module init); `User` table with `id, email, name, passwordHash, role, createdAt`.

- [ ] **Step 1: Create docker-compose with PostgreSQL**

`project-dbflow/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: dbflow
      POSTGRES_PASSWORD: dbflow
      POSTGRES_DB: dbflow
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 2: Add Prisma deps and scripts to api package.json**

Add to `dependencies`: `"@prisma/client": "^5.10.0"`. Add to `devDependencies`: `"prisma": "^5.10.0"`. Add to `scripts`:
```json
"prisma:generate": "prisma generate",
"prisma:migrate": "prisma migrate dev"
```

- [ ] **Step 3: Define the Prisma schema**

`apps/api/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  DEVELOPER
  REVIEWER
  APPROVER
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         Role
  createdAt    DateTime @default(now())
}
```

- [ ] **Step 4: Run the migration (creates DB tables)**

Run:
```bash
cd project-dbflow && cp .env.example apps/api/.env && docker compose up -d postgres && pnpm --filter @dbflow/api prisma:migrate --name init
```
Expected: migration `init` applied; `User` table created; Prisma client generated.

- [ ] **Step 5: Create PrismaService**

`apps/api/src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat: add PostgreSQL compose, Prisma schema with User model"
```

---

## Task 3: Password hashing utility (TDD)

**Files:**
- Create: `apps/api/src/auth/password.util.ts`
- Test: `apps/api/src/auth/password.util.spec.ts`
- Modify: `apps/api/package.json` (add `argon2`)

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>` and `verifyPassword(hash: string, plain: string): Promise<boolean>`.

- [ ] **Step 1: Add argon2 dependency**

Add to `apps/api` `dependencies`: `"argon2": "^0.31.0"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test**

`apps/api/src/auth/password.util.spec.ts`:
```ts
import { hashPassword, verifyPassword } from './password.util';

describe('password util', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('s3cret!');
    expect(hash).not.toEqual('s3cret!');
    expect(await verifyPassword(hash, 's3cret!')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('s3cret!');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @dbflow/api test password.util`
Expected: FAIL — cannot find module `./password.util`.

- [ ] **Step 4: Write minimal implementation**

`apps/api/src/auth/password.util.ts`:
```ts
import * as argon2 from 'argon2';

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @dbflow/api test password.util`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat: add argon2 password hashing utility"
```

---

## Task 4: UsersService + seed an initial user per role (TDD)

**Files:**
- Create: `apps/api/src/users/users.service.ts`
- Test: `apps/api/src/users/users.service.spec.ts`
- Create: `apps/api/prisma/seed.ts`
- Modify: `apps/api/package.json` (add seed config + ts-node)

**Interfaces:**
- Consumes: `PrismaService`, `hashPassword`.
- Produces: `UsersService.findByEmail(email: string): Promise<User | null>`; `UsersService.create({email,name,password,role}): Promise<User>` (stores hash, never plain).

- [ ] **Step 1: Write the failing test (mocked Prisma)**

`apps/api/src/users/users.service.spec.ts`:
```ts
import { UsersService } from './users.service';
import { verifyPassword } from '../auth/password.util';

describe('UsersService', () => {
  it('creates a user with a hashed password', async () => {
    const store: any[] = [];
    const prisma: any = {
      user: {
        create: ({ data }: any) => { store.push(data); return Promise.resolve({ id: '1', ...data }); },
        findUnique: ({ where }: any) =>
          Promise.resolve(store.find((u) => u.email === where.email) ?? null),
      },
    };
    const service = new UsersService(prisma);
    const user = await service.create({
      email: 'dev@x.com', name: 'Dev', password: 'pw123456', role: 'DEVELOPER',
    });
    expect(user.passwordHash).not.toEqual('pw123456');
    expect(await verifyPassword(user.passwordHash, 'pw123456')).toBe(true);
    expect(await service.findByEmail('dev@x.com')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dbflow/api test users.service`
Expected: FAIL — cannot find module `./users.service`.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/users/users.service.ts`:
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

  async create(input: {
    email: string; name: string; password: string; role: Role;
  }): Promise<User> {
    const passwordHash = await hashPassword(input.password);
    return this.prisma.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dbflow/api test users.service`
Expected: PASS.

- [ ] **Step 5: Add a seed script for three demo users**

`apps/api/prisma/seed.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const users = [
    { email: 'dev@dbflow.io', name: '개발자', role: 'DEVELOPER' as const },
    { email: 'dba@dbflow.io', name: '검토자', role: 'REVIEWER' as const },
    { email: 'approver@dbflow.io', name: '결재자', role: 'APPROVER' as const },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: await argon2.hash('password1234') },
    });
  }
}
main().finally(() => prisma.$disconnect());
```

Add to `apps/api/package.json`: `"prisma": { "seed": "ts-node prisma/seed.ts" }` and devDep `"ts-node": "^10.9.0"`.

- [ ] **Step 6: Run the seed**

Run: `pnpm --filter @dbflow/api exec prisma db seed`
Expected: three users upserted.

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "feat: add UsersService and role-based seed users"
```

---

## Task 5: Login endpoint with JWT (TDD)

**Files:**
- Create: `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`, `auth.module.ts`, `dto/login.dto.ts`, `jwt.strategy.ts`
- Test: `apps/api/src/auth/auth.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import AuthModule + PrismaService provider)
- Modify: `apps/api/package.json` (add `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `class-validator`, `class-transformer`)

**Interfaces:**
- Consumes: `UsersService.findByEmail`, `verifyPassword`.
- Produces: `POST /auth/login {email,password}` → `{ accessToken, user: {id,email,name,role} }` (no passwordHash). `AuthService.validateAndLogin(email,password)` throws `UnauthorizedException` on bad creds. JWT payload: `{ sub: userId, role }`.

- [ ] **Step 1: Add auth dependencies**

Add to `apps/api` `dependencies`: `"@nestjs/jwt": "^10.2.0"`, `"@nestjs/passport": "^10.0.0"`, `"passport": "^0.7.0"`, `"passport-jwt": "^4.0.1"`, `"class-validator": "^0.14.0"`, `"class-transformer": "^0.5.1"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test**

`apps/api/src/auth/auth.service.spec.ts`:
```ts
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { hashPassword } from './password.util';

describe('AuthService', () => {
  const makeService = (storedHash: string) => {
    const users: any = {
      findByEmail: (email: string) =>
        Promise.resolve(
          email === 'dev@x.com'
            ? { id: '1', email, name: 'Dev', role: 'DEVELOPER', passwordHash: storedHash }
            : null,
        ),
    };
    const jwt: any = { sign: (p: any) => `token:${p.sub}:${p.role}` };
    return new AuthService(users, jwt);
  };

  it('returns token and sanitized user on valid credentials', async () => {
    const service = makeService(await hashPassword('pw123456'));
    const result = await service.validateAndLogin('dev@x.com', 'pw123456');
    expect(result.accessToken).toBe('token:1:DEVELOPER');
    expect(result.user).toEqual({ id: '1', email: 'dev@x.com', name: 'Dev', role: 'DEVELOPER' });
    expect((result.user as any).passwordHash).toBeUndefined();
  });

  it('throws on wrong password', async () => {
    const service = makeService(await hashPassword('pw123456'));
    await expect(service.validateAndLogin('dev@x.com', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws on unknown user', async () => {
    const service = makeService(await hashPassword('pw123456'));
    await expect(service.validateAndLogin('nobody@x.com', 'pw123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @dbflow/api test auth.service`
Expected: FAIL — cannot find module `./auth.service`.

- [ ] **Step 4: Write minimal implementation**

`apps/api/src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}
```

`apps/api/src/auth/auth.service.ts`:
```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { verifyPassword } from './password.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async validateAndLogin(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    const accessToken = this.jwt.sign({ sub: user.id, role: user.role });
    return {
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
```

`apps/api/src/auth/jwt.strategy.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET ?? 'change-me-in-prod',
    });
  }
  async validate(payload: { sub: string; role: string }) {
    return { userId: payload.sub, role: payload.role };
  }
}
```

`apps/api/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.validateAndLogin(dto.email, dto.password);
  }
}
```

`apps/api/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'change-me-in-prod',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UsersService, PrismaService, JwtStrategy],
})
export class AuthModule {}
```

Update `apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';

@Module({ imports: [AuthModule], controllers: [HealthController] })
export class AppModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @dbflow/api test auth.service`
Expected: PASS (3 tests).

- [ ] **Step 6: Manual smoke test**

Run (with postgres up + seeded): `pnpm --filter @dbflow/api start:dev`, then:
```bash
curl -s -X POST localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dev@dbflow.io","password":"password1234"}'
```
Expected: JSON with `accessToken` and `user.role == "DEVELOPER"`, no `passwordHash`.

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "feat: add JWT login endpoint with sanitized user response"
```

---

## Task 6: Roles guard for RBAC (TDD)

**Files:**
- Create: `apps/api/src/auth/roles.decorator.ts`, `apps/api/src/auth/roles.guard.ts`
- Test: `apps/api/src/auth/roles.guard.spec.ts`

**Interfaces:**
- Produces: `@Roles(...roles: Role[])` decorator (sets metadata key `roles`); `RolesGuard` implements `CanActivate`, reads `request.user.role` (set by JwtStrategy), returns true if no roles required or user role is included, else false.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/roles.guard.spec.ts`:
```ts
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

const ctx = (role: string) => ({
  switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  getHandler: () => ({}),
  getClass: () => ({}),
}) as any;

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctx('DEVELOPER'))).toBe(true);
  });

  it('allows when user role is permitted', () => {
    const reflector = { getAllAndOverride: () => ['REVIEWER'] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctx('REVIEWER'))).toBe(true);
  });

  it('denies when user role is not permitted', () => {
    const reflector = { getAllAndOverride: () => ['APPROVER'] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctx('DEVELOPER'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dbflow/api test roles.guard`
Expected: FAIL — cannot find module `./roles.guard`.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/auth/roles.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

`apps/api/src/auth/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    return !!user && required.includes(user.role);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dbflow/api test roles.guard`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "feat: add Roles decorator and RolesGuard for RBAC"
```

---

## Task 7: Next.js web scaffold + Tailwind (Toss-style base)

**Files:**
- Create: `apps/web/package.json`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `apps/web/tsconfig.json`, `apps/web/next.config.js`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`

**Interfaces:**
- Produces: a running Next.js app on port 3000 with Tailwind configured and a base layout using the Toss-style tokens (soft gray bg, rounded-2xl cards, blue primary `#3182f6`).

- [ ] **Step 1: Create the web package**

`apps/web/package.json`:
```json
{
  "name": "@dbflow/web",
  "version": "0.0.1",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Configure Tailwind + Toss-style tokens**

`apps/web/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#3182f6', dark: '#1b64da' },
        ink: '#191f28',
        muted: '#8b95a1',
        surface: '#f2f4f6',
      },
      borderRadius: { '2xl': '20px' },
    },
  },
  plugins: [],
};
export default config;
```

`apps/web/postcss.config.js`:
```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`apps/web/next.config.js`:
```js
/** @type {import('next').NextConfig} */
module.exports = { reactStrictMode: true };
```

`apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2021",
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 3: Create base layout and styles**

`apps/web/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { @apply bg-surface text-ink antialiased; }
```

`apps/web/app/layout.tsx`:
```tsx
import './globals.css';

export const metadata = { title: 'DBFlow', description: 'DB 변경 형상 관리' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
```

`apps/web/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-3xl font-bold">DBFlow</h1>
      <p className="mt-3 text-muted">안전한 DB 변경 형상 관리</p>
      <a href="/login" className="mt-8 inline-block rounded-2xl bg-primary px-6 py-3 font-semibold text-white">
        시작하기
      </a>
    </main>
  );
}
```

- [ ] **Step 4: Verify it runs**

Run: `pnpm install && pnpm --filter @dbflow/web dev`
Expected: app serves at `localhost:3000`; landing shows "DBFlow" with a blue "시작하기" button.

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "feat: scaffold Next.js web app with Toss-style Tailwind base"
```

---

## Task 8: Login page + role-based dashboard (web)

**Files:**
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/next.config.js` (add API rewrite to backend) OR use absolute URL via env

**Interfaces:**
- Consumes: `POST /auth/login` from Task 5.
- Produces: a login form that stores `accessToken` + `user` in `localStorage` and redirects to `/dashboard`; dashboard reads the stored user and renders role-specific quick actions.

- [ ] **Step 1: Add API base + login helper**

`apps/web/lib/api.ts`:
```ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('로그인에 실패했습니다.');
  return res.json() as Promise<{
    accessToken: string;
    user: { id: string; email: string; name: string; role: string };
  }>;
}
```

- [ ] **Step 2: Build the login page (Toss-style single-focus form)**

`apps/web/app/login/page.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { accessToken, user } = await login(email, password);
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('user', JSON.stringify(user));
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">로그인</h1>
      <p className="mt-2 text-muted">DBFlow에 오신 것을 환영합니다</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-3">
        <input className="w-full rounded-2xl bg-white px-4 py-3 outline-none ring-1 ring-gray-200 focus:ring-primary"
          type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-2xl bg-white px-4 py-3 outline-none ring-1 ring-gray-200 focus:ring-primary"
          type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button className="w-full rounded-2xl bg-primary px-4 py-3 font-semibold text-white active:bg-primary-dark"
          type="submit">로그인</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Build the role-based dashboard**

`apps/web/app/dashboard/page.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type User = { name: string; role: string };

const ROLE_LABEL: Record<string, string> = {
  DEVELOPER: '개발자', REVIEWER: '검토자(DBA)', APPROVER: '결재자',
};
const ROLE_ACTION: Record<string, string> = {
  DEVELOPER: '변경 요청 만들기', REVIEWER: '검토 대기 보기', APPROVER: '결재 대기 보기',
};

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (!raw) { router.push('/login'); return; }
    setUser(JSON.parse(raw));
  }, [router]);

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-muted">{ROLE_LABEL[user.role]}</p>
      <h1 className="mt-1 text-2xl font-bold">{user.name}님, 안녕하세요</h1>
      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-gray-100">
        <button className="w-full rounded-2xl bg-primary px-4 py-3 font-semibold text-white">
          {ROLE_ACTION[user.role]}
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Manual end-to-end verification**

With postgres up, API seeded and running, and web running:
1. Visit `localhost:3000/login`
2. Log in as `dev@dbflow.io` / `password1234`
3. Expected: redirect to `/dashboard`, header shows "개발자 / 개발자님, 안녕하세요", primary button reads "변경 요청 만들기"
4. Repeat with `dba@dbflow.io` (검토자, "검토 대기 보기") and `approver@dbflow.io` (결재자, "결재 대기 보기").

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "feat: add login page and role-based dashboard"
```

---

## Self-Review

**Spec coverage (Plan 1 portion of MVP — M0 + M1):**
- Monorepo + NestJS + Next.js scaffold → Tasks 1, 7 ✅
- PostgreSQL metadata DB + Prisma → Task 2 ✅
- docker-compose dev env → Task 2 (postgres; MySQL dev/prod added in Plan 2 where they're first used) ✅
- Auth + 3 roles + JWT → Tasks 3, 4, 5 ✅
- RBAC guard → Task 6 ✅
- Password hashing (argon2), no plain/hash leakage → Tasks 3, 4, 5 ✅
- Toss-style UI base + login + role dashboard → Tasks 7, 8 ✅
- Atlas PoC: deferred to Plan 3 (Diff) where Atlas is first used — noted, not a gap for this plan.

**Placeholder scan:** No TBD/TODO; every code step has complete code and exact commands. ✅

**Type consistency:** `Role` enum values `DEVELOPER/REVIEWER/APPROVER` consistent across schema, seed, guard, DTOs. `validateAndLogin(email,password)` and `findByEmail(email)` signatures match between AuthService, UsersService, and their tests. Login response shape `{accessToken, user:{id,email,name,role}}` consistent between Task 5 and web `lib/api.ts`. ✅

**Deferred to later plans (not gaps):** Connections/MySQL (Plan 2), Atlas diff + ChangeRequest + FileStore (Plan 3), Approval chain (Plan 4), Execution/Audit (Plan 5).
