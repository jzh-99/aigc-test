#!/bin/bash
# =============================================================================
# setup.sh — 新服务器首次部署脚本（Ubuntu 22.04）
# 用法: bash setup.sh <GITHUB_SSH_REPO_URL> [APP_DIR]
#   GITHUB_SSH_REPO_URL  必填，例如 git@github.com:your-org/aigc-test.git
#   APP_DIR              可选，默认 /opt/aigc
#
# 执行前只需：root 权限 + 能访问 GitHub（脚本会自动生成 SSH key 并引导添加）
# =============================================================================
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="${2:-/opt/aigc}"
LOG_DIR="$APP_DIR/logs"
NODE_MAJOR=20

# ── 颜色输出 ─────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[ -z "$REPO_URL" ] && error "用法: bash setup.sh <GITHUB_REPO_URL> [APP_DIR]"

# ── 1. 系统依赖 ───────────────────────────────────────────
info "安装系统依赖..."
apt-get update -q
apt-get install -y -q curl git ffmpeg ca-certificates gnupg build-essential

# Node 20 (via NodeSource)
if ! command -v node &>/dev/null || [[ "$(node --version)" != v${NODE_MAJOR}* ]]; then
  info "安装 Node.js ${NODE_MAJOR}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
else
  info "Node.js $(node --version) 已安装，跳过"
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  info "安装 pnpm..."
  npm install -g pnpm
else
  info "pnpm $(pnpm --version) 已安装，跳过"
fi

# PM2
if ! command -v pm2 &>/dev/null; then
  info "安装 PM2..."
  npm install -g pm2
  pm2 startup systemd -u root --hp /root
else
  info "PM2 $(pm2 --version) 已安装，跳过"
fi

# ── 2. Redis ──────────────────────────────────────────────
if ! command -v redis-server &>/dev/null; then
  info "安装 Redis..."
  apt-get install -y -q redis-server
  systemctl enable redis-server
  systemctl start redis-server
else
  info "Redis 已安装，跳过"
fi

# ── 3. PostgreSQL ─────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  info "安装 PostgreSQL..."
  apt-get install -y -q postgresql postgresql-client
  systemctl enable postgresql
  systemctl start postgresql
else
  info "PostgreSQL 已安装，跳过"
fi

# 创建数据库和用户（如果不存在）
info "配置 PostgreSQL 数据库..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename='aigc'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER aigc WITH PASSWORD 'aigcpass';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='aigc_prod'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE aigc_prod OWNER aigc;"

# ── 4. SSH Key（用于 clone 私有仓库） ─────────────────────
if [ ! -f ~/.ssh/id_ed25519 ]; then
  info "生成 SSH 密钥..."
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  ssh-keygen -t ed25519 -C "aigc-deploy" -f ~/.ssh/id_ed25519 -N ""
fi

# 确保 github.com 在 known_hosts 中
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null

# 测试是否已授权
if ! ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  echo ""
  echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  需要将以下公钥添加到 GitHub SSH Keys：${NC}"
  echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
  echo ""
  cat ~/.ssh/id_ed25519.pub
  echo ""
  echo "  添加地址：https://github.com/settings/ssh/new"
  echo "  Title 随意填写（如：aigc-server），将上方公钥粘贴到 Key 栏"
  echo ""
  echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
  read -r -p "添加完成后按 Enter 继续..."
  # 再次验证
  if ! ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    error "GitHub SSH 认证失败，请确认公钥已正确添加后重新运行脚本"
  fi
fi
info "GitHub SSH 认证成功"

# ── 5. 克隆代码 ───────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  warn "目录 $APP_DIR 已存在 git 仓库，跳过克隆"
else
  info "克隆仓库到 $APP_DIR..."
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# ── 6. .env 检查 ──────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  warn "未找到 .env 文件！"
  info "请参考 .env.example，在 $APP_DIR/.env 中填写所有必要配置后重新运行此脚本，或继续手动完成后续步骤"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo ""
  echo "  必须填写的关键变量："
  echo "    DATABASE_URL         (建议: postgresql://aigc:aigcpass@localhost:5432/aigc_prod)"
  echo "    JWT_SECRET           (随机长字符串)"
  echo "    EXTERNAL_STORAGE_URL (外部存储 API 地址)"
  echo "    NANO_BANANA_API_KEY  (AI 生成服务密钥)"
  echo "    CORS_ORIGIN          (前端域名，例如 https://aigc.example.com)"
  echo "    NEXT_PUBLIC_API_URL  (API 地址，例如 https://aigc.example.com/api/v1)"
  echo ""
  error "请先完善 $APP_DIR/.env 然后重新运行: bash setup.sh $REPO_URL $APP_DIR"
fi

# ── 7. 安装依赖 ───────────────────────────────────────────
info "安装 npm 依赖..."
pnpm install --frozen-lockfile

# ── 8. 构建 ──────────────────────────────────────────────
info "构建项目..."
pnpm --filter @aigc/db build
pnpm --filter @aigc/types build
pnpm --filter @aigc/web build

# ── 9. 数据库迁移 ─────────────────────────────────────────
info "执行数据库迁移..."
set -a; source "$APP_DIR/.env"; set +a
pnpm --filter @aigc/db migrate

# ── 10. 日志目录 ──────────────────────────────────────────
info "创建日志目录..."
mkdir -p "$LOG_DIR"

# ── 11. 启动服务 ──────────────────────────────────────────
info "启动 PM2 服务..."
pm2 start "$APP_DIR/ecosystem.config.cjs" --update-env
pm2 save

info ""
info "✅ 部署完成！"
info "   pm2 list            — 查看服务状态"
info "   pm2 logs            — 查看日志"
info "   bash deploy.sh      — 后续更新"
