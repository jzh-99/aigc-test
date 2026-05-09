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

case "$TARGET" in
  api)
    build_and_save "aigc-api" "apps/api/Dockerfile"
    ;;
  web)
    # 从 deploy/web/.env 读取 API_HOST/API_PORT，构建时烧入 routes-manifest.json
    WEB_ENV="$REPO_ROOT/deploy/web/.env"
    if [ -f "$WEB_ENV" ]; then
      API_HOST_VAL=$(grep -E '^API_HOST=' "$WEB_ENV" | cut -d= -f2 | tr -d '[:space:]' | sed 's/#.*//')
      API_PORT_VAL=$(grep -E '^API_PORT=' "$WEB_ENV" | cut -d= -f2 | tr -d '[:space:]' | sed 's/#.*//')
    fi
    API_HOST_VAL="${API_HOST_VAL:-localhost}"
    API_PORT_VAL="${API_PORT_VAL:-7001}"
    echo "====== web 构建参数：INTERNAL_API_URL=http://${API_HOST_VAL}:${API_PORT_VAL} ======"
    docker build \
      --file "$REPO_ROOT/apps/web/Dockerfile" \
      --tag "aigc-web:latest" \
      --build-arg "INTERNAL_API_URL=http://${API_HOST_VAL}:${API_PORT_VAL}" \
      "$REPO_ROOT"
    echo "====== 导出 aigc-web → dist/aigc-web.tar.gz ======"
    docker save "aigc-web:latest" | gzip > "$OUTPUT_DIR/aigc-web.tar.gz"
    echo "完成：$OUTPUT_DIR/aigc-web.tar.gz ($(du -sh "$OUTPUT_DIR/aigc-web.tar.gz" | cut -f1))"
    ;;
  worker)
    build_and_save "aigc-worker" "apps/worker/Dockerfile"
    ;;
  all)
    build_and_save "aigc-api"    "apps/api/Dockerfile"
    # web 单独处理，需要传入 INTERNAL_API_URL 构建参数
    WEB_ENV="$REPO_ROOT/deploy/web/.env"
    if [ -f "$WEB_ENV" ]; then
      API_HOST_VAL=$(grep -E '^API_HOST=' "$WEB_ENV" | cut -d= -f2 | tr -d '[:space:]' | sed 's/#.*//')
      API_PORT_VAL=$(grep -E '^API_PORT=' "$WEB_ENV" | cut -d= -f2 | tr -d '[:space:]' | sed 's/#.*//')
    fi
    API_HOST_VAL="${API_HOST_VAL:-localhost}"
    API_PORT_VAL="${API_PORT_VAL:-7001}"
    echo "====== web 构建参数：INTERNAL_API_URL=http://${API_HOST_VAL}:${API_PORT_VAL} ======"
    docker build \
      --file "$REPO_ROOT/apps/web/Dockerfile" \
      --tag "aigc-web:latest" \
      --build-arg "INTERNAL_API_URL=http://${API_HOST_VAL}:${API_PORT_VAL}" \
      "$REPO_ROOT"
    docker save "aigc-web:latest" | gzip > "$OUTPUT_DIR/aigc-web.tar.gz"
    echo "完成：$OUTPUT_DIR/aigc-web.tar.gz ($(du -sh "$OUTPUT_DIR/aigc-web.tar.gz" | cut -f1))"
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
