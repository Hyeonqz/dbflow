#!/bin/bash
# 단일 이미지 entrypoint: 마이그레이션 후 api+web 두 프로세스를 기동한다.
# 둘 중 하나라도 죽으면(wait -n) 컨테이너를 종료시켜 compose restart 정책이 복구하게 한다.
set -e

cd /app/api
./node_modules/.bin/prisma migrate deploy

PORT=3001 node dist/src/main.js 2>&1 | sed -u 's/^/[api] /' &

cd /app/web
PORT=3000 node apps/web/server.js 2>&1 | sed -u 's/^/[web] /' &

wait -n
