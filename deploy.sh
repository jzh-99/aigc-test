#!/bin/bash
# =============================================================================
# deploy.sh — 更新部署脚本（每次发版使用）
# 用法: bash deploy.sh
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

# ── 1. 拉取最新代码 ───────────────────────────────────────
info "拉取最新代码..."
git pull

# ── 2. 安装/更新依赖 ──────────────────────────────────────
info "安装依赖..."
pnpm install --frozen-lockfile

# ── 3. 构建 ──────────────────────────────────────────────
info "构建项目..."
pnpm --filter @aigc/db build
pnpm --filter @aigc/types build
pnpm --filter @aigc/web build
pnpm --filter @aigc/worker build

# ── 4. 数据库迁移 + 种子数据（幂等） ──────────────────────
info "执行数据库迁移..."
set -a; source "$APP_DIR/.env"; set +a
pnpm --filter @aigc/db migrate

info "同步种子数据..."
pnpm --filter @aigc/db exec tsx scripts/seed.ts
pnpm --filter @aigc/db exec tsx scripts/seed-volcengine.ts

# ── 5. 重启服务 ───────────────────────────────────────────
info "重启 PM2 服务..."
pm2 restart ecosystem.config.cjs --update-env

info "✅ 更新完成！"
