# 测试环境部署指南

测试站地址：`https://u703085-b83c-f19cd560.westx.seetacloud.com:8443`
本地端口：`6006`（web）、`7001`（API）

---

## 每次改完代码后的标准流程

### 第一步：构建

```bash
pnpm --filter @aigc/web build
```

只构建 web 包，输出到 `apps/web/.next/`。耗时约 30–60 秒。

**必须构建的情况：**
- 修改了任何前端代码（组件、store、hooks、页面等）

**不需要构建的情况：**
- 只改了 API（`apps/api/`）或 Worker（`apps/worker/`），pm2 用 tsx 直接运行 ts 源码，改完 restart 即可

### 第二步：重启 pm2

```bash
pm2 restart aigc-test-web
```

### 第三步：确认状态正常

```bash
pm2 list
```

检查 `aigc-test-web` 的：
- `status` 为 **online**
- `uptime` 持续增长（不是一直 0s）
- `↺` 重启次数没有持续增加

---

## 完整命令（一键执行）

```bash
pnpm --filter @aigc/web build && pm2 restart aigc-test-web
```

---

## 只改 API 或 Worker 时

```bash
# 只改了 API
pm2 restart aigc-test-api

# 只改了 Worker
pm2 restart aigc-test-worker
```

API 和 Worker 由 tsx 直接运行 TypeScript 源码，无需构建步骤。

---

## 查看日志

```bash
# 前端日志（最近 50 行）
pm2 logs aigc-test-web --lines 50 --nostream

# 实时跟踪前端日志
pm2 logs aigc-test-web

# API 日志
pm2 logs aigc-test-api --lines 50 --nostream
```

日志文件位置：
- 前端输出：`/root/autodl-tmp/logs/test-web-out.log`
- 前端错误：`/root/autodl-tmp/logs/test-web-err.log`
- API 输出：`/root/autodl-tmp/logs/test-api-out.log`
- API 错误：`/root/autodl-tmp/logs/test-api-err.log`

---

## 故障排查

### 症状：页面打不开 / pm2 反复重启

```bash
pm2 logs aigc-test-web --lines 30 --nostream
```

**常见原因 1：没有 production build**

错误信息：`Could not find a production build in the '.next' directory`

解决：执行构建步骤，重新 `pm2 restart aigc-test-web`。

**常见原因 2：6006 端口被孤儿进程占用**

```bash
# 查找占用进程
ss -tlnp | grep 6006

# 确认进程身份（<PID> 替换为实际值）
ls -la /proc/<PID>/cwd

# 终止孤儿进程
kill <PID>

# 确认端口已释放
ss -tlnp | grep 6006   # 无输出则成功

# 重启服务
pm2 restart aigc-test-web
```

或一键强杀后重启：

```bash
# 注意：会中断当前正在运行的服务，确认是孤儿进程后再用
ss -tlnp | grep 6006   # 确认 PID
kill <PID> && pm2 restart aigc-test-web
```

---

## 生产环境（6008 端口，勿随意操作）

| pm2 名称         | 端口 |
|-----------------|------|
| aigc-prod-web   | 6008 |
| aigc-prod-api   | —    |
| aigc-prod-worker| —    |

生产环境部署在独立目录，与测试环境代码隔离，**不要用 `pm2 restart all`**，避免误重启生产服务。
