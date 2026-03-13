# Git 双环境部署 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在同一台 AutoDL 服务器上用 git 裸仓库实现 develop→测试环境、master→正式环境的全自动部署。

**Architecture:** 本地笔记本为工作仓库，`git push production <branch>` 触发服务器裸仓库的 post-receive hook，hook 根据分支将代码 checkout 到对应目录（aigc-test / aigc-prod），并自动安装依赖、构建、迁移数据库、重启 PM2 进程。

**Tech Stack:** git bare repo, bash hook, pnpm, PM2, PostgreSQL (双库), Redis (双 DB), Node.js 20

**服务器地址:** `116.172.96.152`（AutoDL，仅开放 6006/6008 公网端口）

---

## 前置：确认 SSH 访问

在执行所有服务器任务前必须能 SSH 登录。本计划所有 SSH 命令均假设已能无密码登录。

```bash
ssh root@116.172.96.152 'echo "SSH OK"'
```

若失败，请用户通过 AutoDL 控制台重置 SSH 密码，或重新上传公钥。

---

### Task 1: 服务器环境核查与补装

**Files:** 无（纯服务器操作）

**Step 1: 检查已安装工具**

```bash
ssh root@116.172.96.152 'node -v && pnpm -v && pm2 -v && psql --version && redis-cli --version'
```

预期输出类似：`v20.x`, `9.x`, `5.x`, `15.x`, `7.x`

**Step 2: 如有缺失，补装 pnpm 和 pm2**

```bash
ssh root@116.172.96.152 'npm install -g pnpm pm2'
```

**Step 3: 确认 PostgreSQL 和 Redis 正在运行**

```bash
ssh root@116.172.96.152 'systemctl status postgresql | grep Active && systemctl status redis | grep Active'
```

两者应显示 `active (running)`。

---

### Task 2: 创建服务器目录结构与裸仓库

**Files:** 无（服务器目录操作）

**Step 1: 创建目录**

```bash
ssh root@116.172.96.152 'mkdir -p /root/autodl-tmp/aigc.git /root/autodl-tmp/aigc-test /root/autodl-tmp/aigc-prod'
```

**Step 2: 初始化裸仓库**

```bash
ssh root@116.172.96.152 'git init --bare /root/autodl-tmp/aigc.git'
```

预期输出：`Initialized empty Git repository in /root/autodl-tmp/aigc.git/`

**Step 3: 验证裸仓库结构**

```bash
ssh root@116.172.96.152 'ls /root/autodl-tmp/aigc.git/'
```

预期输出包含：`HEAD  branches  config  description  hooks  info  objects  refs`

---

### Task 3: 创建 post-receive Hook

**Files:**
- 创建（服务器上）: `/root/autodl-tmp/aigc.git/hooks/post-receive`

**Step 1: 上传 hook 脚本**

在本地执行：

```bash
cat << 'HOOK' | ssh root@116.172.96.152 'cat > /root/autodl-tmp/aigc.git/hooks/post-receive'
#!/bin/bash
set -e

REPO_DIR="/root/autodl-tmp/aigc.git"
TEST_DIR="/root/autodl-tmp/aigc-test"
PROD_DIR="/root/autodl-tmp/aigc-prod"
LOG_DIR="/root/autodl-tmp/logs"
mkdir -p "$LOG_DIR"

deploy() {
  local BRANCH="$1"
  local DEPLOY_DIR="$2"
  local ENV="$3"
  local TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$TIMESTAMP] Deploying branch '$BRANCH' to $DEPLOY_DIR ..."

  # Checkout code
  git --work-tree="$DEPLOY_DIR" --git-dir="$REPO_DIR" checkout -f "$BRANCH"

  cd "$DEPLOY_DIR"

  # Install dependencies
  echo "  → pnpm install"
  pnpm install --frozen-lockfile 2>&1

  # Build
  echo "  → pnpm build"
  pnpm build 2>&1

  # Database migration
  echo "  → db migrate"
  pnpm --filter @aigc/db db:migrate 2>&1

  # Restart PM2
  echo "  → pm2 restart $ENV"
  pm2 restart "aigc-$ENV-api" "aigc-$ENV-worker" "aigc-$ENV-web" 2>&1 || \
  pm2 start /root/autodl-tmp/aigc-$ENV/ecosystem.config.cjs 2>&1

  echo "[$TIMESTAMP] Deploy '$ENV' complete ✓"
}

while read oldrev newrev refname; do
  BRANCH=$(git rev-parse --symbolic --abbrev-ref "$refname")
  case "$BRANCH" in
    develop)
      deploy "develop" "$TEST_DIR" "test" >> "$LOG_DIR/deploy-test.log" 2>&1 &
      echo "✓ Test deploy triggered (develop → aigc-test). Logs: $LOG_DIR/deploy-test.log"
      ;;
    master)
      deploy "master" "$PROD_DIR" "prod" >> "$LOG_DIR/deploy-prod.log" 2>&1 &
      echo "✓ Prod deploy triggered (master → aigc-prod). Logs: $LOG_DIR/deploy-prod.log"
      ;;
    *)
      echo "Branch '$BRANCH' pushed — no deploy configured, skipping."
      ;;
  esac
done
HOOK
```

