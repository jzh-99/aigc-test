# 部署指南

## 环境变量说明

**deploy/ 的环境变量与根目录 .env.example 有所不同**，这是为了适应不同的部署模式：

| 配置项 | 根目录（开发环境） | deploy/（生产环境） | 原因 |
|--------|-------------------|-------------------|------|
| **数据库连接** | `DATABASE_URL`（完整 URL） | `INFRA_HOST` + `POSTGRES_*`（拆分） | 生产环境多台服务器，拆分后只需修改 `INFRA_HOST` 即可切换基础设施 |
| **Redis 连接** | `REDIS_URL`（完整 URL） | `INFRA_HOST` + `REDIS_PORT/PASSWORD`（拆分） | 同上 |
| **服务间通信** | localhost | 各服务器 IP/域名 | 开发单机，生产分布式 |

**示例对比**：

```bash
# 开发环境（根目录 .env）
DATABASE_URL=postgresql://aigc:aigcpass@localhost:5432/aigc_dev
REDIS_URL=redis://localhost:6379/1

# 生产环境（deploy/api/.env）
INFRA_HOST=192.168.1.100
POSTGRES_USER=aigc
POSTGRES_PASSWORD=strong-password
POSTGRES_DB=aigc_dev
POSTGRES_PORT=5432
REDIS_PORT=6379
REDIS_PASSWORD=
# docker-compose.yml 自动拼接为：postgresql://aigc:strong-password@192.168.1.100:5432/aigc_dev
```

**为什么不统一？**
- 开发环境单机运行，完整 URL 更直观，开发者体验更好
- 生产环境多台服务器，拆分配置更灵活，切换基础设施只需改一个 `INFRA_HOST`
- 两种模式各自优化了对应场景的配置复杂度

---

## 架构概述

四台独立服务器，各自运行独立的 `docker-compose.yml`：

| 服务器 | 内容 | 关键端口 | 配置目录 |
|--------|------|----------|----------|
| 基础设施服务器 | PostgreSQL + Redis | 5432 / 6379 | `deploy/infra/` |
| API 服务器 | `aigc-api` 容器 | 7001 | `deploy/api/` |
| Web 服务器 | `aigc-web` 容器 | 6006 | `deploy/web/` |
| Worker 服务器 | `aigc-worker` 容器（无 HTTP 端口） | — | `deploy/worker/` |

---

## 本机操作：构建镜像

在 monorepo 根目录执行：

```bash
# 构建全部镜像
bash deploy/build-images.sh all

# 或单独构建某个服务
bash deploy/build-images.sh api
bash deploy/build-images.sh web
bash deploy/build-images.sh worker
```

产物输出到 `deploy/dist/`：
- `aigc-api.tar.gz`
- `aigc-web.tar.gz`
- `aigc-worker.tar.gz`

---

## 服务器侧操作（通过跳板机手动执行）

### 部署顺序：infra → api → worker → web

---

### 1. 基础设施服务器（只用官方镜像，无需 docker load）

```bash
# 本机执行
cd D:/haobai/aigc-test
bash deploy/build-images.sh infra
# 产出 deploy/dist/postgres.tar.gz、deploy/dist/redis.tar.gz

# 服务器优化
# 在基础设施服务器执行（root 权限）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10                              # 优先用物理内存
free -h                                                    # 校验 Swap 不再是 0

# 服务器执行
cd deploy/infra/
cp .env.example .env
vi .env  # 填写数据库密码、Redis 密码

cd ~/deploy

# 加载镜像（首次必须做）
docker load < postgres.tar.gz
docker load < redis.tar.gz
docker images | grep -E 'postgres|redis'   # 校验

# 配置 .env
cd infra
cp .env.example .env
vi .env                                     # 必填 POSTGRES_PASSWORD

# 启动（首次 up）
docker compose up -d

# 校验
docker compose ps
docker exec -it aigc-postgres psql -U aigc -d aigc_dev -c \
  "SHOW shared_buffers; SHOW work_mem; SHOW maintenance_work_mem; SHOW effective_cache_size; SHOW max_connections;"
# 预期：1GB / 16MB / 256MB / 3GB / 80

docker compose up -d
```

