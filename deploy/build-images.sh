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
    build_and_save "aigc-web" "apps/web/Dockerfile"
    ;;
  worker)
    build_and_save "aigc-worker" "apps/worker/Dockerfile"
    ;;
  all)
    build_and_save "aigc-api"    "apps/api/Dockerfile"
    build_and_save "aigc-web"    "apps/web/Dockerfile"
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
