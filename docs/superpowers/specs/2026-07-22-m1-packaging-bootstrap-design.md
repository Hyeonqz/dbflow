# M1 패키징 + 관리자 부트스트랩 설계

> 2026-07-22. 오픈소스 전환 M1 (`docs/open-source-strategy.md` §5-1~4, §7-M1).
> 결정 반영: 배포 둘 다 지원(§4-B), 관리자 env 부트스트랩 fail-fast(§4-C), 데모 시드 opt-in.

## 목표와 종료 기준

**목표**: DBFlow를 셀프호스팅 가능한 형태로 패키징한다.

**종료 기준(전부 충족해야 M1 완료)**:
1. `git clone` → 루트 `.env` 작성 → `docker compose up` → **관리자 계정으로 로그인 성공**.
2. fail-fast: 기본 `JWT_SECRET`·전부 0인 `APP_ENCRYPTION_KEY`·(사용자 0명인데) 관리자 env 미설정 — 각각 명확한 에러와 함께 부팅 거부.
3. `DBFLOW_DEMO=true`면 데모 4계정 + SQL 검토 규칙 + 결재 정책이 시드되고 데모 계정 로그인 가능.
4. 기존 개발 워크플로(`./start.sh`, `./stop.sh`) 회귀 없음.
5. 기존 jest 테스트 전체 통과.

## 스코프 제외 (다른 마일스톤)

- LICENSE·README·CONTRIBUTING·공개 전 체크리스트 → M2. (단, 루트 `package.json`의 `"license": "Apache-2.0"` 필드가 AGPL-3.0 결정과 충돌 — M2에서 정정)
- CI·Docker Hub push·멀티아치 → M4. (단 Dockerfile은 buildx 멀티아치를 막지 않게 작성)
- i18n·배포 타임존 설정화(`DBFLOW_TZ`) → M3. M1은 `TZ=Asia/Seoul` 기본값만 compose에 명시.
- TLS/리버스 프록시 가이드 → M2 문서 작업.

## 설계

### 1. api 이미지 — `apps/api/Dockerfile`

- 베이스 `node:22-bookworm-slim`(glibc — `argon2` 프리빌드 호환, alpine/musl 회피). corepack으로 pnpm 활성화.
- **build 스테이지**: 리포 루트 컨텍스트에서 workspace `pnpm install` → `prisma generate` → `nest build`.
- **runtime 스테이지**: `pnpm deploy --filter @dbflow/api --prod`로 프루닝된 `node_modules` + `dist/` + `prisma/`(schema + migrations).
- `prisma` CLI를 devDependencies → dependencies로 승격 (entrypoint의 `migrate deploy` 실행에 필요).
- entrypoint: `prisma migrate deploy && node dist/main.js`. (`depends_on: service_healthy`로 MySQL 준비 후 실행되므로 재시도 루프는 두지 않음 — compose `restart: on-failure`가 안전망)
- Prisma `binaryTargets`: build가 대상 아키텍처에서 실행되므로 `"native"` 유지. buildx 크로스 빌드 문제가 확인되면 그때 명시 추가.

### 2. web 이미지 — `apps/web/Dockerfile` + 프록시

- `next.config.js`: `output: 'standalone'` 추가.
- **API 프록시는 rewrites가 아니라 Route Handler** — rewrites는 빌드 시 `routes-manifest.json`에 구워져 런타임 env를 못 읽는다(전략 문서 v2에서 정정됨). 신설 `app/api/[...path]/route.ts`:
  - GET/POST/PATCH/PUT/DELETE를 `${DBFLOW_API_URL}/{path}?{query}`로 포워딩. `DBFLOW_API_URL` 기본 `http://localhost:3001`(개발), compose에선 `http://api:3001`.
  - Authorization·Content-Type 헤더와 body를 그대로 전달, 응답은 스트리밍(감사 export 다운로드 포함). `Accept-Language`도 전달(M3 §6-5 대비).
  - `export const dynamic = 'force-dynamic'`.
- `lib/api.ts`: `API_BASE` 기본값 `'http://localhost:3001'` → `'/api'`. `NEXT_PUBLIC_API_BASE` 오버라이드는 유지(프록시 우회 탈출구). 개발 모드(`next dev`)도 동일하게 프록시 경유 — dev/prod 경로 단일화.
- runtime 스테이지: `.next/standalone` + `.next/static` + `public` 복사, `node server.js`.

### 3. 부트스트랩 — seed.ts 대체 (api 앱 코드)

**env 검증(`main.ts` 최상단, NestFactory 이전 단일 지점)**:
- `JWT_SECRET`: 미설정 또는 `change-me-in-prod` → 부팅 거부. `auth.module.ts`·`jwt.strategy.ts`의 fallback 기본값 제거(env 필수화).
- `APP_ENCRYPTION_KEY`: 64자 hex가 아니거나 전부 0 → 부팅 거부.
- 거부 시 stderr에 원인과 해결법(생성 명령 포함) 출력 후 `process.exit(1)`.

**`BootstrapService`(신규 모듈, `onApplicationBootstrap`)**:
1. `DBFLOW_ADMIN_EMAIL`/`DBFLOW_ADMIN_PASSWORD`가 설정돼 있고 해당 이메일 계정이 없으면 ADMIN 생성(argon2 해시). 이미 있으면 아무것도 안 함(비밀번호 덮어쓰지 않음).
2. `DBFLOW_DEMO=true`면 기존 `prisma/seed.ts` 내용을 이식해 upsert: 데모 4계정(`password1234`), 환경별 `sqlReviewRule`, `approvalPolicy`.
3. 위 처리 후에도 **사용자가 0명이면 부팅 거부** — "관리자 env를 설정하거나 DBFLOW_DEMO=true로 기동하라"는 메시지.
- `prisma/seed.ts` 삭제, `package.json`의 `prisma.seed` 항목 제거.

