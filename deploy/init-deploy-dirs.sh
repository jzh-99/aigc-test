#!/usr/bin/env bash
# ============================================================
# init-deploy-dirs.sh — 初始化部署目录结构
# 在服务器侧执行，创建必要的日志目录和配置文件
# ============================================================
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "====== 初始化部署目录 ======"

# 创建日志目录
mkdir -p "$DEPLOY_DIR/api/logs"
mkdir -p "$DEPLOY_DIR/worker/logs"

# 复制环境变量示例文件
for service in api worker web infra; do
  cd "$DEPLOY_DIR/$service"

  if [ -f .env.example ] && [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ 已创建 $service/.env（请手动填写真实值）"
  fi

  if [ -f prompts.env.example ] && [ ! -f prompts.env ]; then
    cp prompts.env.example prompts.env
    echo "✓ 已创建 $service/prompts.env（请手动填写真实值）"
  fi
done

echo ""
echo "====== 初始化完成 ======"
echo "下一步："
echo "1. 编辑各服务的 .env 和 prompts.env 文件"
echo "2. 按顺序部署：infra → api → worker → web"
echo "3. 执行数据库迁移（首次部署）"
