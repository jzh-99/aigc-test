# Nacos AI 配置（可直接导入）

本目录提供 9 个 AI 提供商的配置模板，改完真实值后**一键导入 Nacos**，省去在控制台逐条手敲。

## 文件结构

```
configs/
├── import-to-nacos.sh                       ← 一键导入脚本（进 git）
├── README.md                                ← 本文档（进 git）
├── ai-providers-doubao.properties.example   ← 留空模板（进 git）
├── ai-providers-volcengine.properties.example
├── ai-providers-ctyun.properties.example
├── ai-providers-tokenbus.properties.example
├── ai-providers-nano-banana.properties.example
├── ai-providers-qwen.properties.example
├── ai-providers-minimax.properties.example
├── ai-providers-mureka.properties.example
├── ai-providers-podcast.properties.example
├── system.properties.example                ← 留空模板（进 git）
│
├── ai-providers-doubao.properties           ← 填了真实值（被 .gitignore 忽略，不入库）
├── ...（其余 8 个 .properties 同理）
└── system.properties                        ← 系统级参数真实值（被 .gitignore 忽略）
```

> `system.properties` 与各 `ai-providers-*.properties` 的区别：供应商配置（key/endpoint）严格无默认值，必须由 Nacos 提供；系统级配置（超时/并发/max_tokens）有合理默认，留空用代码默认，填了就用填的值。
>
> **文件名 = Data ID**，文件内容 = 该 Data ID 的配置（properties 格式：`KEY=VALUE`，`#` 开头是注释）。
> 这些 Data ID 与 `packages/nacos-config/src/index.ts` 的 `AI_CONFIG_DATA_IDS` 一一对应，**不能改名**，否则应用订阅不到。
>
> ⚠️ **Data ID 不能含 `/`**：Nacos v1 OpenAPI 禁止 dataId 出现斜杠（报 `Param 'dataId' is illegal`），故用 `-` 连接，不能用 `ai-providers/xxx` 路径风格。

### `.properties` vs `.properties.example`（密钥安全机制）

| 文件 | 是否进 git | 用途 |
|------|-----------|------|
| `*.properties.example` | ✅ 进 git | 留空模板，团队共享，所有 key 留空 |
| `*.properties` | ❌ 被 `.gitignore` 忽略 | 填了真实 key 的本地文件，**永远不会被提交** |

`.gitignore` 规则：`deploy/nacos/configs/*.properties` 忽略，`!*.properties.example` 例外。
导入脚本 `import-to-nacos.sh` 只读 `*.properties`（真实值），不读 `.example`。

## 使用步骤

### 第 1 步：从模板生成填值文件

```bash
cd deploy/nacos/configs
# 复制每个 .example 为 .properties（这些 .properties 会被 gitignore，可放心填真实 key）
for f in *.properties.example; do cp "$f" "${f%.example}"; done
```

然后编辑每个 `*.properties`，把空着的 `KEY=` 后面填上真实值（API Key、endpoint 等）。带默认值的行（如 `DOUBAO_API_URL=...`）如果没特殊需求不用改。AI 供应商配置现在必须由 Nacos 提供，api/worker 不再读取 `.env` 里的 AI key/endpoint/model 作为兜底。

### 第 2 步：确保 Nacos 已启动

```bash
# 本地（docker-compose 已声明 nacos 服务）
docker-compose up -d
docker ps | grep nacos   # 确认 aigc-nacos-local 在跑且 healthy

# 或远程 Nacos：确认能访问 http://<IP>:8848/nacos
```

### 第 3 步：一键导入

```bash
# 默认导入到本地 Nacos（localhost:8848），namespace=public，group=AI_GROUP
bash deploy/nacos/configs/import-to-nacos.sh

# 指定远程 Nacos / 命名空间（生产环境）
NACOS_ADDR=10.0.0.5:8848 NACOS_NAMESPACE=production \
  bash deploy/nacos/configs/import-to-nacos.sh
```

脚本通过 Nacos OpenAPI（`POST /nacos/v1/cs/configs`）逐个发布，绕开 ZIP 导入的版本兼容问题。脚本会打印每个 Data ID 的导入结果（成功/失败 + HTTP 状态码）。

> **namespace → tenant 映射**：Nacos 默认 public namespace 在 OpenAPI 里的 tenant 必须是**空串**；若传 "public" 字符串，配置会落到一个名为 "public" 的自定义命名空间，导致默认连 public 的应用订阅不到。脚本已处理此映射（namespace=public → tenant 空串），自定义 namespace（dev/staging/production）则 tenant = namespace ID。

> 若 Nacos 开了鉴权（生产环境），脚本会自动用环境变量 `NACOS_USERNAME` / `NACOS_PASSWORD` 登录换取 accessToken 附加到请求。

### 第 4 步：在控制台核对

打开 http://localhost:8848/nacos → 配置管理 → 配置列表 → 选对应 namespace，应能看到 9 条 Group=`AI_GROUP` 的配置。

### 第 5 步：让应用连上

在 api/worker 的 `.env` 填 `NACOS_SERVER_ADDR=localhost:8848`，重启 api/worker，日志应见 `[nacos-config] 配置加载完成（成功 9/9 个 dataId）`。`NACOS_SERVER_ADDR` 不能为空；Nacos 连接失败或任一 dataId 拉取失败时进程会停止启动。具体供应商 key 允许按启用情况留空，实际调用该供应商时再由 adapter/service 报精确缺项错误。

## 日常改配置（导入后）

导入只是一次性初始化。**后续改配置直接在 Nacos 控制台改 + 发布即可，秒级热更生效，无需再跑导入脚本。** 导入脚本只用于「从零初始化」或「批量重置」。

## 导入失败排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 全部 `401` / `403` | Nacos 开了鉴权但没配账号密码 | `export NACOS_USERNAME=... NACOS_PASSWORD=...` 后重跑 |
| 全部 `connection refused` | Nacos 容器没起 / 地址错 | `docker ps \| grep nacos` 确认；检查 `NACOS_ADDR` |
| `Param 'dataId' is illegal` | dataId 含非法字符（如 `/`） | 文件名不能含 `/`，保持 `ai-providers-xxx.properties` 命名 |
| 某条 `400` | properties 内容格式错（如 key 含非法字符） | 检查对应文件，key 必须 `^[A-Z_][A-Z0-9_]*$` |
| 控制台看不到配置 | namespace/tenant 选错 | 默认 public namespace 的 tenant 是空串；控制台左上角确认 namespace |
| 应用订阅不到（明明导入成功） | 导入用的 namespace ≠ 应用连的 namespace | 两边对齐：本地都用 public，生产都用 production ID |
