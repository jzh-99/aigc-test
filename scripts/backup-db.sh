#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${1:-dev}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

log() {
  printf '[backup-db:%s] %s\n' "$ENV_NAME" "$*"
}

fail() {
  log "FAIL: $*"
  exit 1
}

if [[ ! -f "$ENV_FILE" ]]; then
  fail "Missing env file: $ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  fail "DATABASE_URL is required"
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  fail "pg_dump is required"
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$BACKUP_DIR/${ENV_NAME}-${TIMESTAMP}.dump"

log "Writing backup to $OUTPUT"
pg_dump "$DATABASE_URL" --format=custom --file="$OUTPUT"

log "Backup completed"
