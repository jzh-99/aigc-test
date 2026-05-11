#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

stop_web_for_build() {
  if pm2 describe aigc-test-web >/dev/null 2>&1; then
    info "Stopping web service before rebuilding .next..."
    pm2 stop aigc-test-web || warn "Failed to stop aigc-test-web; continuing build"
  fi
}

restart_pm2_services() {
  info "Restarting PM2 services..."
  pm2 startOrRestart ecosystem.config.cjs --update-env
  pm2 save
}

[ -f "$APP_DIR/.env" ] || error ".env is missing. Copy .env.example to .env and fill in deployment values."
[ -f "$APP_DIR/prompts.env" ] || error "prompts.env is missing. Copy prompts.env.example to prompts.env and fill in private prompt values."

info "Pulling latest code..."
git pull --ff-only

info "Installing dependencies..."
pnpm install --frozen-lockfile

info "Building packages..."
stop_web_for_build
pnpm --filter @aigc/db build
pnpm --filter @aigc/types build
pnpm --filter @aigc/web build
pnpm --filter @aigc/worker build

info "Running database migrations..."
set -a
source "$APP_DIR/.env"
set +a
pnpm --filter @aigc/db migrate

info "Seeding database..."
pnpm --filter @aigc/db exec tsx scripts/seed.ts
pnpm --filter @aigc/db exec tsx scripts/seed-volcengine.ts

restart_pm2_services

info "Deployment complete."
