# 新同事交接说明

欢迎参与这个项目。我们希望你重点帮助团队提升服务鲁棒性、分布式部署、CI/CD、可观测性、队列稳定性、数据库和缓存运维、部署回滚与扩缩容能力。

这份资料的目标是让你尽快跑通环境、理解系统结构，并在基础设施和稳定性方向快速产出价值。涉及产品体验、业务接口语义或生成链路细节的改动，我们会在需要时一起对齐。

## 推荐阅读顺序

1. [本地开发环境](./local-setup.md)
2. [系统架构概览](./architecture.md)
3. [新同事交付清单](./deliverables.md)
4. [部署与运维说明](./deployment-ops.md)
5. [协作范围与边界](./scope-and-boundaries.md)
6. [内部 6008 模拟环境](./internal-6008-simulation.md)

## 仓库结构速览

| 路径 | 说明 |
| --- | --- |
| `apps/api` | Fastify API 服务，负责业务 API、任务提交、SSE、健康检查等。 |
| `apps/web` | Next.js 前端应用。 |
| `apps/worker` | BullMQ Worker 和后台任务。 |
| `packages/db` | 数据库客户端、迁移脚本、种子数据。 |
| `packages/types` | 前后端共享 TypeScript 类型。 |
| `docker-compose.yml` | 本地 Postgres、Redis、MinIO 依赖。 |
| `ecosystem.config.cjs` | PM2 进程配置。 |
| `setup.sh` / `deploy.sh` | 服务器初始化和常规部署脚本。 |

## 重点协作方向

欢迎优先关注这些问题：

- 把部署流程整理成我们可以直接执行的脚本和 runbook。
- 本地开发环境是否足够顺畅。
- 部署脚本是否可重复、可回滚、可观测。
- API、Worker、Web 是否能独立部署和扩容。
- Redis / BullMQ 队列是否有积压监控、失败重试和告警。
- Postgres 是否有备份、恢复、连接池和慢查询治理方案。
- 日志、metrics、health check 是否能支撑排障。
- CI/CD 是否能覆盖构建、测试、部署、回滚流程。

## 协作原则

- 基础设施、部署、监控、CI/CD、稳定性优化可以直接提出方案或 PR。
- 如果改动会影响业务接口语义或线上用户流程，建议先和内部团队沟通。
- 文档、脚本、监控和 runbook 的补充非常欢迎，这些能直接提升团队协作效率。
- 日志和监控默认按脱敏原则处理，不记录密钥或用户敏感内容。