**环境变量说明**：
- `POSTGRES_PASSWORD`：必填，数据库密码
- `REDIS_PASSWORD`：可选，Redis 密码（留空则不设密码）

---

### 2. API 服务器

```bash
cd deploy/api/

# 加载镜像
docker load < aigc-api.tar.gz

# 配置环境变量
cp .env.example .env
cp prompts.env.example prompts.env
vi .env          # 填写 INFRA_HOST、数据库密码、TOS 密钥等
vi prompts.env   # 填写 AI system prompts

# 创建日志目录
mkdir -p logs

# 启动容器
docker compose up -d

# 强制重新启动容器
docker compose up -d --build --force-recreate

# 查看日志
docker logs aigc-api --tail 50 -f

# 结构迁移
# 在 API 服务器 /home/vmuser/projects/aigc-api 下执行：
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/migrate.ts'

# 数据迁移
# 执行 seed：
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/seed.ts'
```

**关键环境变量**：
- `INFRA_HOST`：基础设施服务器 IP
- `POSTGRES_PASSWORD`：与基础设施服务器一致
- `CORS_ORIGIN`：前端地址（如有域名必须填域名，HTTPS 必须写 https://）
- `TOS_*`：火山引擎对象存储配置
- `prompts.env`：AI system prompts（必须配置，否则 AI 功能不可用）

**首次部署需执行数据库迁移**（在能访问基础设施服务器的机器上）：
```bash
DATABASE_URL=postgresql://aigc:<password>@<INFRA_IP>:5432/aigc_dev pnpm db:migrate
```

---

### 3. Worker 服务器

```bash
cd deploy/worker/

docker load < aigc-worker.tar.gz

cp .env.example .env
cp prompts.env.example prompts.env
vi .env
vi prompts.env

mkdir -p logs

docker compose up -d
docker logs aigc-worker --tail 50 -f
```

**关键环境变量**：
- 与 API 基本一致（`INFRA_HOST`、数据库、Redis、TOS）
- `JWT_SECRET`：必须与 API 保持一致
- `AVATAR_UPLOAD_BASE_URL` / `AI_UPLOAD_BASE_URL`：填写 API 服务器公网地址

---

### 4. Web 服务器

```bash
cd deploy/web/

docker load < aigc-web.tar.gz

cp .env.example .env
vi .env

docker compose up -d
docker logs aigc-web --tail 50 -f
```

**关键环境变量**：
- `API_HOST`：API 服务器 IP（服务端 SSR/代理用）
- `NEXT_PUBLIC_STORAGE_HOST`：**火山 TOS 的公网域名**（如 `toby-ai-prod.tos-cn-shanghai.volces.com`）
  - 该值会打包进客户端 bundle，必须是浏览器可访问的地址
- `NEXT_PUBLIC_STORAGE_PORT`：TOS 用 `443`（HTTPS）

---

## 重新部署（更新代码后）

```bash
# 本机构建新镜像
bash deploy/build-images.sh all

# 传输到对应服务器后
docker load < aigc-<service>.tar.gz
docker compose up -d --force-recreate  # 强制重新创建容器
docker logs aigc-<service> --tail 30
```

---

## 健康检查

```bash
# API
curl http://<API_IP>:7001/healthz

# Web
curl http://<WEB_IP>:6006/

# Worker（无 HTTP 端口，检查进程）
docker exec aigc-worker pgrep -f 'node apps/worker'

# 基础设施
docker ps  # 检查 postgres、redis 是否 healthy
```

---

## 常见问题

### 1. Web 前端图片/视频无法加载
- 检查 `NEXT_PUBLIC_STORAGE_HOST` 是否填写了正确的 TOS 公网域名
- 检查浏览器控制台是否有 CORS 错误
- 检查 TOS bucket 是否设置了公开读权限

