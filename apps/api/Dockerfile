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
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]
