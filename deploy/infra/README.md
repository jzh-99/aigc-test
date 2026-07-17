# 基础设施部署

提供 PostgreSQL + Redis 基础服务，供 API 和 Worker 使用。

> ⚠️ **基础设施服务器无法访问 Docker Hub（离线环境）**，所有镜像必须在本机拉取打包，通过跳板机传输后在服务器侧 `docker load`。

## 部署清单

| 步骤 | 在哪 | 命令 | 是否必须 | 是否每次部署都要做 |
|------|------|------|----------|----------------------|
| 0. 离线镜像准备 | **本机** | `bash deploy/build-images.sh infra` | ✅ 必须 | 仅官方镜像升级时 |
| 1. 传输文件到服务器 | 跳板机 | `scp deploy/dist/*.tar.gz` + `deploy/infra/` | ✅ 必须 | 文件变化时 |
| 2. 宿主机初始化（swap） | **服务器** | `sudo bash setup-host.sh` | ✅ 必须 | ❌ 仅首次 |
| 3. 加载镜像 | **服务器** | `docker load < postgres.tar.gz` 等 | ✅ 必须 | 镜像变化时 |
| 4. 配置环境变量 | **服务器** | `cp .env.example .env && vi .env` | ✅ 必须 | 仅变量变化时 |
| 5. 启动/重建容器 | **服务器** | `docker compose up -d --force-recreate` | ✅ 必须 | ✅ 每次 |

> **swap 为什么不能在容器里做？** swap 是宿主机内核级配置，容器（即使 `--privileged`）没有 `swapon` / `mkswap` 权限，必须由运维在宿主机执行一次。`setup-host.sh` 是幂等的，重复执行无副作用。

## 完整部署流程（离线环境）

### 第 0 步：本机准备离线镜像（一次性）

```bash
# 在开发机（Windows）执行，需要能访问 Docker Hub
cd D:/haobai/aigc-test
bash deploy/build-images.sh infra
# 产物：
#   deploy/dist/postgres.tar.gz   （postgres:16-alpine）
#   deploy/dist/redis.tar.gz      （redis:7-alpine）
ls -lh deploy/dist/
```

> **官方镜像升级时才需要重跑此步**。比如 PG 16.3 → 16.4，或 Redis 7.2 → 7.4，重新执行命令打包即可。

### 第 1 步：传输到服务器

需要传输的文件清单：

```
deploy/dist/postgres.tar.gz         ← 离线镜像
deploy/dist/redis.tar.gz            ← 离线镜像
deploy/infra/docker-compose.yml     ← 部署编排
deploy/infra/.env.example           ← 环境变量模板
deploy/infra/setup-host.sh          ← 宿主机初始化脚本
deploy/infra/README.md              ← 本文档
```

通过跳板机 scp 到基础设施服务器（参考团队既有的文件传输流程）。

### 第 2 步：宿主机初始化（仅首次）

```bash
cd ~/deploy/infra
sudo bash setup-host.sh
#    校验：free -h 应看到 Swap 不为 0
```

### 第 3 步：加载离线镜像

```bash
cd ~/deploy
docker load < postgres.tar.gz
docker load < redis.tar.gz

# 校验镜像已加载
docker images | grep -E 'postgres|redis'
# 预期：
#   postgres   16-alpine   xxx   xxxMB
#   redis      7-alpine    xxx   xxxMB
```

### 第 4 步：配置环境变量

```bash
cd ~/deploy/infra
cp .env.example .env
vi .env
#    必填：POSTGRES_PASSWORD（强密码！）
#    可选：PG_* 和 REDIS_*（不填用 docker-compose.yml 默认值）
```

### 第 5 步：启动容器

```bash
cd ~/deploy/infra
docker compose up -d
```

### 第 6 步：校验

```bash
docker compose ps
docker exec -it aigc-postgres psql -U aigc -d aigc_dev -c \
  "SHOW shared_buffers; SHOW work_mem; SHOW maintenance_work_mem; SHOW effective_cache_size; SHOW max_connections;"
# 预期：1GB / 16MB / 256MB / 3GB / 80

docker stats --no-stream
free -h
```

## 重建容器（已有 swap、镜像、.env 的情况）

```bash
# 拉取新的 docker-compose.yml / .env.example 后：
cd ~/deploy/infra
docker compose up -d --force-recreate
# swap 不受影响（已在宿主机持久化）
```

## 升级官方镜像（如 PG 16 → 17）

1. 本机修改 `deploy/infra/docker-compose.yml` 中 `image:` tag
2. 本机执行 `bash deploy/build-images.sh infra` 重新打包
3. 传新的 tar 包 + docker-compose.yml 到服务器
4. 服务器执行：
   ```bash
   docker load < postgres.tar.gz
   cd ~/deploy/infra
   docker compose up -d --force-recreate
   # 如需保留旧镜像做回滚：docker tag postgres:16-alpine postgres:16-alpine-backup
   ```

