# Nacos 配置中心部署

集中管理 AI 提供商的运行时参数（API key / endpoint / model id 等），支持热更：在控制台改配置后秒级推送到 api/worker，**免重启、免重新打包镜像**。

> ⚠️ **离线环境**：本机拉取打包镜像，通过跳板机传输后在服务器侧 `docker load`。

## 部署清单

| 步骤 | 在哪 | 命令 | 是否必须 | 是否每次部署都要做 |
|------|------|------|----------|----------------------|
| 0. 离线镜像准备 | **本机** | `docker pull nacos/nacos-server:v2.3.2 && docker save ...` | ✅ 必须 | 仅镜像升级时 |
| 1. 传输文件到服务器 | 跳板机 | `scp deploy/dist/nacos.tar.gz` + `deploy/nacos/` | ✅ 必须 | 文件变化时 |
| 2. 加载镜像 | **服务器** | `docker load < nacos.tar.gz` | ✅ 必须 | 镜像变化时 |
| 3. 配置环境变量 | **服务器** | `cp .env.example .env && vi .env` | ✅ 必须 | 仅变量变化时 |
| 4. 启动/重建容器 | **服务器** | `docker compose up -d --force-recreate` | ✅ 必须 | ✅ 每次 |
| 5. 初始化控制台 | **浏览器** | 改密码、建 namespace、建配置 | ✅ 必须 | ❌ 仅首次 |

## 完整部署流程（离线环境）

### 第 0 步：本机准备离线镜像（一次性）

```bash
# 在开发机（能访问 Docker Hub）执行
docker pull nacos/nacos-server:v2.3.2
docker save nacos/nacos-server:v2.3.2 -o deploy/dist/nacos.tar.gz
ls -lh deploy/dist/nacos.tar.gz
```

### 第 1 步：传输到服务器

需要传输的文件：

```
deploy/dist/nacos.tar.gz            ← 离线镜像
deploy/nacos/docker-compose.yml     ← 部署编排
deploy/nacos/.env.example           ← 环境变量模板
deploy/nacos/README.md              ← 本文档
```

通过跳板机 scp 到独立的配置服务器。

### 第 2 步：服务器侧加载镜像

```bash
docker load < nacos.tar.gz
docker images | grep nacos   # 确认加载成功
```

### 第 3 步：配置环境变量

```bash
cp .env.example .env
vi .env
```

必填项：
- `NACOS_AUTH_TOKEN`：至少 32 字符的 Base64 串。生成：`openssl rand -base64 48`
- `NACOS_AUTH_IDENTITY_VALUE`：随机字符串。生成：`openssl rand -hex 16`

### 第 4 步：启动容器

```bash
docker compose up -d --force-recreate
docker logs aigc-nacos --tail 50    # 确认启动成功（看到 "Nacos started successfully"）

# 验证健康检查
curl http://localhost:8848/nacos/v1/console/health/readiness
```

启动约需 20-30 秒（Derby 初始化）。

### 第 5 步：控制台初始化（仅首次）

1. 浏览器打开 `http://<配置服务器IP>:8848/nacos`
2. 默认账号 `nacos / nacos` 登录 → **立即修改为强密码**
3. 「命名空间」→ 新建 3 个：`dev`、`staging`、`production`（记录各自命名空间 ID）
4. 「权限控制」→ 给 production 命名空间的写权限只分配给少数运维人员

---

## 在 Nacos 中创建 AI 配置

所有 AI 相关配置归到 **Group = `AI_GROUP`**，按提供商拆分 DataID（与 `packages/nacos-config/src/index.ts` 的 `AI_CONFIG_DATA_IDS` 一一对应）：

| DataID | 内容 |
|--------|------|
| `ai-providers-doubao.properties` | DOUBAO_API_URL / DOUBAO_API_KEY / DOUBAO_MODEL / DOUBAO_NEWS_MODEL / DOUBAO_TEXT_MODEL / DOUBAO_STORYBOOK_POLISH_MODEL / DOUBAO_STORYBOOK_IMAGE_MODEL / AI_CHAT_PROVIDER |
| `ai-providers-volcengine.properties` | VOLCENGINE_API_URL / VOLCENGINE_API_KEY / VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY |
| `ai-providers-ctyun.properties` | CTYUN_EDGE_API_BASE_URL / CTYUN_EDGE_API_KEY |
| `ai-providers-tokenbus.properties` | TOKENBUS_API_BASE_URL / TOKENBUS_API_KEY |
| `ai-providers-nano-banana.properties` | NANO_BANANA_API_URL / NANO_BANANA_API_KEY / NANO_BANANA_MODEL |
| `ai-providers-qwen.properties` | QWEN_API_URL / QWEN_API_KEY / QWEN_MODEL |
| `ai-providers-minimax.properties` | MINIMAX_API_KEY（必填）/ MINIMAX_GROUP_ID（可选）/ MINIMAX_TTS_TIMEOUT_MS |
| `ai-providers-mureka.properties` | MUREKA_API_KEY / MUREKA_API_URL（注：音色克隆积分 `music_voice_clone` 属计费体系，走 DB `system_cost_configs`，不放这里） |
| `ai-providers-podcast.properties` | PODCAST_WS_URL / PODCAST_APP_ID / PODCAST_ACCESS_KEY / PODCAST_RESOURCE_ID / PODCAST_APP_KEY / PODCAST_TIMEOUT_SECONDS |
| `system.properties` | 系统级参数（跨供应商）：图片超时链（VOLCENGINE_IMAGE_TIMEOUT_MS / TOKENBUS_IMAGE_TIMEOUT_MS / CTYUN_EDGE_IMAGE_TIMEOUT_MS / IMAGE_ADAPTER_TIMEOUT_MS / IMAGE_GUARDIAN_TIMEOUT_MS）、视频（VIDEO_POLL_CONCURRENCY / VIDEO_POLL_REQUEST_TIMEOUT_MS / MAX_VIDEO_AGE_MS）、资讯绘本超时（NEWS_GENERATE_TIMEOUT_MS / GROUP_IMAGE_TIMEOUT_MS / POLISH_TIMEOUT_MS）、各场景 max_tokens。注意：系统级参数有默认值，留空用代码默认。 |