**Step 2: 赋予执行权限**

```bash
ssh root@116.172.96.152 'chmod +x /root/autodl-tmp/aigc.git/hooks/post-receive'
```

**Step 3: 验证 hook 文件**

```bash
ssh root@116.172.96.152 'head -5 /root/autodl-tmp/aigc.git/hooks/post-receive && ls -la /root/autodl-tmp/aigc.git/hooks/post-receive'
```

预期：文件内容正确，权限含 `x`（如 `-rwxr-xr-x`）

---

### Task 4: 数据库隔离设置

**Step 1: 创建测试数据库和正式数据库**

```bash
ssh root@116.172.96.152 'sudo -u postgres psql -c "CREATE DATABASE aigc_test;" 2>/dev/null || echo "aigc_test already exists"'
ssh root@116.172.96.152 'sudo -u postgres psql -c "CREATE DATABASE aigc_prod;" 2>/dev/null || echo "aigc_prod already exists"'
```

**Step 2: 确认两个数据库存在**

```bash
ssh root@116.172.96.152 'sudo -u postgres psql -c "\l" | grep aigc'
```

预期输出包含 `aigc_test` 和 `aigc_prod`。

---

### Task 5: 创建环境配置文件（.env）

**注意：** `.env` 文件不进 git，每个环境单独维护。

**Step 1: 读取当前正式环境 .env（已有）**

```bash
ssh root@116.172.96.152 'cat /root/autodl-tmp/aigc-platform/.env 2>/dev/null || echo "no existing env"'
```

**Step 2: 创建测试环境 .env**

将下列内容写入 `/root/autodl-tmp/aigc-test/.env`（替换 `<PASSWORD>` 为实际密码）：

```bash
ssh root@116.172.96.152 'cat > /root/autodl-tmp/aigc-test/.env << "EOF"
DATABASE_URL=postgresql://aigc:<PASSWORD>@localhost:5432/aigc_test
REDIS_URL=redis://:<PASSWORD>@localhost:6379/1
JWT_SECRET=<TEST_JWT_SECRET_64CHARS>
PORT=3001
CORS_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
EXTERNAL_STORAGE_URL=http://61.155.227.20:19092/chatAI/api/video/content
NANO_BANANA_API_KEY=<YOUR_API_KEY>
NODE_ENV=production
LOG_LEVEL=info
EOF'
```

**Step 3: 创建正式环境 .env**

```bash
ssh root@116.172.96.152 'cat > /root/autodl-tmp/aigc-prod/.env << "EOF"
DATABASE_URL=postgresql://aigc:<PASSWORD>@localhost:5432/aigc_prod
REDIS_URL=redis://:<PASSWORD>@localhost:6379/0
JWT_SECRET=<PROD_JWT_SECRET_64CHARS>
PORT=6008
CORS_ORIGIN=https://u703085-b83c-f19cd560.westx.seetacloud.com:8443
NEXT_PUBLIC_API_URL=http://localhost:6008
EXTERNAL_STORAGE_URL=http://61.155.227.20:19092/chatAI/api/video/content
NANO_BANANA_API_KEY=<YOUR_API_KEY>
NODE_ENV=production
LOG_LEVEL=info
EOF'
```

---

### Task 6: 创建 PM2 Ecosystem 配置文件

**Step 1: 写入测试环境 PM2 配置**

