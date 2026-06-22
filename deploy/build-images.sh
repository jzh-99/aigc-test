#!/usr/bin/env bash
# ============================================================
# build-images.sh — 在本机构建/拉取镜像并导出为 tar 包
# 用法：bash deploy/build-images.sh [api|web|worker|infra|all]
#
#   api    构建自研 API 镜像（apps/api/Dockerfile）
#   web    构建自研 Web 镜像（apps/web/Dockerfile，需 deploy/web/.env）
#   worker 构建自研 Worker 镜像（apps/worker/Dockerfile）
#   infra  拉取基础服务官方镜像（postgres:16-alpine / redis:7-alpine）
#   all    构建 api + web + worker（不含 infra，infra 按需单独执行）
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/deploy/dist"
TARGET="${1:-all}"

mkdir -p "$OUTPUT_DIR"

build_and_save() {
  local name="$1"       # 镜像名，如 aigc-api
  local dockerfile="$2" # 相对于 REPO_ROOT 的 Dockerfile 路径

  echo ""
  echo "====== 构建 $name ======"
  docker build \
    --file "$REPO_ROOT/$dockerfile" \
    --tag "$name:latest" \
    "$REPO_ROOT"

  echo "====== 导出 $name → dist/$name.tar.gz ======"
  docker save "$name:latest" | gzip > "$OUTPUT_DIR/$name.tar.gz"
  echo "完成：$OUTPUT_DIR/$name.tar.gz ($(du -sh "$OUTPUT_DIR/$name.tar.gz" | cut -f1))"
}

# ============================================================
# 拉取官方镜像并打包为 tar（用于离线环境的基础设施部署）
# 镜像 tag 必须与 deploy/infra/docker-compose.yml 中一致
# ============================================================
pull_and_save() {
  local image="$1"      # 完整镜像名，如 postgres:16-alpine
  local tar_name="$2"   # 导出的 tar 名（不含扩展名），如 postgres

  echo ""
  echo "====== 拉取 $image ======"
  docker pull "$image"

  echo "====== 导出 $image → dist/$tar_name.tar.gz ======"
  docker save "$image" | gzip > "$OUTPUT_DIR/$tar_name.tar.gz"
  echo "完成：$OUTPUT_DIR/$tar_name.tar.gz ($(du -sh "$OUTPUT_DIR/$tar_name.tar.gz" | cut -f1))"
}

build_infra() {
  echo "====== 基础设施镜像（官方镜像，离线打包）======"
  pull_and_save "postgres:16-alpine" "postgres"
  pull_and_save "redis:7-alpine"     "redis"
}

read_env_value() {
  local env_file="$1"
  local key="$2"

  if [ ! -f "$env_file" ]; then
    return 0
  fi

  (grep -E "^${key}=" "$env_file" || true) \
    | tail -n 1 \
    | cut -d= -f2- \
    | sed 's/#.*//' \
    | xargs
}

build_web() {
  local web_env="$REPO_ROOT/deploy/web/.env"
  local api_host_val
  local api_port_val
  local storage_host_val
  local storage_port_val

  api_host_val="$(read_env_value "$web_env" "API_HOST")"
  api_port_val="$(read_env_value "$web_env" "API_PORT")"
  storage_host_val="$(read_env_value "$web_env" "NEXT_PUBLIC_STORAGE_HOST")"
  storage_port_val="$(read_env_value "$web_env" "NEXT_PUBLIC_STORAGE_PORT")"

  # 生产环境必须显式指定存储地址，不再回退到 INFRA_HOST（生产用 TOS，不用 MinIO）
  if [ -z "$storage_host_val" ]; then
    echo "错误：deploy/web/.env 中必须设置 NEXT_PUBLIC_STORAGE_HOST（火山 TOS 公网域名）"
    exit 1
  fi

  api_host_val="${api_host_val:-localhost}"
  api_port_val="${api_port_val:-7001}"
  storage_port_val="${storage_port_val:-443}"  # TOS 默认用 HTTPS

  echo "====== web 构建参数：INTERNAL_API_URL=http://${api_host_val}:${api_port_val} ======"
  echo "====== web 构建参数：NEXT_PUBLIC_STORAGE_HOST=${storage_host_val}, NEXT_PUBLIC_STORAGE_PORT=${storage_port_val} ======"
  docker build \
    --file "$REPO_ROOT/apps/web/Dockerfile" \
    --tag "aigc-web:latest" \
    --build-arg "INTERNAL_API_URL=http://${api_host_val}:${api_port_val}" \
    --build-arg "NEXT_PUBLIC_STORAGE_HOST=${storage_host_val}" \
    --build-arg "NEXT_PUBLIC_STORAGE_PORT=${storage_port_val}" \
    "$REPO_ROOT"
  echo "====== 导出 aigc-web → dist/aigc-web.tar.gz ======"
  docker save "aigc-web:latest" | gzip > "$OUTPUT_DIR/aigc-web.tar.gz"
  echo "完成：$OUTPUT_DIR/aigc-web.tar.gz ($(du -sh "$OUTPUT_DIR/aigc-web.tar.gz" | cut -f1))"
}

case "$TARGET" in
  api)
    build_and_save "aigc-api" "apps/api/Dockerfile"
    ;;
  web)
    build_web
    ;;
  worker)
    build_and_save "aigc-worker" "apps/worker/Dockerfile"
    ;;
  infra)
    build_infra
    ;;
  all)
    build_and_save "aigc-api"    "apps/api/Dockerfile"
    # web 单独处理，需要传入 next.config.mjs 构建期读取的参数
    build_web
    build_and_save "aigc-worker" "apps/worker/Dockerfile"
    ;;
  *)
    echo "用法：$0 [api|web|worker|infra|all]"
    echo "  all 不含 infra，基础设施镜像请按需单独执行：bash $0 infra"
    exit 1
    ;;
esac

echo ""
echo "====== 全部完成 ======"
ls -lh "$OUTPUT_DIR"
