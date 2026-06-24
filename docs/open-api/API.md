# 开放接口 API 文档（/api/v3）

开放接口（Open API）为外部调用方提供 AIGC 生成能力，共 7 种业务：
图片、视频、音乐、绘本、播客、资讯、文本润色。

---

## 1. 通用约定

### 1.1 基础信息

| 项 | 值 |
|---|---|
| Base URL | `https://<api-host>/api/v3` |
| 认证 | HTTP Bearer Token（API Key） |
| Content-Type | `application/json` |
| 字符编码 | UTF-8 |

### 1.2 认证

所有接口须在请求头携带 API Key：

```
Authorization: Bearer aigc_xxxxxxxxxxxxxxxxxxxxxxxx
```

- API Key 明文格式 `aigc_` + 去横线 UUID，由管理端签发，**仅在签发时返回一次**，库内只存哈希。
- 认证失败返回 HTTP 401。

### 1.3 统一响应信封

所有响应为 JSON，统一结构：

```json
{
  "result": {
    "task_id": "调用方传入的 task_id",
    "code": "0000",
    "message": "正在加速生成中，请稍等",
    "bussiness_id": "调用方传入的业务流水号"
  },
  "meta": { }
}
```

> **字段拼写为既定契约，请勿"修正"**：
> - `bussiness_id`（business 多一个 s）
> - `promt`（prompt 少一个 p）
> - `task_id`（snake_case）

### 1.4 HTTP 状态码（两段式）

HTTP 状态码表达**框架层结果**，`result.code` 表达**业务结果**：

| HTTP | 场景 | result.code |
|---|---|---|
| 200 | 业务成功 / 业务错误（受理成功或同步结果） | 0000 / 业务码 |
| 400 | 调用方未配置供应商 Key（MODEL_CONFIG_ERROR，仅文本润色） | 1003 |
| 401 | 认证失败（AUTH_FAILED） | 1002 |
| 422 | 请求体校验失败（PARAM_ERROR） | 1001 |
| 500 | 未知异常（SYSTEM_FAILED） | 5001 |

> **业务错误（重复 task_id、供应商失败、安全拦截等）HTTP 仍为 200**，由 `result.code` 区分。

### 1.5 错误码

| code | 含义 | 对外文案 |
|---|---|---|
| 0000 | 成功 | 正在加速生成中，请稍等 |
| 1001 | 参数错误（PARAM_ERROR） | 不符合创作规范 |
| 1002 | 认证失败（AUTH_FAILED） | 不符合创作规范 |
| 1003 | 模型未配置（MODEL_CONFIG_ERROR） | 不符合创作规范 |
| 2001 | 安全检测不通过（SECURITY_CHECK_FAILED） | 含敏感信息 |
| 2002 | 重复任务（DUPLICATE_TASK） | 不符合创作规范 |
| 4001 | 外部服务失败（EXTERNAL_SERVICE_FAILED） | 不符合创作规范 |
| 5001 | 系统失败（SYSTEM_FAILED） | 不符合创作规范 |

> 除 `2001` 文案为「含敏感信息」外，其余错误统一文案「不符合创作规范」，**不向客户端泄漏内部异常文本**。

---

## 2. 异步回调

除**文本润色（同步）**外，其余 6 种业务均为异步：

1. 调用接口 → 立即返回 HTTP 200 + `code: 0000`（受理成功，task_id 回显）
2. 任务在后台生成完成 → 向请求体 `callback_url` **POST** 最终结果
3. 调用方按 `result.code` 判断成功 / 失败，按 `meta` 取产物 URL

### 2.1 回调请求格式

- **Method**：POST
- **Headers**：
  - `Content-Type: application/json`
  - `X-Timestamp`：当前毫秒时间戳（13 位）
  - `X-Signature`：`sha256=<hex>`
- **Body**：紧凑 JSON（无多余空格、**不转义中文**）