```bash
ssh root@116.172.96.152 'cat > /root/autodl-tmp/aigc-test/ecosystem.config.cjs << "EOF"
module.exports = {
  apps: [
    {
      name: "aigc-test-api",
      cwd: "/root/autodl-tmp/aigc-test",
      script: "npx",
      args: "tsx apps/api/src/index.ts",
      env_file: "/root/autodl-tmp/aigc-test/.env",
      watch: false,
      autorestart: true,
      max_restarts: 5,
      error_file: "/root/autodl-tmp/logs/test-api-error.log",
      out_file: "/root/autodl-tmp/logs/test-api-out.log",
    },
    {
      name: "aigc-test-worker",
      cwd: "/root/autodl-tmp/aigc-test",
      script: "npx",
      args: "tsx apps/worker/src/index.ts",
      env_file: "/root/autodl-tmp/aigc-test/.env",
      watch: false,
      autorestart: true,
      max_restarts: 5,
      error_file: "/root/autodl-tmp/logs/test-worker-error.log",
      out_file: "/root/autodl-tmp/logs/test-worker-out.log",
    },
    {
      name: "aigc-test-web",
      cwd: "/root/autodl-tmp/aigc-test/apps/web",
      script: "npx",
      args: "next start -p 3000",
      env_file: "/root/autodl-tmp/aigc-test/.env",
      watch: false,
      autorestart: true,
      max_restarts: 5,
      error_file: "/root/autodl-tmp/logs/test-web-error.log",
      out_file: "/root/autodl-tmp/logs/test-web-out.log",
    },
  ],
}
EOF'
```

**Step 2: 写入正式环境 PM2 配置**

```bash
ssh root@116.172.96.152 'cat > /root/autodl-tmp/aigc-prod/ecosystem.config.cjs << "EOF"
module.exports = {
  apps: [
    {
      name: "aigc-prod-api",
      cwd: "/root/autodl-tmp/aigc-prod",
      script: "npx",
      args: "tsx apps/api/src/index.ts",
      env_file: "/root/autodl-tmp/aigc-prod/.env",
      watch: false,
      autorestart: true,
      max_restarts: 5,
      error_file: "/root/autodl-tmp/logs/prod-api-error.log",
      out_file: "/root/autodl-tmp/logs/prod-api-out.log",
    },
    {
      name: "aigc-prod-worker",
      cwd: "/root/autodl-tmp/aigc-prod",
      script: "npx",
      args: "tsx apps/worker/src/index.ts",
      env_file: "/root/autodl-tmp/aigc-prod/.env",
      watch: false,
      autorestart: true,
      max_restarts: 5,
      error_file: "/root/autodl-tmp/logs/prod-worker-error.log",
      out_file: "/root/autodl-tmp/logs/prod-worker-out.log",
    },
    {
      name: "aigc-prod-web",
      cwd: "/root/autodl-tmp/aigc-prod/apps/web",
      script: "npx",
      args: "next start -p 6006",
      env_file: "/root/autodl-tmp/aigc-prod/.env",
      watch: false,
      autorestart: true,
      max_restarts: 5,
      error_file: "/root/autodl-tmp/logs/prod-web-error.log",
      out_file: "/root/autodl-tmp/logs/prod-web-out.log",
    },
  ],
}
EOF'
```

---

### Task 7: 本地 Git 配置

**Files:**
- 修改: `C:\Users\momo\创作平台\.git/config`（通过 git 命令）

**Step 1: 在本地创建 develop 分支**

```bash
cd C:\Users\momo\创作平台
git checkout -b develop
```

**Step 2: 添加服务器为远程仓库**

```bash
git remote add production root@116.172.96.152:/root/autodl-tmp/aigc.git
```

**Step 3: 验证远程配置**

```bash
git remote -v
```

预期输出：
```
production  root@116.172.96.152:/root/autodl-tmp/aigc.git (fetch)
production  root@116.172.96.152:/root/autodl-tmp/aigc.git (push)
```

---

### Task 8: 首次推送与手动初始化（测试环境）

**Step 1: 提交当前所有修改（含外部存储集成代码）**

```bash
cd C:\Users\momo\创作平台
git add -A
git status  # 确认要提交的文件
git commit -m "feat: integrate external storage API and git deployment setup"
```

**Step 2: 推送 develop 到服务器**

```bash
git push production develop
```

