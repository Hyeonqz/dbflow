#!/usr/bin/env bash
# DBFlow 로컬 개발 환경 기동 스크립트
# - MySQL(docker) 기동 → Prisma 마이그레이션/시드 → API/Web 백그라운드 실행
# 사용법:
#   ./start.sh            전체 기동 (이미 떠 있으면 건너뜀)
#   ./start.sh --seed     기동 + 시드 유저 재생성
#   ./start.sh --no-install   pnpm install 생략
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
RUN_DIR="$ROOT/.run"
COMPOSE="docker compose -f docker/docker-compose.yml"
mkdir -p "$RUN_DIR"

DO_SEED=false
DO_INSTALL=true
for arg in "$@"; do
  case "$arg" in
    --seed) DO_SEED=true ;;
    --no-install) DO_INSTALL=false ;;
    *) echo "알 수 없는 옵션: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\033[36m[dbflow]\033[0m %s\n' "$1"; }

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

# 1) MySQL 기동 (이미 떠 있으면 skip, 없으면 up)
if $COMPOSE ps --status running --services 2>/dev/null | grep -qx mysql; then
  log "MySQL(docker) 이미 실행 중 → skip"
else
  log "MySQL(docker) 기동..."
  $COMPOSE up -d mysql
fi

# 2) mysql 준비 대기
log "MySQL 연결 대기..."
for i in $(seq 1 30); do
  if $COMPOSE exec -T mysql mysqladmin ping -h localhost -u root -proot --silent >/dev/null 2>&1; then
    log "MySQL 준비 완료"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "MySQL가 30초 내에 준비되지 않았습니다." >&2
    exit 1
  fi
  sleep 1
done

# 3) 의존성 설치
if [ "$DO_INSTALL" = true ]; then
  log "의존성 설치(pnpm install)..."
  pnpm install
fi

# 4) 마이그레이션 적용
log "Prisma 마이그레이션 적용..."
pnpm --filter @dbflow/api exec prisma migrate deploy

# 5) 시드는 api 부팅 시 BootstrapService가 수행 (개발은 항상 DBFLOW_DEMO=true)

# 6) 기존 프로세스 정리 후 API/Web 백그라운드 기동
"$ROOT/stop.sh" --apps-only >/dev/null 2>&1 || true

log "API 서버 기동 (:3001)..."
TZ="${TZ:-Asia/Seoul}" DBFLOW_DEMO=true nohup pnpm --filter @dbflow/api start:dev >"$RUN_DIR/api.log" 2>&1 &
echo $! > "$RUN_DIR/api.pid"

log "Web 서버 기동 (:3000)..."
nohup pnpm --filter @dbflow/web dev >"$RUN_DIR/web.log" 2>&1 &
echo $! > "$RUN_DIR/web.pid"

log "기동 완료!"
echo "  - Web:  http://localhost:3000  (로그인: dev@dbflow.io / password1234)"
echo "  - API:  http://localhost:3001"
echo "  - 로그: tail -f $RUN_DIR/api.log  /  $RUN_DIR/web.log"
echo "  - 종료: ./stop.sh   (DB까지 종료: ./stop.sh --all)"
