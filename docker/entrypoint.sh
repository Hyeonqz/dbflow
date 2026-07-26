#!/bin/bash
# 단일 이미지 entrypoint: 마이그레이션 후 api+web 두 프로세스를 기동한다.
# 둘 중 하나라도 죽으면 컨테이너를 그 종료 코드로 끝내 compose restart 정책이 복구하게 한다.
set -e

cd /app/api
./node_modules/.bin/prisma migrate deploy

# 로그 prefix는 파이프(`node ... | sed &`)가 아니라 프로세스 치환으로 붙인다.
# 파이프로 묶으면 $!와 wait이 파이프라인의 마지막 명령(sed)을 가리켜, node가 죽어도
# sed가 EOF로 0을 반환 → 컨테이너가 exit 0 → on-failure 재시작이 안 걸린다.
PORT=3001 node dist/src/main.js > >(sed -u 's/^/[api] /') 2>&1 &
API_PID=$!

cd /app/web
PORT=3000 node apps/web/server.js > >(sed -u 's/^/[web] /') 2>&1 &
WEB_PID=$!

# 먼저 죽는 쪽의 실제 종료 코드로 컨테이너를 종료시킨다.
wait -n "$API_PID" "$WEB_PID"
exit $?
