# 단일 이미지 패키징 설계 (Keycloak식 배포 경험)

> 2026-07-26. M1의 2-이미지 구조를 **이미지 1개**로 전환한다. 사용자 요구: "Keycloak처럼 이미지 하나 받으면 프론트·백엔드가 함께 뜬다".

## 배경과 선택

Keycloak이 이미지 1개인 이유는 단일 Java 앱에 관리 콘솔이 **정적 리소스로 번들**되기 때문이다. DBFlow의 프론트는 정적 사이트가 아니라 **Next.js 서버**다 — 서버 컴포넌트에서 쿠키를 읽어 로케일을 정하고(i18n), `/api/*` 동일 출처 프록시 라우트가 Next 런타임에서 돈다. 그래서 Node 프로세스가 둘이다.

**선택: 한 이미지에 두 프로세스** (GitLab·Zulip·Budibase가 쓰는 올인원 패턴의 축소판).
- 배포 경험은 목표한 Keycloak과 동일: `pull` 1회, 포트 1개, `docker run` 한 줄.
- 현재 코드 그대로라 재작업이 없다.
- 대안(프론트 정적화 + Nest가 서빙, 진짜 단일 프로세스)은 서버 컴포넌트 i18n과 프록시 라우트를 클라이언트 방식으로 재작성해야 해 방금 끝낸 i18n 작업 일부를 되돌린다 — 미채택. 나중에 필요하면 이 방향으로 옮길 수 있다.

**수용한 트레이드오프**: 두 프로세스 로그가 한 스트림에 섞인다(prefix로 완화) · 이미지가 커진다(node_modules 2벌) · 프론트/백을 개별 스케일할 수 없다(셀프호스팅 단일 인스턴스에서는 무의미).

## 종료 기준

1. `docker run -p 3000:3000` 한 컨테이너로 웹과 API가 모두 뜨고, 브라우저에서 로그인까지 된다.
2. 외부에 열리는 포트는 **3000 하나**. API(3001)는 컨테이너 내부에서만 접근된다.
3. `docker compose up`(소스 빌드)과 `docker-compose.hub.yml`(이미지 pull) 모두 mysql + app **2개 서비스**로 단순화된다.
4. CI가 이미지 **1개**(`<네임스페이스>/dbflow`)를 amd64/arm64로 push한다.
5. 기존 동작 무회귀: 마이그레이션 자동 적용, env fail-fast, 관리자 부트스트랩, i18n(en/ko).

## 구조

**`Dockerfile`(루트, 신설)** — 멀티스테이지, 베이스 `node:22-bookworm-slim`
- build: 워크스페이스 전체 `pnpm install --frozen-lockfile` → api(`prisma generate` + `nest build`) → `pnpm deploy --prod /out-api` + 배포본 위 `prisma generate` → web `next build`(standalone).
  - **openssl을 build 스테이지에도 설치** — 없으면 Prisma가 openssl-1.1.x 엔진을 굽고 런타임(3.0)과 불일치해 기동 실패(M1에서 실제로 겪은 버그).
- runtime: `openssl ca-certificates tzdata` 설치, `/app/api`(api 배포본) + `/app/web`(web standalone) 배치, `USER node`, `EXPOSE 3000`.

**`docker/entrypoint.sh`(신설)** — bash. 순서:
1. `cd /app/api && ./node_modules/.bin/prisma migrate deploy`
2. api를 `PORT=3001`로 백그라운드 기동, 로그에 `[api]` prefix
3. web을 `PORT=3000`으로 백그라운드 기동, 로그에 `[web]` prefix
4. `wait -n` — **둘 중 하나라도 죽으면 컨테이너를 종료**시켜 compose의 `restart` 정책이 복구하게 한다(죽은 채 살아있는 반쪽 상태 방지).

> ⚠️ **PORT 충돌 주의**: api(`main.ts`)와 web(standalone `server.js`)이 **같은 `PORT` 환경변수를 읽는다**. 컨테이너 전역에 `PORT`를 두면 둘 다 같은 포트를 잡으려다 실패하므로, entrypoint가 프로세스별로 명시 지정한다. Dockerfile에 전역 `ENV PORT`를 두지 않는다.

**web → api 통신**: `DBFLOW_API_URL=http://127.0.0.1:3001`(같은 컨테이너 내부). 기존 프록시 라우트가 그대로 동작한다.

**compose(둘 다)**: `mysql` + `app` 2개 서비스. app만 `3000:3000` 공개, healthcheck는 컨테이너 안에서 **api `/health`와 web 양쪽**을 확인.

**CI**: matrix 제거, 이미지 `${{ vars.DOCKERHUB_USERNAME }}/dbflow` 하나, `file: Dockerfile`.

**삭제**: `apps/api/Dockerfile`, `apps/web/Dockerfile`(루트 Dockerfile로 대체 — 중복 유지 안 함).

## 검증

- `docker build -t dbflow:single .` 성공.
- mysql만 띄운 격리 스택에서 `docker run` → 로그에 마이그레이션 성공 + `[api]`/`[web]` 양쪽 기동 → `curl :3000/login` 200 → `POST :3000/api/auth/login`으로 **관리자 로그인 성공**(웹→프록시→api→DB 전 경로).
- 컨테이너 내부에서 `whoami`가 `node`(비루트) 확인.
- `docker compose config` 파싱 OK(빌드용·hub용 모두).

## 리스크

- **standalone 경로**: 모노레포 standalone은 `apps/web/server.js`에 생성된다 — 복사 위치와 실행 cwd가 어긋나면 정적 자산 404. 빌드 후 실제 경로를 확인해 맞춘다.
- **`wait -n`**: bash 4.3+ 기능. 베이스 이미지에 bash가 있으므로 `#!/bin/bash` 사용(POSIX sh에는 없음).
- **로그 prefix 파이프**: prefix용 파이프가 프로세스 종료 감지를 흐리지 않는지 확인(프로세스가 죽으면 파이프가 닫혀 감지됨).
