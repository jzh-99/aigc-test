# 本地开发环境

这份文档用于帮助你在本地跑通基础开发环境。第一目标是让 API、Worker、Web 和本地依赖服务能够启动，并能通过健康检查。

## 1. 前置要求

请先安装：

- Node.js `>=20.0.0`
- pnpm，推荐使用仓库声明的 `10.31.0`
- Docker / Docker Compose

如果本机没有 pnpm，可以使用 Corepack：

```bash
corepack enable
corepack prepare pnpm@10.31.0 --activate
```

## 2. 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

根目录 `package.json` 使用 pnpm workspace 和 Turborepo 管理多个 app/package。

## 3. 启动本地依赖服务

```bash
docker compose up -d
```

这会启动：

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| Postgres 15 | `5432` | 本地业务数据库。 |
| Redis 7 | `6379` | BullMQ 队列、缓存、Pub/Sub。 |
| MinIO | `9000` / `9001` | S3 兼容对象存储；`9001` 是控制台。 |

MinIO 本地默认账号来自 `docker-compose.yml`：`minioadmin` / `minioadmin`。

## 4. 准备环境变量

```bash
cp .env.example .env
```

本地开发通常需要先关注这些变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 本地 Postgres 连接串。 |
| `REDIS_URL` | 本地 Redis 连接串。 |
| `JWT_SECRET` | 本地 JWT 签名密钥，可使用开发环境随机值。 |
| `API_PORT` | API 端口，默认 `3001`。 |
| `API_HOST` | API 监听地址，默认 `0.0.0.0`。 |
| `STORAGE_ENDPOINT` / `STORAGE_BUCKET` 等 | 本地 MinIO / S3 兼容存储配置。 |

AI Provider、火山引擎、支付平台等变量由内部团队管理。普通本地部署、运维和稳定性开发可以先使用 mock 或留空，不需要真实生产密钥。

不要提交 `.env`。

## 5. 初始化数据库

执行迁移和种子数据：

```bash
pnpm db:migrate
pnpm db:seed
```

对应实现：

- `packages/db/scripts/migrate.ts`
- `packages/db/scripts/seed.ts`

如果迁移失败，优先检查 `DATABASE_URL` 是否指向本地 Postgres，以及 Docker 服务是否健康。

## 6. 启动服务

可以在三个终端分别启动：

```bash
bash start-api.sh
```

```bash
bash start-worker.sh
```

```bash
bash start-web.sh
```

当前启动脚本会读取根目录 `.env`。Web 的生产式启动脚本使用 `next start -p 6006`，需要先完成构建；日常前端开发也可以根据 `apps/web/package.json` 使用对应 dev 命令。

## 7. 健康检查

API 启动后执行：

```bash
curl http://localhost:3001/healthz
```

Postgres 和 Redis 正常时，返回类似：

```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok"
}
```

如果返回 `degraded`，通常表示数据库或 Redis 连接异常。

## 8. 测试说明

当前仓库已有 Playwright E2E 配置：

- `apps/web/playwright.config.ts`
- `apps/web/e2e/`

可以从前端测试入手验证主要页面和基础流程。当前自动化测试覆盖还不完整，补充 CI/CD、冒烟测试、部署后健康检查，是非常适合推进的稳定性工作。

## 9. 本地验收清单

请优先确保以下项目可以跑通：

- [ ] `pnpm install` 成功。
- [ ] `docker compose up -d` 后 Postgres、Redis、MinIO 健康。
- [ ] `.env` 已基于 `.env.example` 准备。
- [ ] `pnpm db:migrate` 成功。
- [ ] `pnpm db:seed` 成功。
- [ ] API 服务可启动。
- [ ] Worker 服务可启动。
- [ ] Web 服务可启动。
- [ ] `GET /healthz` 返回健康状态。
- [ ] 记录启动过程中遇到的坑，并通过文档或 PR 帮团队补齐。