回调体结构同 1.3 响应信封：`{ result: {task_id, bussiness_id, code, message}, meta: {...} }`。

### 2.2 HMAC-SHA256 签名验证

> **强烈建议**调用方验签，防止伪造回调。

签名规则：

```
signature = "sha256=" + HEX( HMAC-SHA256(secret, rawBody) )
```

- **签名输入仅含 body 字节，不含 `X-Timestamp`**
- `secret` = `CALLBACK_SIGNATURE_SECRET`（由部署方提供，与平台约定一致）
- `rawBody` 必须是**收到的原始 body 字节**，切勿重新 `JSON.stringify`（空格 / 字段顺序差异会导致签名不一致）

调用方验签示例（Node.js）：

```js
const crypto = require('node:crypto')

function verifyCallback(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  // 用恒定时间比较，防时序攻击
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
```

### 2.3 回调重试

回调失败（HTTP 非 2xx、连接超时）自动重试：**最多 4 次**（首试 + 3 次重试），**固定 10s 退避**。超限后标记回调失败，需人工介入。

### 2.4 回调 meta 结构（按业务）

成功时 `meta` 含产物字段；失败时 `failed_reason` 非空，产物字段为 null。

| 业务 | service_type | meta 字段 |
|---|---|---|
| 图片 | image | `status`, `failed_reason`, `image_url` |
| 视频 | video | `status`, `failed_reason`, `video_url` |
| 音乐 | song | `status`, `failed_reason`, `title`, `music_url`, `image_url`, `duration`, `lyrics_sections` |
| 绘本 | storybook | `status`, `failed_reason`, `images_url[]` |
| 播客 | podcast | `status`, `failed_reason`, `audio_url` |
| 资讯 | news | `status`, `failed_reason`, `title`, `news_abstract`, `news_url` |

- 所有产物 URL 为平台内部 TOS 永久地址（HTTPS）。
- `failed_reason`：成功为 `null`，失败为对外文案。
- `status`：`succeeded` / `failed`。

---

## 3. 接口详情

### 3.1 图片生成

`POST /api/v3/images/generations`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_id | string | 是 | 任务 ID（≤50 字符），幂等键 |
| bussiness_id | string | 是 | 业务流水号 |
| model | string | 是 | 模型（seedream 系列） |
| promt | string | 是 | 提示词（拼写 promt） |
| size | string | 是 | 尺寸 |
| ratio | string | 是 | 比例 |
| image | string | 否 | 参考图（base64 或已上传 URL） |
| callback_url | string | 是 | 回调地址 |

回调：`meta.image_url`（TOS 永久地址）。

### 3.2 视频生成

`POST /api/v3/videos/generations`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_id | string | 是 | 任务 ID |
| bussiness_id | string | 是 | 业务流水号 |
| model | string | 是 | 模型（seedance 系列） |
| create_mode | string | 是 | 创作模式 |
| prompt | string | 是 | 提示词 |
| resolution | string | 是 | 分辨率 |
| duration | string | 是 | 时长 |
| ratio | string | 是 | 比例 |
| callback_url | string | 是 | 回调地址 |

回调：`meta.video_url`。视频为自调度轮询任务（创建外部任务 → 轮询状态 → 完成转存 + 回调）。

### 3.3 音乐生成

`POST /api/v3/lyrics/generate`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_id | string | 是 | 任务 ID |
| model | string | 是 | 模型（mureka 系列） |
| promt | string | 是 | 歌词 / 创作要求（拼写 promt） |
| gender | string | 是 | 歌手性别：`0`=男 / `1`=女 / `2`=随机 |
| instrumental | string | 是 | `0`=人声歌曲 / `1`=纯音乐 |
| callback_url | string | 是 | 回调地址 |

回调：`meta.music_url`（音频）、`meta.image_url`（封面）、`meta.title`、`meta.duration`、`meta.lyrics_sections`。

### 3.4 绘本生成

