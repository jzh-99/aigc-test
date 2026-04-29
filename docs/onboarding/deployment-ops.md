# 部署与运维说明

本文说明当前仓库已有的部署脚本、进程管理方式和后续可以重点优化的鲁棒性方向。

## 1. 当前部署方式

当前应用服务使用 PM2 管理，配置文件：

```text
ecosystem.config.cjs
```

其中包含三个进程：

| PM2 进程 | 启动脚本 | 说明 |
| --- | --- | --- |
| `aigc-test-api` | `start-api.sh` | API 服务。 |
| `aigc-test-worker` | `start-worker.sh` | Worker 服务。 |
| `aigc-test-web` | `start-web.sh` | Web 服务。 |

日志输出到根目录 `logs/`。

## 2. 启动脚本

现有启动脚本：

```text
start-api.sh
start-worker.sh
start-web.sh
```

这些脚本会读取根目录 `.env`，然后启动对应服务。

注意：当前脚本命名和实际启动内容需要在后续运维梳理中重点核对，避免脚本名、PM2 配置和实际进程职责不一致造成排障困难。

## 3. 初始化和部署脚本

### 首次服务器初始化

```text
setup.sh
```

用于首次服务器准备，例如安装基础依赖、初始化数据库、拉取代码、安装依赖、构建和启动服务。

### 常规部署

```text
deploy.sh
```

常规部署通常包含：

- 拉取最新代码。
- 安装依赖。
- 构建项目。
- 执行数据库 migration。
- 执行 seed。
- 重启 PM2 服务。

### 本地部署式重启

```text
deploy-local.sh
```

用于本地或测试环境快速执行构建、迁移和重启流程。

## 4. PM2 常用命令

查看进程：

```bash
pm2 status
```

查看日志：

```bash
pm2 logs
```

重启所有配置中的服务：

```bash
pm2 restart ecosystem.config.cjs --update-env
```

查看单个进程日志：

```bash
pm2 logs aigc-test-api
pm2 logs aigc-test-worker
pm2 logs aigc-test-web
```

## 5. 健康检查

API 健康检查：

```bash
curl http://localhost:3001/healthz
```

实现位置：

```text
apps/api/src/routes/healthz.ts
```

当前会检查：

- Postgres
- Redis

建议后续增强：

- Worker 存活状态。
- 队列积压情况。
- 对象存储可用性。
- 外部依赖超时和错误率。
- 版本号 / commit hash。

## 6. 日志与可观测性

当前 PM2 日志位于：

```text
logs/
```

建议后续补充：

- 日志轮转，避免磁盘写满。
- 结构化日志统一字段。
- API latency、error rate、status code 统计。
- Worker job success/fail/duration 指标。
- BullMQ queue depth 指标。
- Postgres 连接数、慢查询、锁等待。
- Redis 内存、连接数、命中率、队列长度。
- 部署成功率和回滚记录。

日志脱敏要求：

- 不记录密钥。
- 不记录用户敏感内容。
- 不记录可直接访问私有资源的长期有效 URL。
- 排障需要更详细内容时，优先使用脱敏字段和短期样本。

## 7. 队列与 Worker 鲁棒性

后续可以重点完善：

- 不同任务类型拆分队列。
- Worker 并发配置文档化。
- job attempts / backoff 策略。
- dead letter queue 或失败任务池。
- 队列积压告警。
- Worker 崩溃自动恢复。
- 长任务超时处理。
- 任务幂等性检查。

这些工作可以从运维和框架层面推进；如果会改变任务业务语义或外部接口表现，建议先与内部团队对齐。

## 8. 数据库运维建议

建议逐步补齐：

- 自动备份。
- 恢复演练。
- migration 执行规范。
- 失败 migration 处理流程。
- 连接池或 PgBouncer。
- 慢查询分析。
- 热表索引优化。
- 日志表、任务表归档策略。

数据库结构设计和核心业务语义由内部团队负责；性能和运维问题欢迎提出优化建议和 PR。

## 9. 扩缩容方向

建议目标形态：

```text
Load Balancer
   |
   +-- Web 多实例
   +-- API 多实例
   +-- Worker 多实例

Postgres：备份、连接池、必要时读写分离
Redis：Sentinel / Cluster / 托管 Redis
Object Storage：S3/MinIO + CDN
```

重点原则：

- API 尽量保持无状态。
- Worker 独立扩容，不和 API 混在同一扩容策略里。
- 队列、缓存和 Pub/Sub 的 Redis 资源要有容量规划。
- SSE 连接数增长后，可以考虑拆出 realtime 服务。
- 大文件流量优先交给对象存储和 CDN。

## 10. 推荐优先级

第一阶段建议优先做：

1. 核对并修正 PM2 启动脚本和进程命名。
2. 提供可执行的测试服/正式服部署脚本。
3. 补充部署 checklist 和回滚 checklist。
4. 输出服务器连接文档和部署 runbook。
5. 接入日志轮转。
6. 增强 `/healthz`。
7. 增加基础 CI：install、build、lint、test。
8. 增加队列积压和 Worker 失败告警。

这些工作能快速提升稳定性，也尽量不影响产品和业务接口设计。具体交付物见 [新同事交付清单](./deliverables.md)。