### 2. API CORS 错误
- 检查 `deploy/api/.env` 中的 `CORS_ORIGIN` 是否与前端地址一致
- HTTPS 部署必须写 `https://`，不能写 `http://`

### 3. AI 功能不可用
- 检查 `prompts.env` 是否填写
- 检查 `docker-compose.yml` 是否加载了 `prompts.env`
- 检查 AI 服务商 API 密钥是否正确

### 4. Worker 任务不执行
- 检查 Redis 连接是否正常
- 检查 `JWT_SECRET` 是否与 API 一致
- 检查 `docker logs aigc-worker` 是否有错误

### 5. sharp 模块错误（API 容器）
- Dockerfile 已配置 `npm rebuild sharp`
- 如仍有问题，检查 Alpine 是否安装了 `vips-dev`

---

## 防火墙配置

- **基础设施服务器**：5432/6379 端口只对 API/Worker 服务器 IP 开放，不要暴露公网
- **API 服务器**：7001 端口对 Web 服务器和管理员 IP 开放
- **Web 服务器**：6006 端口对公网开放（或通过 Nginx 反向代理）
- **Worker 服务器**：无需开放端口

---

## 日志查看

```bash
# 实时日志
docker logs aigc-<service> -f

# 最近 100 行
docker logs aigc-<service> --tail 100

# 持久化日志（挂载在宿主机）
# API: deploy/api/logs/
# Worker: deploy/worker/logs/
```

---

## BullMQ 队列缓存清理

完成和失败的 BullMQ job 只是队列执行记录，不是业务历史数据；业务历史以数据库记录为准。需要手动释放 Redis 历史缓存时，在 Worker 服务器执行：

```bash
cd deploy/worker/

# 先预览各队列 completed/failed 数量，不删除
sh clean-bullmq-cache.sh --dry-run

# 清理所有默认队列的 completed/failed
sh clean-bullmq-cache.sh

# 只清理某个队列或某种状态
sh clean-bullmq-cache.sh --queue image-queue --state failed
```

默认只清理 `completed` 和 `failed`，不会清理等待中、执行中、延迟中和定时调度任务。

---

## 本地开发环境

本地开发使用根目录的 `docker-compose.yml`，它只包含 PostgreSQL + Redis：

```bash
# 根目录启动基础设施
docker compose up -d

# 启动应用
pnpm dev
```

**对象存储配置**：
- 本地开发也使用火山引擎 TOS
- 需在根目录 `.env` 中配置 `TOS_*` 环境变量
- 建议开发和生产使用不同的 bucket（如 `toby-ai-dev` 和 `toby-ai-prod`）

本地开发时：
- Web 访问 `http://localhost:6006`
- API 访问 `http://localhost:7001`


## 部署步骤
1. 登录跳板机
2. 部署服务(api服务为例，其它基本相同)
```
# 本地打包api服务
# 项目根目录执行打包命令
bash deploy/build-images.sh api
bash deploy/build-images.sh web
bash deploy/build-images.sh worker

# 构建后的地址在 项目根目录/deploy/dist/aigc-xxx.tar.gz

# ssh连接 api/worker 服务器
ssh vmuser@177.11.219.44

# ssh连接 web 服务器
ssh vmuser@177.11.219.45
# 键入密码后进入服务器

# api 项目地址
/home/vmuser/projects/aigc-api

## 进入项目文件夹(注意修改对应的镜像名称 api/worker/web)
1. 删除旧aigc-api.tar.gz 
rm -rf aigc-api.tar.gz 
2. 上传新构建的包
rz -bey
3. 修改.env环境变量（有修改的话）
4. 镜像加载
docker load < aigc-api.tar.gz
5. 镜像强制重新构建（web服务器docker版本问题执行docker-compose up -d --build --force-recreate）
docker compose up -d --build --force-recreate
6. 数据迁移 （只有api需要执行）
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/migrate.ts'
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/seed.ts'
6. 完成
```