**格式**：properties（`KEY=VALUE`，每行一条，`#` 开头为注释）。

> 💡 **不想手敲？** `deploy/nacos/configs/` 提供了 9 个配置模板 + 一键导入脚本：
> - `*.properties.example`（进 git 的留空模板）：复制为 `*.properties` 后填真实值
> - `*.properties`（被 `.gitignore` 忽略）：填了真实 key 的本地文件，防止密钥入库
> - `import-to-nacos.sh`：改完真实值后执行，批量发布到 Nacos，详见该目录的 README

创建步骤（手动）：
1. 「配置管理 → 配置列表」→ 选目标 namespace
2. 点「+」→ 填 DataID（如 `ai-providers-doubao.properties`，**注意用 `-` 不能用 `/`**）、Group=`AI_GROUP`、配置格式选「Properties」
3. 粘贴配置内容（如 `DOUBAO_API_KEY=sk-xxx`）
4. 点「发布」→ Nacos 立即推送到所有连接的 api/worker 进程

**doubao.properties 示例**：
```properties
# 豆包/火山方舟 Ark
AI_CHAT_PROVIDER=doubao
DOUBAO_API_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_API_KEY=your-ark-api-key-here
DOUBAO_MODEL=ep-2024xxxx
DOUBAO_NEWS_MODEL=doubao-seed-2-0-code-preview-260215
```

---

## 让 api/worker 连接 Nacos

在 api 服务器和 worker 服务器的 `.env` 中添加（指向本配置服务器）：

```bash
NACOS_SERVER_ADDR=<配置服务器IP>:8848
NACOS_NAMESPACE=production          # 生产环境；开发用 dev
NACOS_USERNAME=nacos                # 第 5 步改密后的账号
NACOS_PASSWORD=<强密码>
```

配置后重建 api/worker 容器：
```bash
docker compose up -d --force-recreate
docker logs aigc-worker --tail 30 | grep nacos   # 应见 [nacos-config] 已连接 / 配置加载完成
```

> **`NACOS_SERVER_ADDR` 必填**：api/worker 的 AI provider 配置只认 Nacos。未配置 Nacos、缺少任一必填 DataID 或必填 key 为空，进程会停止启动。

---

## 日常维护

### 改 AI 配置（最高频操作）

1. 控制台 → 选 namespace → 编辑对应 DataID
2. 改完「发布」→ 1-2 秒内推送到所有 api/worker → **生效，无需重启**

对比过去：改 `.env` → `pnpm build` → 重打镜像 → scp → `docker load` → `docker compose up -d --force-recreate`。

### 版本回滚

每次发布会保留历史版本（默认 30 天）。「配置列表 → 历史版本」可一键回滚；「配置列表 → 监听查询」可查看哪些客户端 IP 正在订阅。

### 备份

```bash
# Derby 数据 + 配置内容全在 ./data 目录
tar -czf nacos-backup-$(date +%Y%m%d).tar.gz data/
```

### 监控

```bash
# 健康检查（加到运维巡检）
curl -fs http://<IP>:8848/nacos/v1/console/health/readiness && echo OK
```

Nacos 宕机影响：运行中的客户端会继续使用进程内已加载的最后一次配置，只是拿不到新配置。重启进程时若 Nacos 仍宕，api/worker 会启动失败，不再回退到 `.env`。

---

## 配置归属决策（避免混乱）

| 配置类型 | 放哪里 | 理由 |
|---------|--------|------|
| **AI key / endpoint / model id / 超时** | **Nacos** ✅ | 高频变、需热更、多环境 |
| 模型价格 / 积分系数 | **数据库**（`provider_models`） | 已 DB 驱动，不动 |
| `DATABASE_URL` / `REDIS_URL` / `JWT_SECRET` / TOS AK/SK | **容器 env** | 启动期强依赖 + 最高密级 |
| `NEXT_PUBLIC_STORAGE_HOST/PORT` | **构建期 `.env`** | 打进客户端 bundle |
| `NODE_ENV` / 端口 / `LOG_LEVEL` | **容器 env** | 启动期固定 |
| `NACOS_SERVER_ADDR/...` | **容器 env** | Nacos 自身参数，鸡生蛋 |

---

## 升级到集群（可选，规模大了再做）

当前单机 + 内嵌 Derby 适合当前规模（几个服务、几十条配置）。要做高可用时：

1. 准备一个**新的** MySQL（不要复用 PostgreSQL，也不要塞回基础设施服务器的 PG，保持职责单一）
2. `docker-compose.yml` 改为 3 节点，配 `MYSQL_SERVICE_HOST` 等环境变量，去掉 `MODE=standalone`
3. Nacos 3 节点用 Raft 选主

**现阶段不建议一上来就上集群**，单机运维成本最低，备份 `./data` 即可。
