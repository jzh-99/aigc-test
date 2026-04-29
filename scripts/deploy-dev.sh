#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

log() {
  printf '[deploy-dev] %s\n' "$*"
}

if [[ ! -f "$ENV_FILE" ]]; then
  log "Missing env file: $ENV_FILE"
  log "Copy .env.dev.example to .env and fill dev values first."
  exit 1
fi

cd "$ROOT"

log "Installing dependencies"
pnpm install --frozen-lockfile

log "Building packages and apps"
pnpm build

log "Running database migrations"
pnpm db:migrate

log "Seeding dev data"
pnpm db:seed

log "Restarting PM2 services"
pm2 restart ecosystem.config.cjs --update-env

log "Running health check"
ENV=dev "$ROOT/scripts/health-check.sh"

log "Dev deploy completed"