预期服务器输出：`✓ Test deploy triggered`

**Step 3: 进入服务器手动完成首次初始化**

由于首次部署前没有 `.env` 文件（hook 已经 checkout 了代码），需要确认 .env 已就位：

```bash
ssh root@116.172.96.152 'ls /root/autodl-tmp/aigc-test/.env'
```

**Step 4: 手动执行首次安装和迁移（测试环境）**

```bash
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-test && pnpm install --frozen-lockfile'
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-test && pnpm build'
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-test && pnpm --filter @aigc/db db:migrate'
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-test && pnpm --filter @aigc/db db:seed'
```

**Step 5: 启动测试环境 PM2 进程**

```bash
ssh root@116.172.96.152 'pm2 start /root/autodl-tmp/aigc-test/ecosystem.config.cjs && pm2 save'
```

**Step 6: 验证测试环境运行**

```bash
ssh root@116.172.96.152 'pm2 list | grep aigc-test'
```

所有三个进程应显示 `online`。

---

### Task 9: 首次推送与手动初始化（正式环境）

**Step 1: 合并到 master 并推送**

```bash
cd C:\Users\momo\创作平台
git checkout master
git merge develop
git push production master
```

**Step 2: 手动完成正式环境首次初始化**

```bash
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-prod && pnpm install --frozen-lockfile'
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-prod && pnpm build'
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-prod && pnpm --filter @aigc/db db:migrate'
ssh root@116.172.96.152 'cd /root/autodl-tmp/aigc-prod && pnpm --filter @aigc/db db:seed'
```

**Step 3: 启动正式环境 PM2 进程**

```bash
ssh root@116.172.96.152 'pm2 start /root/autodl-tmp/aigc-prod/ecosystem.config.cjs && pm2 save'
```

**Step 4: 验证正式环境运行**

```bash
ssh root@116.172.96.152 'pm2 list | grep aigc-prod'
ssh root@116.172.96.152 'curl -s http://localhost:6008/health | head -c 100'
```

---

### Task 10: 验收测试

**Step 1: 验证正式环境公网可访问**

在浏览器访问：`https://u703085-b83c-f19cd560.westx.seetacloud.com:8443`

预期：登录页面正常显示。

**Step 2: 验证测试环境（SSH 隧道）**

```bash
ssh -L 3000:localhost:3000 -L 3001:localhost:3001 root@116.172.96.152 -N
```

然后浏览器访问 `http://localhost:3000`，正常显示登录页。

**Step 3: 验证自动部署（改一行代码测试）**

```bash
# 在本地 develop 分支改动任意文件
git checkout develop
echo "# test" >> README.md
git add README.md
git commit -m "test: verify auto deploy"
git push production develop
# 观察 push 后输出，等待约 2-3 分钟
ssh root@116.172.96.152 'tail -20 /root/autodl-tmp/logs/deploy-test.log'
```

**Step 4: 完成后清理**

```bash
# 回到 develop 分支继续开发
git checkout develop
git revert HEAD --no-edit
git push production develop
```

---

## 日常工作流程（完成后）

```bash
# 开发新功能
git checkout develop
# ... 写代码 ...
git commit -m "feat: xxx"
git push production develop   # → 自动部署测试环境（约2-3分钟）

# 验证测试环境OK后上线
git checkout master
git merge develop
git push production master    # → 自动部署正式环境

# 查看部署日志
ssh root@116.172.96.152 'tail -f /root/autodl-tmp/logs/deploy-prod.log'
```

---

## 注意事项

1. **`aigc-platform` 旧目录**: 服务器上原有的 `/root/autodl-tmp/aigc-platform/` 目录在新环境稳定后可以删除，迁移前保留作为参考。
2. **首次部署顺序**: .env 文件必须在 `git push` 之前就存在于服务器，否则 hook 中的 pnpm build 会因缺少环境变量而失败。本计划 Task 5 在 Task 8 之前执行确保了这一点。
3. **Redis DB 分离**: 测试用 `redis://...6379/1`，正式用 `redis://...6379/0`，通过 URL 末尾的 DB 编号区分，无需运行两个 Redis 实例。
4. **hook 异步执行**: post-receive hook 中 deploy 函数以 `&` 后台运行，push 会立即返回，部署在后台继续。用 `tail -f deploy-*.log` 查看进度。
