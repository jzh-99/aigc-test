#!/bin/bash
# =============================================================================
# deploy-local.sh — 本地开发快速部署（跳过 pull 和 install）
# 用法: bash deploy-local.sh
# 在项目根目录执行即可
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[ -f "$APP_DIR/.env" ] || error ".env 文件不存在，请先运行 setup.sh"

# ── 1. 构建 ──────────────────────────────────────────────
info "构建项目..."
pnpm --filter @aigc/db build
pnpm --filter @aigc/types build
pnpm --filter @aigc/web build
pnpm --filter @aigc/worker build

# ── 2. 数据库迁移（幂等） ─────────────────────────────────
info "执行数据库迁移..."
set -a; source "$APP_DIR/.env"; set +a
pnpm --filter @aigc/db migrate

# ── 3. 重启服务 ───────────────────────────────────────────
info "重启 PM2 服务..."
pm2 restart ecosystem.config.cjs --update-env

info "✅ 更新完成！"
