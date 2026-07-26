# ── build: workspace 설치 → api(prisma generate + nest build) → web(next build) ──
FROM node:22-bookworm-slim AS build
# openssl: prisma generate가 빌드 시 OpenSSL 3.0을 감지해 런타임과 일치하는
# 엔진(linux-*-openssl-3.0.x)을 생성하도록. 없으면 1.1.x로 폴백해 런타임에서 불일치.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# 워크스페이스 전체 설치 — web도 next build에 devDeps(tailwind 등)가 필요
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY apps/web apps/web

RUN cd apps/api && pnpm exec prisma generate && pnpm run build
# 프로덕션 의존성만 남긴 배포본 (+ 배포본 위에서 generate 재실행: .prisma 클라이언트 보장)
RUN pnpm --filter @dbflow/api deploy --prod /out-api \
 && cd /out-api && ./node_modules/.bin/prisma generate

RUN cd apps/web && pnpm run build

# ── runtime: 두 앱의 프로덕션 산출물만 ────────────────────────────
FROM node:22-bookworm-slim
# HOSTNAME: Docker가 컨테이너 ID를 자동으로 이 env에 넣는데, Next standalone server.js가
# 이를 읽어 bind hostname으로 쓰면 컨테이너 자체 IP에만 바인딩돼 127.0.0.1 접근이 막힌다.
# PORT와 달리 api(main.ts)는 HOSTNAME을 쓰지 않으므로 전역으로 둬도 충돌하지 않는다.
ENV NODE_ENV=production HOSTNAME=0.0.0.0
# openssl/ca-certificates: Prisma 엔진(libssl)·TLS, tzdata: TZ=Asia/Seoul 적용
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out-api /app/api
# 모노레포 standalone: server.js는 apps/web/ 하위에 생성된다
COPY --from=build /repo/apps/web/.next/standalone /app/web
COPY --from=build /repo/apps/web/.next/static /app/web/apps/web/.next/static
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
USER node
# 컨테이너 전역 ENV PORT는 두지 않는다 — api/web이 같은 PORT를 읽으므로
# entrypoint가 프로세스별로 명시 지정한다 (docker/entrypoint.sh 참고).
CMD ["/app/entrypoint.sh"]
