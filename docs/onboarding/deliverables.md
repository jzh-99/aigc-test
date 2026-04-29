# 新同事交付清单

这份文档明确新同事需要优先交付的内容。目标是把部署、运维和分布式协作整理成“你可以按步骤执行”的脚本、模板和文档，而不是让你必须深入处理部署细节。

## 1. 总体分工

新同事负责把部署能力工程化：

- 部署脚本
- 回滚脚本
- 健康检查脚本
- 服务器连接文档
- 环境变量模板
- 监控和告警建议
- 数据库备份和恢复脚本
- 分布式部署方案
- 第一版 CI/CD 流程

内部团队负责：

- 决定何时发布测试服和正式服。
- 执行或审批正式服部署。
- 验收产品功能和线上表现。
- 管理生产密钥、生产数据库、生产 Redis 和正式服务器权限。

## 2. 第一阶段必须交付

### 2.1 部署脚本

建议新增或改造：

```text
scripts/deploy-dev.sh
scripts/deploy-prod.sh
scripts/rollback.sh
scripts/health-check.sh
scripts/backup-db.sh
```

要求：

- 脚本可重复执行。
- 出错时停止，不继续执行后续危险步骤。
- 输出清晰，能看出当前执行到哪一步。
- 不在脚本中写死密钥、密码、生产地址。
- 正式服部署前必须有明确确认，例如输入 `DEPLOY_PROD` 才继续。
- 部署后自动执行健康检查。
- 如果部署失败，提示下一步回滚命令。

### 2.2 环境变量模板

建议准备：

```text
.env.dev.example
.env.prod.example
```

模板只放变量名、示例格式和说明，不放真实值。

至少覆盖：

```text
DATABASE_URL
REDIS_URL
WEB_BASE_URL
API_BASE_URL
STORAGE_ENDPOINT
STORAGE_BUCKET
JWT_SECRET
API_PORT
API_HOST
NODE_ENV
LOG_LEVEL
```

生产密钥由内部团队单独配置，不写入仓库。

### 2.3 服务器连接文档

建议新增：

```text
docs/ops/servers.md
```

记录服务器角色和连接方式，但不记录密码。

建议表格：

```text
服务器名称
环境：dev / staging / prod
角色：web / api / worker / db / redis / storage / monitoring
内网地址
公网入口
SSH 用户
部署路径
运行服务
端口
日志路径
健康检查地址
备份位置
备注
```

如果未来做多服务器部署，这份文档必须同步更新。

### 2.4 部署 Runbook

建议新增：

```text
docs/ops/deploy-runbook.md
```

写成非部署专家也能执行的步骤：

```text
1. 确认要发布的分支和 commit。
2. 确认测试服已验证。
3. 执行数据库备份。
4. 执行部署脚本。
5. 执行健康检查。
6. 打开 Web 页面验证。
7. 检查 API、Worker、队列、日志。
8. 如果失败，执行 rollback。
```

正式服部署步骤要比测试服更谨慎，必须包含确认和回滚说明。

### 2.5 健康检查脚本

建议脚本：

```bash
bash scripts/health-check.sh dev
bash scripts/health-check.sh prod
```

输出建议：

```text
Web: ok
API /healthz: ok
Postgres: ok
Redis: ok
Worker: ok
Queue depth: ok
Disk: ok
Memory: ok
```

第一版可以先检查 API、Postgres、Redis、PM2 进程和磁盘空间。

## 3. 第二阶段交付

### 3.1 回滚方案

需要明确：

- 如何回滚到上一个代码版本。
- 如何回滚 PM2 进程。
- 如何处理部署后 API 不健康。
- 如何处理 Worker 启动失败。
- 如何处理 migration 失败。
- 哪些 migration 不可逆，部署前必须提示。

建议 `rollback.sh` 默认只回滚代码和服务，不自动执行破坏性数据库操作。

### 3.2 日志和监控

建议交付：

- 日志轮转配置。
- API 错误率和延迟监控。
- Worker 任务成功/失败数量。
- Redis 队列积压监控。
- Postgres 连接数和慢查询建议。
- 磁盘、CPU、内存告警。
- 部署成功/失败记录。

### 3.3 CI/CD 初版

建议至少包含：

```text
pnpm install
pnpm build
pnpm lint
基础测试或 smoke test
```

如果暂时不自动部署，也要先让 PR 能自动检查构建是否通过。

### 3.4 队列监控方案

需要说明：

- 如何查看队列长度。
- 如何发现任务积压。
- 如何发现失败任务。
- 如何重启 Worker。
- 是否需要 dashboard。
- 告警阈值建议。

## 4. 分布式部署交付要求

如果后续推进多服务器部署，新同事需要提供：

```text
部署拓扑图
服务器清单
服务端口表
环境变量说明
部署顺序
回滚顺序
故障处理方式
扩容方式
数据备份方式
```

推荐第一版拓扑：

```text
开发服务器：dev / team-dev / staging-lite
正式服务器：prod 单机，先规范化部署和备份
新增 worker 服务器：独立运行 worker
后续再拆：db / redis / storage / monitoring
```

不要一开始为了“分布式”而拆得过细。第一优先级是部署可靠、可回滚、可观测。

## 5. 验收标准

每项交付都需要满足：

- 有脚本或文档入口。
- 内部团队可以照着执行。
- 不包含真实密钥。
- 有验证步骤。
- 有失败处理或回滚说明。
- 不依赖某个人口头解释。

第一阶段完成后，内部团队应该能做到：

```text
按文档部署测试服
按文档检查服务健康
按文档部署正式服
部署失败时按文档回滚
根据服务器连接文档知道每台机器跑了什么
```

## 6. 第一周建议任务

建议第一周按这个顺序推进：

1. 跑通本地环境，记录问题。
2. 核对并修正启动脚本、PM2 配置和实际进程职责。
3. 输出 `docs/ops/servers.md` 初版。
4. 输出 `docs/ops/deploy-runbook.md` 初版。
5. 提供 `scripts/health-check.sh` 初版。
6. 提供日志轮转方案。
7. 提供 CI/CD 初版方案。

第一周不追求完整分布式改造，先把当前开发服务器和正式服务器的部署流程变得可靠、清晰、可回滚。
