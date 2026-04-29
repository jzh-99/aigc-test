# 系统架构概览

本文从部署和运维视角介绍系统结构，帮助你理解服务之间如何协作。业务和生成能力可以先按黑盒依赖理解，日常工作重点放在服务可用性、扩缩容、队列、存储、数据库和监控上。

## 1. 总体拓扑

```text
用户浏览器
   |
   v
apps/web  ->  apps/api  ->  Postgres
                 |        ->  Redis
                 |        ->  Object Storage / MinIO / S3
                 |
                 v
             apps/worker
                 |
                 v
        upstream services
```

当前本地基础设施由 `docker-compose.yml` 提供：

- Postgres 15
- Redis 7
- MinIO

应用服务主要包括：

- `apps/web`：Next.js 前端。
- `apps/api`：Fastify API。
- `apps/worker`：BullMQ Worker 和后台任务。

## 2. Web 服务

路径：`apps/web`

职责：

- 提供用户界面。
- 调用 API 服务。
- 展示任务状态、资产、视频、团队、设置等页面。

协作建议：前端产品体验和 UI 设计由内部团队负责；如果部署、构建、静态资源、CDN、前端日志采集方面有优化建议，可以直接提出。

## 3. API 服务

路径：`apps/api`

职责：

- 提供 HTTP API。
- 处理认证、用户、团队、工作区、资产、视频、任务提交等业务请求。
- 提供 SSE 任务状态推送。
- 连接 Postgres、Redis、对象存储和上游服务。
- 提供健康检查。

健康检查入口：

```text
GET /healthz
```

实现位置：

```text
apps/api/src/routes/healthz.ts
```

该接口会检查 Postgres 和 Redis，正常时返回 `status: ok`，异常时返回 `status: degraded`。

## 4. Worker 服务

路径：`apps/worker`

职责：

- 消费 Redis / BullMQ 队列。
- 执行后台任务。
- 更新数据库任务状态。
- 发布任务进度事件。
- 处理转存、超时、失败恢复等流程。

当前重点队列：

| 队列 | 说明 |
| --- | --- |
| `image-queue` | 生成类任务队列。 |
| `transfer-queue` | 资产转存队列。 |

从运维角度，Worker 是后续鲁棒性建设的重点，包括：

- 多实例部署。
- 队列积压监控。
- 失败重试和 backoff。
- 超时任务处理。
- 进程崩溃恢复。
- 不同任务类型的并发隔离。

## 5. Redis 的作用

Redis 目前承担多种职责：

- BullMQ 队列 broker。
- 任务状态 Pub/Sub。
- 部分认证/会话相关缓存。
- 速率限制或短期状态存储。

后续用户量增长时，需要重点关注：

- Redis 内存使用。
- 队列积压。
- 连接数。
- Redis 单点风险。
- Sentinel / Cluster / 托管 Redis 方案。

## 6. Postgres 的作用

Postgres 是主要业务数据库。数据库相关代码主要位于：

```text
packages/db
```

常见内容：

- migration 脚本
- seed 脚本
- 数据库客户端
- 业务表结构

后续可以重点关注：

- 备份和恢复演练。
- 慢查询和索引。
- 连接池。
- migration 执行和回滚策略。
- 大日志表或任务表的归档/分区方案。

## 7. 对象存储

本地使用 MinIO，生产环境可以使用 S3 兼容存储或内部对象存储服务。

相关变量可参考 `.env.example`：

- `EXTERNAL_STORAGE_URL`
- `STORAGE_ENDPOINT`
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`
- `STORAGE_BUCKET`
- `STORAGE_PUBLIC_URL`

运维建议：

- 大文件上传下载尽量走对象存储或 CDN。
- 避免 API 服务承担大流量文件中转。
- 对象存储需要健康检查、生命周期管理和权限隔离。

## 8. 任务状态和 SSE

系统中存在长任务，例如生成、转存、视频相关处理。API 会通过 SSE 向前端推送任务状态，Redis 用于进程间事件传递。

运维关注点：

- SSE 连接数。
- API 实例连接占用。
- Redis Pub/Sub 稳定性。
- 前端断线重连体验。
- 后续是否需要独立 realtime 服务。

## 9. 上游和内部依赖

为了让部署和稳定性工作更聚焦，可以先把部分业务能力理解为上游或内部服务。日常运维只需要关注它们的接口可用性、超时、错误率和告警。

重点关注：

- 依赖服务是否有健康检查。
- 调用是否有超时配置。
- 错误率是否可观测。
- 失败时是否有重试、降级或人工处理流程。
- 联调环境是否能用 mock 替代真实依赖。

如果某个依赖的行为影响到部署、监控或稳定性，可以通过接口契约、mock、超时配置、熔断、告警和联调环境来协作解决。
