#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_REF="${1:-HEAD@{1}}"

log() {
  printf '[rollback] %s\n' "$*"
}

cd "$ROOT"

log "Rolling back code to: $TARGET_REF"
log "This script does not run destructive database rollback. Handle irreversible migrations manually."

git checkout "$TARGET_REF"

log "Installing dependencies"
pnpm install --frozen-lockfile

log "Building packages and apps"
pnpm build

log "Restarting PM2 services"
pm2 restart ecosystem.config.cjs --update-env

log "Running health check"
"$ROOT/scripts/health-check.sh"

log "Rollback completed"
