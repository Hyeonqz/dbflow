# ── build: workspace 설치 → prisma generate → nest build ─────────
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
RUN pnpm install --frozen-lockfile --filter @dbflow/api
COPY apps/api apps/api
RUN cd apps/api && pnpm exec prisma generate && pnpm run build
# 프로덕션 의존성만 남긴 배포본 (+ 배포본 위에서 generate 재실행: .prisma 클라이언트 보장)
RUN pnpm --filter @dbflow/api deploy --prod /out \
 && cd /out && ./node_modules/.bin/prisma generate

# ── runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# openssl/ca-certificates: Prisma 엔진(libssl)·TLS, tzdata: TZ=Asia/Seoul 적용
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out /app
EXPOSE 3001
USER node
# 마이그레이션 후 기동 (MySQL 준비는 compose depends_on(service_healthy)이 보장)
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]
