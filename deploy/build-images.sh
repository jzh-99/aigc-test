#!/usr/bin/env bash
# ============================================================
# build-images.sh — 在本机构建三个应用镜像并导出为 tar 包
# 用法：bash deploy/build-images.sh [api|web|worker|all]
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

  api_host_val="${api_host_val:-localhost}"
  api_port_val="${api_port_val:-7001}"
  storage_host_val="${storage_host_val:-$(read_env_value "$web_env" "INFRA_HOST")}"
  storage_port_val="${storage_port_val:-$(read_env_value "$web_env" "MINIO_API_PORT")}"
  storage_host_val="${storage_host_val:-localhost}"
  storage_port_val="${storage_port_val:-9000}"

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
  all)
    build_and_save "aigc-api"    "apps/api/Dockerfile"
    # web 单独处理，需要传入 next.config.mjs 构建期读取的参数
    build_web
    build_and_save "aigc-worker" "apps/worker/Dockerfile"
    ;;
  *)
    echo "用法：$0 [api|web|worker|all]"
    exit 1
    ;;
esac

echo ""
echo "====== 全部完成 ======"
ls -lh "$OUTPUT_DIR"
