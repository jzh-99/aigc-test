#!/usr/bin/env bash
# ============================================================
# 基础设施服务器宿主机初始化（幂等，可重复执行）
#
# 作用：
#   1. 创建 2GB swap（避免 PostgreSQL 内存峰值触发 OOM Killer）
#   2. 设置 vm.swappiness=10（优先用物理内存，仅兜底用 swap）
#   3. 持久化到 /etc/fstab，重启不丢失
#
# 为什么不在容器内做？
#   swap 是宿主机内核级配置，容器没有 swapon/mkswap 权限，
#   即使 --privileged 也无法管理宿主机 swap。必须在宿主机执行一次。
#
# 用法：
#   sudo bash setup-host.sh           # 默认创建 2GB swap
#   sudo bash setup-host.sh 4G        # 指定 swap 大小
#   sudo bash setup-host.sh --check   # 仅检查不修改
# ============================================================

set -euo pipefail

SWAP_SIZE="${1:-2G}"
CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

# ---- 颜色输出 ----
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
info()  { echo "${GREEN}[✓]${NC} $*"; }
warn()  { echo "${YELLOW}[!]${NC} $*"; }
fail()  { echo "${RED}[✗]${NC} $*" >&2; exit 1; }

# ---- 权限检查 ----
[[ $EUID -eq 0 ]] || fail "请用 root 或 sudo 执行：sudo bash $0"

echo "=========================================="
echo "  基础设施服务器初始化检查"
echo "=========================================="

# ---- 1. 检查物理内存 ----
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_MEM_GB=$(( TOTAL_MEM_KB / 1024 / 1024 ))
echo "物理内存：${TOTAL_MEM_GB} GB"

if [[ "$TOTAL_MEM_GB" -lt 4 ]]; then
    warn "物理内存 < 4GB，建议升级到 8GB 以上再部署生产环境"
fi

# ---- 2. 检查/创建 swap ----
CURRENT_SWAP_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
CURRENT_SWAP_GB=$(( CURRENT_SWAP_KB / 1024 / 1024 ))

if [[ "$CURRENT_SWAP_KB" -gt 0 ]]; then
    info "已存在 swap：${CURRENT_SWAP_GB} GB（跳过创建）"
else
    if $CHECK_ONLY; then
        warn "未配置 swap（--check 模式不修改）"
    else
        # 幂等：先检查 /swapfile 是否已存在
        if [[ -f /swapfile ]]; then
            warn "/swapfile 已存在但未启用，尝试 swapon"
            sudo swapon /swapfile || warn "swapon 失败，可能格式不对，建议删除后重建"
        else
            echo "创建 ${SWAP_SIZE} swap 文件..."
            fallocate -l "$SWAP_SIZE" /swapfile
            chmod 600 /swapfile
            mkswap /swapfile
            swapon /swapfile
            info "swap 已启用：${SWAP_SIZE}"
        fi
    fi
fi

# ---- 3. 持久化到 /etc/fstab（幂等：已存在则跳过）----
if ! $CHECK_ONLY; then
    if grep -q '^/swapfile' /etc/fstab 2>/dev/null; then
        info "/etc/fstab 已包含 /swapfile（跳过）"
    else
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
        info "已写入 /etc/fstab，重启后 swap 自动挂载"
    fi
fi

# ---- 4. 设置 vm.swappiness（幂等：每次设置无副作用）----
if ! $CHECK_ONLY; then
    CURRENT_SWAPPINESS=$(cat /proc/sys/vm/swappiness)
    if [[ "$CURRENT_SWAPPINESS" -eq 10 ]]; then
        info "vm.swappiness 已是 10（跳过）"
    else
        sysctl -w vm.swappiness=10 >/dev/null
        # 持久化到 sysctl 配置文件
        if grep -q '^vm.swappiness' /etc/sysctl.conf 2>/dev/null; then
            sed -i 's/^vm.swappiness.*/vm.swappiness=10/' /etc/sysctl.conf
        else
            echo 'vm.swappiness=10' >> /etc/sysctl.conf
        fi
        info "vm.swappiness 设置为 10 并持久化"
    fi
fi

# ---- 5. 最终检查 ----
echo ""
echo "=========================================="
echo "  当前状态"
echo "=========================================="
free -h
echo ""
echo "vm.swappiness = $(cat /proc/sys/vm/swappiness)"
if grep -q '^/swapfile' /etc/fstab 2>/dev/null; then
    echo "/etc/fstab: /swapfile 已持久化"
else
    warn "/etc/fstab: /swapfile 未持久化（重启后 swap 不会自动挂载）"
fi

echo ""
if $CHECK_ONLY; then
    echo "（--check 模式，未做任何修改）"
else
    info "初始化完成。后续重建容器不会影响 swap，此脚本无需重复执行。"
fi
