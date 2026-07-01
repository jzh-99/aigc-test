#!/usr/bin/env bash
# ============================================================
# 一键把 example-configs/ai-providers/*.properties 导入 Nacos
#
# 用法：
#   bash deploy/nacos/example-configs/import-to-nacos.sh
#
# 可选环境变量（覆盖默认值）：
#   NACOS_ADDR        Nacos 地址，默认 localhost:8848
#   NACOS_NAMESPACE   命名空间 ID，默认 public（本地默认）
#   NACOS_GROUP       分组，默认 AI_GROUP（与应用代码一致，一般不改）
#   NACOS_USERNAME    开启鉴权时填；留空则按未鉴权处理
#   NACOS_PASSWORD    同上
#
# 脚本逻辑：
#   1. 若提供 NACOS_USERNAME，先登录拿 accessToken
#   2. 遍历 ai-providers/*.properties，逐个 POST /nacos/v1/cs/configs 发布
#   3. 打印每条结果（成功/失败 + HTTP 码）
#
# 注意：properties 文件里的 `#` 注释会作为 content 原文存入 Nacos，
#       应用端 parseProperties 会自动跳过注释行，无副作用。
# ============================================================
set -uo pipefail

# ---- 配置（环境变量优先）----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}"   # properties 文件与脚本同目录（平铺，文件名即 dataId）
NACOS_ADDR="${NACOS_ADDR:-localhost:8848}"
NACOS_NAMESPACE="${NACOS_NAMESPACE:-public}"
NACOS_GROUP="${NACOS_GROUP:-AI_GROUP}"
NACOS_USERNAME="${NACOS_USERNAME:-${NACOS_USERNAME:-}}"
NACOS_PASSWORD="${NACOS_PASSWORD:-${NACOS_PASSWORD:-}}"

BASE_URL="http://${NACOS_ADDR}/nacos"

# ---- 颜色输出 ----
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'
ok()   { printf "${GREEN}[OK]${NC}   %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; }
info() { printf "${YELLOW}[INFO]${NC} %s\n" "$1"; }

# ---- 校验配置目录 ----
if [[ ! -d "$CONFIG_DIR" ]]; then
  fail "配置目录不存在: $CONFIG_DIR"
  exit 1
fi

shopt -s nullglob
FILES=("$CONFIG_DIR"/*.properties)
if [[ ${#FILES[@]} -eq 0 ]]; then
  fail "在 $CONFIG_DIR 下没找到 .properties 文件"
  exit 1
fi

# ---- 登录拿 accessToken（仅在配置了账号时）----
ACCESS_TOKEN=""
if [[ -n "$NACOS_USERNAME" ]]; then
  info "Nacos 开启了鉴权，正在登录获取 accessToken ..."
  LOGIN_RESP=$(curl -fsS -X POST "${BASE_URL}/v1/auth/login" \
    --data-urlencode "username=${NACOS_USERNAME}" \
    --data-urlencode "password=${NACOS_PASSWORD}" 2>/dev/null) || {
    fail "登录失败，请检查 NACOS_ADDR / NACOS_USERNAME / NACOS_PASSWORD"
    exit 1
  }
  # 解析 accessToken（用 grep/sed 提取，避免依赖 jq）
  ACCESS_TOKEN=$(echo "$LOGIN_RESP" | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [[ -z "$ACCESS_TOKEN" ]]; then
    fail "登录响应里没解析到 accessToken：$LOGIN_RESP"
    exit 1
  fi
  ok "登录成功，已获取 accessToken"
else
  info "未设置 NACOS_USERNAME，按未鉴权处理（本地默认场景）"
fi

# ---- 逐个发布配置 ----
info "目标：Nacos=${NACOS_ADDR}  namespace=${NACOS_NAMESPACE}  group=${NACOS_GROUP}"

# Nacos OpenAPI 的 tenant 与 namespace 的映射：
# 默认 public namespace 在 OpenAPI 里 tenant 必须传「空串」；若传 "public" 字符串，
# 配置会被写进一个名为 "public" 的自定义命名空间，导致默认连 public 的应用订阅不到。
# 自定义 namespace（dev/staging/production）的 tenant = namespace 的 ID。
if [[ "$NACOS_NAMESPACE" == "public" || -z "$NACOS_NAMESPACE" ]]; then
  TENANT=""
else
  TENANT="$NACOS_NAMESPACE"
fi
info "待导入 ${#FILES[@]} 个配置文件 ..."

SUCCESS_COUNT=0
FAIL_COUNT=0

for file in "${FILES[@]}"; do
  # 文件名即 dataId（如 ai-providers-doubao.properties），与代码里 AI_CONFIG_DATA_IDS 一一对应
  data_id="$(basename "$file")"
  content="$(cat "$file")"

  # 拼 accessToken 参数（若有）
  TOKEN_PARAM=""
  if [[ -n "$ACCESS_TOKEN" ]]; then
    TOKEN_PARAM="--data-urlencode accessToken=${ACCESS_TOKEN}"
  fi

  # 用 --data-urlencode 让 curl 自动对 content 做 URL 编码（含 =、#、换行都安全）
  HTTP_CODE=$(curl -sS -o /tmp/nacos_import_resp.txt -w "%{http_code}" \
    -X POST "${BASE_URL}/v1/cs/configs" \
    --data-urlencode "dataId=${data_id}" \
    --data-urlencode "group=${NACOS_GROUP}" \
    --data-urlencode "tenant=${TENANT}" \
    --data-urlencode "type=properties" \
    --data-urlencode "content=${content}" \
    $TOKEN_PARAM 2>/dev/null)

  # Nacos v1 发布成功返回 true（HTTP 200），body 为 "true"
  RESP_BODY="$(cat /tmp/nacos_import_resp.txt 2>/dev/null)"
  if [[ "$HTTP_CODE" == "200" && "$RESP_BODY" == "true" ]]; then
    ok "${data_id}"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    fail "${data_id}  HTTP=${HTTP_CODE}  resp=${RESP_BODY}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

rm -f /tmp/nacos_import_resp.txt

echo ""
info "导入完成：成功 ${SUCCESS_COUNT}，失败 ${FAIL_COUNT}"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
