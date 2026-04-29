#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
CONFIRMATION="${1:-}"

log() {
  printf '[deploy-prod] %s\n' "$*"
}

if [[ "$CONFIRMATION" != "DEPLOY_PROD" ]]; then
  log "Production deploy requires explicit confirmation."
  log "Usage: bash scripts/deploy-prod.sh DEPLOY_PROD"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  log "Missing env file: $ENV_FILE"
  log "Copy .env.prod.example to .env on the production server and fill real values first."
  exit 1
fi

cd "$ROOT"

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
log "Deploying production commit: $CURRENT_COMMIT"

log "Creating database backup before deploy"
"$ROOT/scripts/backup-db.sh" prod

log "Installing dependencies"
pnpm install --frozen-lockfile

log "Building packages and apps"
pnpm build

log "Running database migrations"
pnpm db:migrate

log "Restarting PM2 services"
pm2 restart ecosystem.config.cjs --update-env

log "Running health check"
ENV=prod "$ROOT/scripts/health-check.sh"

log "Production deploy completed"
