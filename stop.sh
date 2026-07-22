#!/usr/bin/env bash
# DBFlow 로컬 개발 환경 종료 스크립트
# 사용법:
#   ./stop.sh             API/Web 종료 (MySQL은 유지)
#   ./stop.sh --all       API/Web + MySQL(docker)까지 종료
#   ./stop.sh --apps-only  (내부용) 앱 프로세스만 조용히 종료
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
RUN_DIR="$ROOT/.run"
COMPOSE="docker compose -f docker/docker-compose.yml"

STOP_DB=false
for arg in "$@"; do
  case "$arg" in
    --all) STOP_DB=true ;;
    --apps-only) ;;
    *) echo "알 수 없는 옵션: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\033[36m[dbflow]\033[0m %s\n' "$1"; }

kill_pidfile() {
  local name="$1" file="$2"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "$name 종료 (pid $pid)"
      # 자식 프로세스까지 종료
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

kill_pidfile "API" "$RUN_DIR/api.pid"
kill_pidfile "Web" "$RUN_DIR/web.pid"

# PID 파일이 없거나 유실된 경우 대비한 패턴 정리 (이 프로젝트 한정)
pkill -f "@dbflow/api start:dev" 2>/dev/null || true
pkill -f "@dbflow/web dev" 2>/dev/null || true

if [ "$STOP_DB" = true ]; then
  log "MySQL(docker) 종료..."
  $COMPOSE stop mysql
fi

log "종료 완료."