`POST /api/v3/storybooks/generations`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_id | string | 是 | 任务 ID |
| bussiness_id | string | 是 | 业务流水号 |
| prompt | string | 是 | 绘本主题 |
| age | string | 是 | 适读年龄 |
| category | string | 是 | 分类 |
| style | string | 是 | 画风 |
| pages | integer | 是 | 页数 |
| callback_url | string | 是 | 回调地址 |

两步生成：Ark 分镜润色 + seedream 组图。回调：`meta.images_url[]`（多张图片 TOS 地址）。

### 3.5 播客生成

`POST /api/v3/podcasts/generations`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_id | string | 是 | 任务 ID |
| bussiness_id | string | 是 | 业务流水号 |
| content_type | string | 是 | `text`=正文 / `url`=网页 URL / `file`=PDF（base64 或已上传 URL） |
| content | string | 是 | 对应 content_type 的内容 |
| speakers | array | 是 | 说话人配置（必须 2 个） |
| callback_url | string | 是 | 回调地址 |

通过字节播客 WebSocket TTS 合成。回调：`meta.audio_url`。

### 3.6 资讯生成

`POST /api/v3/news/generations`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_id | string | 是 | 任务 ID |
| bussiness_id | string | 是 | 业务流水号 |
| prompt | string | 是 | 资讯主题 / 要求 |
| date | string | 是 | 日期，格式 `YYYY-MM-DD` |
| callback_url | string | 是 | 回调地址 |

Ark `/responses` + web_search 联网检索 + thinking 推理，生成完整 HTML 资讯页（含 `news-title` / `news-abstract` meta）。回调：`meta.news_url`（HTML 文件 TOS 地址）、`meta.title`、`meta.news_abstract`。

### 3.7 文本润色（同步，不走队列）

`POST /api/v3/chat/completions`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_id | string | 是 | 任务 ID |
| create_mode | string | 是 | `0`=音乐 / `1`=图片 / `2`=视频 / `3`=绘本 / `4`=行业分类 |
| input_text | string | 是 | 待润色文本 |

**同步链路**：API 进程直接调 Ark `/chat/completions`，HTTP 响应内直接返回结果（**无回调**）：

```json
{
  "result": { "task_id": "xxx", "code": "0000", "message": "正在加速生成中，请稍等" },
  "meta": { "output_text": "润色后的提示词" }
}
```

- 成功：`meta.output_text` 为润色结果。
- 失败（供应商异常）：`code: 4001`，`meta.output_text` 为空串。
- 未配置 Key：HTTP 400 + `code: 1003`。

---

## 4. 幂等性

所有接口的 `task_id` 为幂等键（同一调用方 + 同一 task_id 视为重复）：

- 首次提交：正常受理，返回 `code: 0000`。
- 重复提交：返回 `code: 2002`（DUPLICATE_TASK），HTTP 200，**不会重复扣费 / 重复生成**。

---

## 5. 安全说明

- **认证**：每个调用方独立 API Key，明文不落库（仅存 sha256 哈希）。
- **回调验签**：HMAC-SHA256，建议调用方强制验签。
- **base64 脱敏**：参考图 / PDF 等上传的 base64 内容，入库与日志均脱敏为 `<base64>`，原始内容先落 TOS 后以 URL 传递给供应商。
- **错误文案**：对外固定中文文案，不暴露内部异常、堆栈、供应商错误码。

---

## 附录：请求示例（cURL）

```bash
curl -X POST https://<api-host>/api/v3/images/generations \
  -H "Authorization: Bearer aigc_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task-001",
    "bussiness_id": "biz-001",
    "model": "seedream-4.5",
    "promt": "一只在月光下的猫",
    "size": "1024x1024",
    "ratio": "1:1",
    "callback_url": "https://your-server.com/callback"
  }'
```

响应：

```json
{
  "result": {
    "task_id": "task-001",
    "code": "0000",
    "message": "正在加速生成中，请稍等",
    "bussiness_id": "biz-001"
  }
}
```
