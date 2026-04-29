#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${1:-${ENV:-dev}}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

log() {
  printf '[health-check:%s] %s\n' "$ENV_NAME" "$*"
}

fail() {
  log "FAIL: $*"
  exit 1
}

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

API_PORT="${API_PORT:-3001}"
API_BASE_URL="${API_BASE_URL:-http://localhost:$API_PORT}"

log "Checking API health: $API_BASE_URL/healthz"
if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 10 "$API_BASE_URL/healthz" >/tmp/aigc-healthz.json || fail "API health check failed"
  log "API: ok"
else
  fail "curl is required"
fi

if command -v pm2 >/dev/null 2>&1; then
  log "Checking PM2 process status"
  pm2 describe aigc-test-api >/dev/null || fail "PM2 process aigc-test-api not found"
  pm2 describe aigc-test-worker >/dev/null || fail "PM2 process aigc-test-worker not found"
  pm2 describe aigc-test-web >/dev/null || fail "PM2 process aigc-test-web not found"
  log "PM2: ok"
else
  log "PM2 not found, skipping PM2 process checks"
fi

DISK_USAGE="$(df -P "$ROOT" | tail -1 | awk '{print $5}' | tr -d '%')"
if [[ "$DISK_USAGE" -ge 90 ]]; then
  fail "Disk usage is ${DISK_USAGE}%"
fi
log "Disk: ok (${DISK_USAGE}%)"

log "Health check completed"