## 宿主机初始化脚本

`setup-host.sh` 负责创建 swap、设置 swappiness、持久化到 `/etc/fstab`。

```bash
# 检查当前状态（不修改任何内容）
sudo bash setup-host.sh --check

# 默认创建 2GB swap
sudo bash setup-host.sh

# 自定义 swap 大小
sudo bash setup-host.sh 4G
```

特点：
- **幂等**：已存在 swap / fstab 条目 / swappiness 配置时自动跳过，重复执行无副作用
- **持久化**：写入 `/etc/fstab` 和 `/etc/sysctl.conf`，宿主机重启自动生效
- **仅首次需要**：后续重建容器（`docker compose up -d --force-recreate`）完全不影响 swap

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5432 | 数据库 |
| Redis | 6379 | 缓存/队列 |

## 对象存储配置

**本项目使用火山引擎 TOS 作为对象存储方案。**

需在 API 和 Worker 服务器的 `.env` 中配置：

```bash
TOS_ACCESS_KEY_ID=<火山 TOS AccessKey>
TOS_SECRET_ACCESS_KEY=<火山 TOS SecretKey>
TOS_REGION=cn-shanghai
TOS_ENDPOINT=https://tos-cn-shanghai.volces.com
TOS_BUCKET=toby-ai-prod
TOS_PUBLIC_URL=https://toby-ai-prod.tos-cn-shanghai.volces.com
```

**说明**：
- 生产环境使用云存储保证高可用性和 CDN 加速
- 开发环境也建议使用 TOS（避免本地存储数据丢失）

## 注意事项

- 生产环境务必修改默认密码
- PostgreSQL 数据持久化在 `postgres_data` volume
- Redis 开启 AOF 持久化
- 防火墙只对 API/Worker 服务器开放 5432/6379 端口

## 内存调优（重要）

PostgreSQL 默认配置（`shared_buffers=128MB`、`work_mem=4MB`）在 `credits_ledger`
等流水表上做聚合时会触发 `out of memory`（错误码 `53200`，报错内存上下文为
`CachedPlanSource` / `MessageContext`），导致所有接口连锁返回 500。

`docker-compose.yml` 已通过 `command:` 覆盖默认参数，可通过 `.env` 调整：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PG_SHARED_BUFFERS` | `1GB` | 共享缓冲池，约为物理内存的 1/4 |
| `PG_WORK_MEM` | `16MB` | 单个排序/哈希操作的内存，每个 backend × 每个操作单独分配 |
| `PG_MAINTENANCE_WORK_MEM` | `256MB` | VACUUM / CREATE INDEX 使用的内存 |
| `PG_EFFECTIVE_CACHE_SIZE` | `3GB` | 告诉规划器操作系统缓存大小，影响 JOIN 策略选择 |
| `PG_MAX_CONNECTIONS` | `80` | 最大连接数，需 ≥ 所有应用容器 `PG_POOL_MAX` 之和 × 1.5 |
| `PG_CONTAINER_MEMORY_LIMIT` | `3g` | 容器内存硬上限，防 OOM Killer 残及整个宿主机 |
| `REDIS_MAXMEMORY` | `512mb` | Redis 数据集上限，超限时按 LRU 淘汰 |
| `REDIS_MAXMEMORY_POLICY` | `allkeys-lru` | BullMQ 队列场景建议保持 `allkeys-lru` |

### 按宿主机物理内存选取参数

| 物理内存 | `PG_SHARED_BUFFERS` | `PG_WORK_MEM` | `PG_MAINTENANCE_WORK_MEM` | `PG_EFFECTIVE_CACHE_SIZE` | `PG_MAX_CONNECTIONS` | `PG_CONTAINER_MEMORY_LIMIT` |
|----------|---------------------|---------------|---------------------------|---------------------------|----------------------|------------------------------|
| 4 GB     | `512MB`             | `8MB`         | `128MB`                   | `1536MB`                  | `80`                 | `2g`                         |
| **8 GB（默认）** | **`1GB`**    | **`16MB`**    | **`256MB`**               | **`3GB`**                 | **`80`**             | **`3g`**                     |
| 16 GB    | `2GB`               | `32MB`        | `512MB`                   | `8GB`                     | `150`                | `8g`                         |

> 修改 `.env` 后需重建容器：`docker compose up -d --force-recreate`

### 应用侧连接数配合

`PG_MAX_CONNECTIONS` 必须 ≥ 所有应用容器 `PG_POOL_MAX` 之和 × 1.5（预留 psql 运维连接）。

例如：1 台 API 容器（`PG_POOL_MAX=20`）+ 1 台 Worker 容器（`PG_POOL_MAX=10`）= 30，
则 `PG_MAX_CONNECTIONS` 至少设为 `45`，默认 `80` 足够。

### 校验

部署后登录 PostgreSQL 执行：

```sql
SHOW shared_buffers;
SHOW work_mem;
SHOW max_connections;
-- 看实际连接占用
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```
