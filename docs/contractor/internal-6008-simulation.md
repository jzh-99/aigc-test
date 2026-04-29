# 内部 6008 模拟环境

这份文档用于我们内部在当前服务器上准备一个轻量的 `team-dev` 模拟环境。它用于提前验证交接资料、本地启动流程、部署脚本和端口配置，不是给新同事长期开发使用的环境。

新同事入职后仍建议使用他自己的本地机器或独立服务器开发，通过 GitHub PR 协作。6008 环境只作为我们内部预演和必要时的联调预览入口。

## 1. 目标

- 在当前服务器新建一个空白测试目录。
- 使用独立 `.env`。
- Web 使用 `6008` 端口，走平台映射地址访问。
- API、数据库、Redis 尽量与当前 6006 测试环境隔离。
- 用它预先跑一遍 `docs/contractor/local-setup.md`，发现并修复交接流程中的问题。

## 2. 建议目录

```text
/root/autodl-tmp/aigc-team-dev-sim
```

可以从当前仓库重新 clone，或复制一份干净工作区。不要直接在现有 6006 环境目录里做模拟。

## 3. 端口规划

| 服务 | 建议端口 | 说明 |
| --- | --- | --- |
| Web | `6008` | 用于平台公网映射访问。 |
| API | `3011` | 避免和当前 API 端口冲突。 |
| Postgres | 独立库名 | 可共用 Postgres 实例，但不要共用数据库。 |
| Redis | 独立 DB 或独立实例 | 避免 worker 消费到当前环境任务。 |
| MinIO / Storage | 独立 bucket | 避免混用文件。 |

6008 映射地址由当前实例平台提供，用于浏览器预览 Web 服务。

## 4. `.env` 建议

在模拟目录中：

```bash
cp .env.example .env
```

建议调整：

```env
API_PORT=3011
WEB_BASE_URL=http://localhost:6008
API_BASE_URL=http://localhost:3011
DATABASE_URL=postgresql://aigc:aigcpass@localhost:5432/aigc_team_dev_sim
REDIS_URL=redis://localhost:6379/2
STORAGE_BUCKET=aigc-team-dev-sim
```

AI Provider、支付、生产对象存储等真实密钥不要放入这个环境。需要联调时优先使用 mock 或内部提供的临时测试配置。

## 5. 数据库隔离

建议创建独立数据库：

```bash
createdb aigc_team_dev_sim
```

如果本机数据库用户不同，请按实际 Postgres 用户调整。然后在模拟目录执行：

```bash
pnpm db:migrate
pnpm db:seed
```

## 6. Redis 隔离

如果暂时共用本机 Redis，至少使用独立 Redis DB，例如：

```env
REDIS_URL=redis://localhost:6379/2
```

更稳妥的方式是用单独 Docker Compose project 启动一套 Redis，避免队列和 Pub/Sub 与当前环境交叉。

## 7. 启动 Web 到 6008

如果使用现有 `start-web.sh`，需要为模拟环境准备单独脚本或临时命令，避免影响当前 6006：

```bash
cd apps/web
npx next start -p 6008
```

如果需要 dev 模式，请使用 `apps/web/package.json` 中的 dev 命令，并确保端口设置为 `6008`。

## 8. 内部验收清单

- [ ] 模拟目录与当前 6006 环境分离。
- [ ] `.env` 未包含生产密钥。
- [ ] Web 使用 `6008`。
- [ ] API 使用独立端口，例如 `3011`。
- [ ] 数据库使用独立库名。
- [ ] Redis 使用独立 DB 或独立实例。
- [ ] `pnpm install` 成功。
- [ ] `pnpm db:migrate` 成功。
- [ ] `pnpm db:seed` 成功。
- [ ] `GET /healthz` 正常。
- [ ] 浏览器可通过 6008 映射地址访问 Web。

## 9. 和新同事的关系

这个环境的用途是我们内部提前预演，不是新同事的主要开发方式。

正式协作建议：

- 新同事在自己的本地机器或独立服务器开发。
- 所有改动通过 GitHub PR 提交。
- 6008 环境可作为我们内部复现、验收或演示用的轻量环境。
- 如果后续需要给新同事远程环境，应单独准备 `team-dev`，不要直接共享当前 6006 或生产环境。
