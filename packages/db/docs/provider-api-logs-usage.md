# Provider API Logs 使用说明

## 新增字段

为了更好地追踪 AI 模型调用的来源和目的，`provider_api_logs` 表新增了以下字段：

- **`request_url`** (text, 可选) - 完整的请求 URL，包含协议、host、路径和查询参数
- **`referer`** (varchar(500), 可选) - 业务来源，记录触发此次 AI 调用的业务接口路径

## 使用示例

### 1. Worker 中的外部 API 调用

在 Worker 中调用外部 AI 服务时，应记录完整的请求 URL：

```typescript
// apps/worker/src/lib/mureka.ts 或其他 adapter 中

await recordProviderApiLog({
  ...this.auditContext,
  module: 'music',
  provider: 'mureka',
  model: 'chirp-v3',
  operation: 'generate_song',
  method: 'POST',
  endpoint: '/v1/song/generate',
  requestUrl: `${this.baseUrl}/v1/song/generate`, // 完整 URL
  requestPayload,
  responseStatus: res.status,
  responsePayload: data,
  durationMs: Date.now() - startedAt,
  status: 'success',
})
```

### 2. API 路由中记录业务来源

在 API 路由中触发 AI 调用时，应记录 referer 以追踪业务来源：

```typescript
// apps/api/src/routes/generate/image.ts

import { recordProviderApiLog } from '@aigc/db'

export default async function routes(fastify: FastifyInstance) {
  fastify.post('/image', async (request, reply) => {
    const { prompt } = request.body
    
    // 调用 AI 服务前记录
    await recordProviderApiLog({
      userId: request.user.id,
      teamId: request.user.teamId,
      module: 'image_generation',
      provider: 'volcengine',
      operation: 'text_to_image',
      method: 'POST',
      endpoint: '/api/v1/generation/text_to_image',
      referer: '/api/generate/image', // 记录业务来源
      requestUrl: 'https://visual.volcengineapi.com/api/v1/generation/text_to_image',
      requestPayload: { prompt },
      status: 'success',
    })
  })
}
```

### 3. 从 HTTP 请求中提取信息

如果在 Fastify 路由中，可以从 request 对象提取完整信息：

```typescript
const referer = request.url // 当前业务接口路径，如 '/api/generate/image'
const requestUrl = externalApiBaseUrl + externalApiPath // 外部 AI 服务的完整 URL

await recordProviderApiLog({
  // ... 其他字段
  referer,
  requestUrl,
})
```

## 字段说明

### `request_url`
- 用于记录外部 AI 服务的完整请求 URL
- 包含协议、域名、端口、路径和查询参数
- 示例：`https://visual.volcengineapi.com/api/v1/generation/text_to_image?version=2`

### `referer`
- 用于记录触发此次 AI 调用的业务接口路径
- 帮助追踪是哪个业务功能发起的调用
- 示例：`/api/generate/image`、`/api/canvas/export`、`/api/video-studio/submit`

### `endpoint`（已有字段）
- 通常记录相对路径或端点标识
- 与 `request_url` 配合使用，提供更灵活的查询维度

## 迁移说明

1. 执行迁移：
```bash
pnpm db:migrate
```

2. 新字段为可选，不影响现有代码
3. 建议在新代码中逐步添加这些字段，以便更好地追踪 AI 调用来源