**start.sh 변경**:
- `--seed` 플래그 → api 기동 env에 `DBFLOW_DEMO=true` 전달로 대체(플래그 이름은 호환 유지).
- 최초 `.env` 생성 시(`.env.example` 복사 직후) `JWT_SECRET`·`APP_ENCRYPTION_KEY`를 `openssl rand -hex 32`로 치환 — fail-fast와 개발 편의 양립.
- 안내 문구의 데모 계정 로그인 정보는 `--seed`(데모) 기동일 때만 출력.

### 4. compose — 루트 `docker-compose.yml` + env 단일화

```yaml
services:
  mysql:    # 기존 docker/docker-compose.yml과 동일 구성 + 볼륨/healthcheck, 단 mysql-init(전역 GRANT)은 미마운트
  api:      # build: context=., dockerfile=apps/api/Dockerfile
            # depends_on: mysql(condition: service_healthy)
            # healthcheck: GET /health (node fetch 원라이너 — slim엔 curl 없음)
            # ports 미공개(내부 전용), TZ=Asia/Seoul
  web:      # build: context=., dockerfile=apps/web/Dockerfile
            # depends_on: api(condition: service_healthy), ports: 3000:3000
            # DBFLOW_API_URL=http://api:3001
```

- **api 포트 외부 미공개** — 모든 트래픽이 web 프록시 경유. 브라우저 CORS 소멸. api 직접 노출이 필요한 배포용으로 `DBFLOW_CORS_ORIGINS` env만 추가(콤마 구분 목록, 미설정 시 현행 `origin: true` 유지).
- compose 변수는 루트 `.env`에서(compose 기본 동작). **루트 `.env.example` 하나를 확장**해 start.sh(개발)와 compose(프로덕션)가 공유: 기존 항목 + `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `DBFLOW_ADMIN_EMAIL`, `DBFLOW_ADMIN_PASSWORD`, `DBFLOW_DEMO=false`, `DBFLOW_CORS_ORIGINS`(주석).
- api의 `DATABASE_URL`은 compose에서 `mysql://dbflow:${MYSQL_PASSWORD}@mysql:3306/dbflow`로 조립.
- `docker/docker-compose.yml`(개발 DB)·`stop.sh`는 무변경.
- 루트 `.dockerignore` 신설: `node_modules`, `.next`, `dist`, `.run`, `.git`, `docs`, `*.md` 등.

### 5. `/health` 엔드포인트

- api에 `GET /health`(무인증, JwtAuthGuard 제외) — `SELECT 1` DB ping 포함, `{ status: 'ok' }` 반환. compose healthcheck과 web `depends_on` 조건이 사용.

## env 레퍼런스 (M1 이후)

| 변수 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | ✅ | MySQL 접속 문자열 (compose에선 자동 조립) |
| `JWT_SECRET` | ✅ | 기본값/미설정 시 부팅 거부. `openssl rand -hex 32` |
| `APP_ENCRYPTION_KEY` | ✅ | 64-hex, 전부 0이면 부팅 거부 |
| `DBFLOW_ADMIN_EMAIL` / `DBFLOW_ADMIN_PASSWORD` | 조건부 | 사용자 0명 && DEMO 아님 → 필수. 최초 1회 ADMIN 생성 |
| `DBFLOW_DEMO` | – | `true`면 데모 계정·규칙 시드 (기본 false) |
| `DBFLOW_API_URL` | – | web 프록시의 api 내부 주소 (기본 `http://localhost:3001`) |
| `DBFLOW_CORS_ORIGINS` | – | api 직접 노출 시 허용 오리진 목록 (기본: 모든 오리진 반사) |
| `PORT`, `BACKUP_MAX_ROWS`, `TZ` | – | 기존과 동일. `TZ` 기본 `Asia/Seoul`(M3에서 파라미터화) |
| `NEXT_PUBLIC_API_BASE` | – | web 프록시 우회용 오버라이드 (빌드 타임) |

## 검증 계획

1. **클린 기동**: 볼륨 삭제 후 `.env` 작성 → `docker compose up --build` → api 로그에 migrate 성공 → `curl POST /api/auth/login`으로 admin 로그인 200 → 웹 `:3000` 로그인 화면 로드.
2. **fail-fast 3케이스**: 기본 JWT_SECRET / 제로 암호화키 / (빈 DB에서) admin env 없음 — 각각 비정상 종료 + 원인 메시지 확인.
3. **데모 모드**: `DBFLOW_DEMO=true` 기동 → `dev@dbflow.io` 로그인 성공.
4. **멱등성**: 같은 스택 재기동(`down` 없이 `up`) 시 admin 재생성/에러 없음.
5. **개발 회귀**: `./start.sh` → 웹/API 기동, `./start.sh --seed` → 데모 로그인. jest 테스트 전체 통과.
6. **프록시 경유 다운로드**: 감사 로그 export가 프록시를 통해 정상 다운로드되는지 확인.

## 리스크와 대응

- **pnpm deploy와 prisma engines**: `pnpm deploy --prod`가 `.prisma/client` 생성물을 누락할 수 있음 → runtime 스테이지에서 `prisma generate`를 deploy 결과물 위에서 실행하거나 build 스테이지 생성물을 명시 복사. 구현 시 이미지 기동 테스트로 확정.
- **Route Handler 프록시의 body 처리**: multipart/대용량 body는 스트림 전달로 처리. 현재 api는 JSON 위주라 위험 낮음.
- **auth.module fallback 제거**: e2e/unit 테스트가 JWT_SECRET env 없이 돌던 경우 테스트 셋업에 env 주입 필요 — 테스트 통과를 종료 기준에 포함해 회귀 방지.
