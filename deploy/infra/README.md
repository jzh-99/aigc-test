# 基础设施部署

提供 PostgreSQL + Redis 基础服务，供 API 和 Worker 使用。

## 快速启动

```bash
# 1. 复制环境变量
cp .env.example .env
# 编辑 .env，设置 POSTGRES_PASSWORD 等

# 2. 启动基础服务
docker compose up -d

# 3. 查看状态
docker compose ps
docker compose logs -f
```

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
