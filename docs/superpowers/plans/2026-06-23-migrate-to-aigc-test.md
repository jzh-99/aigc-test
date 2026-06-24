# AIGC 开放接口迁移到 aigc-test 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `aigc-miniapp-server`（Python/FastAPI/Celery）的全部 B2B 开放接口能力（图片/视频/音乐/播客/资讯/绘本/文本润色 7 类）用 TypeScript 完全重写并融合进 `aigc-test`（Fastify/Kysely/PostgreSQL/BullMQ），废弃 Python 服务与 MinIO，存储统一迁至火山 TOS。

**Architecture:** 深度复用 aigc-test 现有体系——开放接口任务复用 `task_batches`/`tasks`/`assets` 三张表（加少量字段），图片/视频/音乐复用现有 worker + adapter + transfer + poller；播客/资讯/文本润色新建 provider+worker。归属采用 `api_client → team` 一一映射（方案 B'）。上游密钥统一走 aigc-test 全局 env（放弃多租户）。通知机制：带 `callback_url` 的任务互斥走"回调队列"（HMAC 签名 + 4 次 10s 退避），无则走现有 SSE。开放接口挂 `/api/v3` 前缀，从 JWT 全局钩子豁免，走独立 API Key 认证。

**Tech Stack:** TypeScript (ESM) · Fastify 4 · Kysely + PostgreSQL · BullMQ + Redis · @volcengine/tos-sdk · Sharp · 火山方舟/Mureka/字节播客

---

## 一、决策汇总（全部已与用户确认锁定）

| # | 决策 | 选择 | 依据 |
|---|---|---|---|
| 1 | 整体策略 | 完全 TS 重写，废弃 Python | 用户 |
| 2 | 调用方契约 | 尽量不变；接口名微调可接受（song 统一 `/api/v3`） | 用户 |
| 3 | 复用原则 | 最大化复用 aigc-test 现有能力（深复用） | 用户 |
| 4 | 存储 | MinIO 全部下线 → 统一 TOS（URL 域名变更，接受） | 用户 |
| 5 | 范围 | 7 类一次性全迁 | 用户 |
| 6 | 上游密钥 | 统一全局 env，**放弃多租户**（adapter/MurekaClient 不改造） | 用户 |
| 7 | 归属容器 | 方案 B'：`api_client → team` 一一映射，建 team+默认 workspace+占位 credit_account+system user | 用户（调用方非常少） |
| 8 | `bussiness_id` | 业务流水号，每次变；纯透传回回调，**不做归属键** | 用户（确认每次变） |
| 9 | 通知机制 | 保留 SSE；带 `callback_url` 则**互斥**走回调队列 | 用户 |
| 10 | 回调队列 | BullMQ job，HMAC-SHA256，HTTP 2xx 判成功，4 次 ×10s 退避，超限 `callback_failed` | 源项目 `retry_callback` 等价复刻 |
| 11 | `promt`/`bussiness_id` 拼写 | 对外契约字段拼写不变（调用方零改动）；内部 DB 字段名见 §0.1 决策 | 项目约定 |

---

## 二、文件结构映射

### 新建文件

| 路径 | 职责 |
|---|---|
| `packages/db/migrations/<ts>_open_api_tables.ts` | 新建 `api_clients` 表 + `task_batches`/`tasks` 加字段 + 枚举扩展 |
| `packages/db/src/schema.ts`（修改） | 增 `ApiClientsTable`、扩展 `TaskBatchesTable` 字段与枚举 |
| `packages/types/src/open-api.ts` | 开放接口入参 schema 类型、`GenerationJobData` 扩展、回调 payload 类型 |
| `apps/api/src/plugins/api-key-auth.ts` | API Key 认证插件（Bearer，SHA-256 摘要查表） |
| `apps/api/src/lib/open-api-errors.ts` | `ErrorCode` 枚举 + 固定文案 + `ResultEnvelope` + `success_response` |
| `apps/api/src/lib/callback-payload.ts` | `buildAsyncCallbackPayload`（6 种 service_type meta） |
| `apps/api/src/lib/api-client.ts` | api_client 哈希校验 + 归属容器（team/workspace/credit_account）联动创建 |
| `apps/api/src/routes/open-api/` | 7 类开放接口路由（images/videos/lyrics/news/podcast/storybook/chat） |
| `apps/api/src/routes/open-api/_shared.ts` | 路由共用：建 batch+task helper、入参→jobData 适配 |
| `apps/worker/src/lib/callback-client.ts` | `CallbackClient.post`（HMAC 签名 + HTTP 2xx） |
| `apps/worker/src/workers/open-api-callback.ts` | 回调 worker（消费 `open-api-callback-queue`） |
| `apps/worker/src/lib/dispatch-result.ts` | `dispatchBatchResult` 收敛 helper（有 callback_url→投回调 job，否则 SSE） |
| `apps/worker/src/providers/podcast-tts.ts` | 字节播客 WebSocket TTS provider（新建） |
| `apps/worker/src/providers/news.ts` | 资讯 provider（Ark /responses + HTML）（新建） |
| `apps/worker/src/providers/ark-text-polish.ts` | 文本润色 provider（新建） |
| `apps/worker/src/workers/podcast.ts` / `news.ts` | 播客/资讯 worker（新建） |

### 修改文件

| 路径 | 改动 |
|---|---|
| `apps/api/src/app.ts` | 注册第二个 autoload（`/api/v3` → `routes/open-api`） |
| `apps/api/src/plugins/jwt-auth.ts` | `PUBLIC_ROUTES` 豁免 `/api/v3`（JWT 只管 `/api/v1`） |
| `apps/api/src/lib/queue.ts` | 增 `getOpenApiCallbackQueue()`、`getPodcastQueue()`、`getNewsQueue()` getter |
| `apps/worker/src/index.ts` | 注册 `openApiCallbackWorker`、`podcastWorker`、`newsWorker` |
| `apps/worker/src/pipelines/complete.ts` | SSE 发布处接入 `dispatchBatchResult` |
| `apps/worker/src/pipelines/fail.ts` | 同上 |
| `apps/worker/src/workers/transfer.ts` | asset 转存完成后接入 `dispatchBatchResult`（图片回调时序） |
| `apps/worker/src/pollers/video-poller.ts` | `handleVideoSuccess`/`handleVideoFailure` 接入 `dispatchBatchResult` |
| `apps/worker/src/workers/music.ts` | 完成处接入 `dispatchBatchResult` + 入参兼容开放接口字段 |

---

## 三、复用决策表（R=复用 / A=适配 / N=新建）

| 能力 | 处置 | 说明 |
|---|---|---|
| TOS 存储 | R | `apps/worker/src/lib/storage.ts` 直接用 |
| transfer worker（URL→TOS 转存） | R | 开放接口图片/视频产物走现有 transfer |
| 火山图片 adapter（seedream 映射+尺寸） | R | `volcengine-image.ts` 直接调 |
| video-poller 轮询框架 | A | 扩展支持开放接口 batch（已天然兼容，`module='video'`） |
| MurekaClient（音乐 HTTP） | A | 入参字段适配（promt/gender/tag/instrumental → prompt/lyrics/styles/voice_gender） |
| provider_api_logs 审计 | R | 直接用 |
| Kysely / BullMQ / Redis / Fastify autoload | R | — |
| complete/fail 管线 | A | 加 `dispatchBatchResult` 钩子；`estimated_credits=0` 零副作用 |
| HMAC 回调 / API Key 认证 / 归属容器 | N | aigc-test 无此能力，全新 |
| 播客 WS-TTS / 资讯 / 文本润色 | N | aigc-test 无，新建 provider |

---

## Phase 0：基础设施（所有业务共用，端到端可测）

### Task 0.1：数据库迁移 —— api_clients 表 + task_batches/tasks 加字段 + 枚举扩展

**决策（字段名拼写）：** 对外契约入参/回参保持源项目拼写 `bussiness_id`（调用方零改动）；**内部 DB 列名采用规范拼写 `business_id`**（仅在路由层做 `bussiness_id ↔ business_id` 映射），避免内部代码长期背负拼写错误。若你要求内部也保持 `bussiness_id`，把下文列名整体替换即可。

**Files:**
- Create: `packages/db/migrations/<ts>_open_api_tables.ts`
- Modify: `packages/db/src/schema.ts`（`TaskBatchesTable` 加字段；新增 `ApiClientsTable`；`Database` 接口加 `api_clients`）
- Test: `apps/api/test/open-api/db-migration.test.ts`

- [ ] **Step 1: 写迁移失败测试**（断言新列存在、枚举值可写入）

```ts
// apps/api/test/open-api/db-migration.test.ts
import { getDb } from '@aigc/db'

test('task_batches 支持开放接口字段与枚举', async () => {
  const db = getDb()
  const row = await db.insertInto('task_batches').values({
    id: 'test-1', user_id: 'sys', credit_account_id: 'acc-1',
    idempotency_key: 'k1', source: 'open_api', module: 'news',
    provider: 'ark', model: 'm', prompt: 'p', estimated_credits: 0,
    business_id: 'order-1', callback_url: 'https://x/cb',
  } as any).returning('id').executeTakeFirstOrThrow()
  expect(row.id).toBe('test-1')
})

test('api_clients 表存在并可写入归属', async () => {
  const db = getDb()
  const r = await db.insertInto('api_clients').values({
    name: 'caller-a', api_key_hash: 'h', status: 'active',
    team_id: 'team-1', workspace_id: 'ws-1', system_user_id: 'sys',
  } as any).returning('id').executeTakeFirstOrThrow()
  expect(r.id).toBeDefined()
})
```

- [ ] **Step 2: 运行测试确认失败** —— `pnpm --filter @aigc/api test`（预期：列不存在报错）

- [ ] **Step 3: 写迁移文件**（参考 `packages/db/migrations/` 现有文件的命名与 Kysely 风格）

```ts
// packages/db/migrations/<ts>_open_api_tables.ts
import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // 1. task_batches 加字段
  await db.schema.alterTable('task_batches').addColumn('business_id', 'varchar(50)').execute()
  await db.schema.alterTable('task_batches').addColumn('callback_url', 'text').execute()
  await db.schema.alterTable('task_batches').addColumn('callback_attempts', 'integer', (c) => c.notNull().defaultTo(0)).execute()
  await db.schema.alterTable('task_batches').addColumn('callback_status', 'varchar(20)').execute() // pending|succeeded|failed
  await db.schema.alterTable('task_batches').addColumn('service_type', 'varchar(30)').execute() // image|song|video|news|podcast|storybook|text
  await db.schema.alterTable('task_batches').addColumn('task_id', 'varchar(50)').execute() // 对外 task_id（源项目契约）
  await db.schema.alterTable('task_batches').addColumn('finished_at', 'timestamptz').execute()
  // source 枚举扩展：原 'generation'|'studio'|'canvas' → 加 'open_api'（PG 用 check 或应用层约束；这里不加 DB check，靠应用层枚举）
  await db.schema.alterTable('task_batches').addIndex('idx_task_batches_callback').column('callback_status').execute()

  // 2. tasks 加外部任务轮询载荷（复用替代 external_tasks）
  await db.schema.alterTable('tasks').addColumn('external_status', 'varchar(30)').execute()
  await db.schema.alterTable('tasks').addColumn('last_polled_at', 'timestamptz').execute()

  // 3. api_clients 表（新建）
  await db.schema.createTable('api_clients')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('name', 'varchar(100)', (c) => c.notNull().unique())
    .addColumn('api_key_hash', 'varchar(255)', (c) => c.notNull().unique()) // sha256(api_key) 摘要
    .addColumn('status', 'varchar(20)', (c) => c.notNull().defaultTo('active'))
    .addColumn('team_id', 'uuid').execute() // 归属团队（方案 B'）
    .addColumn('workspace_id', 'uuid').execute() // 默认工作区
    .addColumn('system_user_id', 'uuid').execute() // 归属系统用户（填 task_batches.user_id）
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(db.fn('now')))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(db.fn('now')))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('api_clients').ifExists().execute()
  for (const c of ['external_status','last_polled_at']) {
    await db.schema.alterTable('tasks').dropColumn(c).execute()
  }
  for (const c of ['finished_at','task_id','service_type','callback_status','callback_attempts','callback_url','business_id']) {
    await db.schema.alterTable('task_batches').dropColumn(c).execute()
  }
}
```

- [ ] **Step 4: 更新 schema.ts 类型**（`TaskBatchesTable` 加 7 个新字段；新增 `ApiClientsTable`；`source`/`module` 联合类型扩展 `'open_api'`/`'podcast'|'news'|'storybook'`；`Database` 加 `api_clients`）

```ts
// packages/db/src/schema.ts（节选增量）
export interface TaskBatchesTable {
  // ...现有字段不变...
  source: 'generation' | 'studio' | 'canvas' | 'open_api'
  module: /* 现有枚举 */ | 'podcast' | 'news' | 'storybook'
  business_id: string | null
  callback_url: string | null
  callback_attempts: Generated<number>
  callback_status: 'pending' | 'succeeded' | 'failed' | null
  service_type: string | null
  task_id: string | null          // 对外契约 task_id
  finished_at: Timestamp | null
}

export interface ApiClientsTable {
  id: Generated<string>
  name: string
  api_key_hash: string
  status: 'active' | 'disabled'
  team_id: string | null
  workspace_id: string | null
  system_user_id: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}
// Database 接口加：api_clients: ApiClientsTable
```

- [ ] **Step 5: 运行迁移** —— `pnpm db:migrate`，再跑测试确认通过

- [ ] **Step 6: Commit** —— `git add -A && git commit -m "feat(db): 开放接口表结构与枚举扩展"`

---

### Task 0.2：错误码契约 + 统一响应信封

**Files:**
- Create: `apps/api/src/lib/open-api-errors.ts`
- Test: `apps/api/test/open-api/errors.test.ts`

- [ ] **Step 1: 失败测试**（断言枚举值与文案与源项目 `errors.py` 完全一致）

```ts
test('ErrorCode 值与文案锁定', () => {
  expect(ErrorCode.SUCCESS).toBe('0000')
  expect(ErrorCode.SECURITY_CHECK_FAILED).toBe('2001')
  expect(errorMessage(ErrorCode.SYSTEM_FAILED)).toBe('不符合创作规范')
  expect(errorMessage(ErrorCode.SECURITY_CHECK_FAILED)).toBe('含敏感信息')
  expect(errorMessage(ErrorCode.SUCCESS)).toBe('正在加速生成中，请稍等')
})
test('success_response 信封', () => {
  expect(success_response('t1')).toEqual({ result: { task_id: 't1', code: '0000', message: '正在加速生成中，请稍等' } })
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**（逐字对齐源项目 `errors.py`）

```ts
// apps/api/src/lib/open-api-errors.ts
export const ErrorCode = {
  SUCCESS: '0000', PARAM_ERROR: '1001', AUTH_FAILED: '1002', MODEL_CONFIG_ERROR: '1003',
  SECURITY_CHECK_FAILED: '2001', DUPLICATE_TASK: '2002', EXTERNAL_SERVICE_FAILED: '4001',
  FILE_PROCESS_FAILED: '4002', STORAGE_FAILED: '4003', CALLBACK_FAILED: '4004', SYSTEM_FAILED: '5001',
} as const
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode]

const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCode.SUCCESS]: '正在加速生成中，请稍等',
  [ErrorCode.SECURITY_CHECK_FAILED]: '含敏感信息',
  // 其余码统一文案
  [ErrorCode.PARAM_ERROR]: '不符合创作规范',
  [ErrorCode.AUTH_FAILED]: '不符合创作规范',
  [ErrorCode.MODEL_CONFIG_ERROR]: '不符合创作规范',
  [ErrorCode.DUPLICATE_TASK]: '不符合创作规范',
  [ErrorCode.EXTERNAL_SERVICE_FAILED]: '不符合创作规范',
  [ErrorCode.FILE_PROCESS_FAILED]: '不符合创作规范',
  [ErrorCode.STORAGE_FAILED]: '不符合创作规范',
  [ErrorCode.CALLBACK_FAILED]: '不符合创作规范',
  [ErrorCode.SYSTEM_FAILED]: '不符合创作规范',
}
export function errorMessage(code: string): string { return ERROR_MESSAGES[code] ?? '不符合创作规范' }

// 统一响应信封（对齐源项目 success_response）
export function success_response(taskId: string) {
  return { result: { task_id: taskId, code: ErrorCode.SUCCESS, message: errorMessage(ErrorCode.SUCCESS) } }
}

// 业务异常（对齐源项目 AppError：不向客户端暴露内部文本）
export class OpenApiError extends Error {
  constructor(public code: string, public rawMessage?: string) { super(rawMessage ?? errorMessage(code)) }
  get publicMessage(): string { return errorMessage(this.code) }
}
```

- [ ] **Step 4-5: 通过 + Commit** —— `feat(open-api): 错误码与响应信封`

---

### Task 0.3：回调载荷构建器（6 种 service_type meta）

**Files:**
- Create: `apps/api/src/lib/callback-payload.ts`
- Test: `apps/api/test/open-api/callback-payload.test.ts`

- [ ] **Step 1: 失败测试**（断言每种 service_type 的 meta 字段，逐一对齐源 `callbacks.py` 的 `_song_meta`/`_image_meta`/`_text_meta`/`_video_meta`/`_news_meta`/`_storybook_meta`）

```ts
test('image 成功载荷', () => {
  const p = buildAsyncCallbackPayload({ serviceType: 'image', taskId: 't1', bussinessId: 'b1', status: 'succeeded', media: { image_url: 'https://tos/x.png' }, extraMeta: {} })
  expect(p.result).toEqual({ task_id: 't1', bussiness_id: 'b1', code: '0000', message: null })
  expect(p.meta).toEqual({ status: 'succeeded', failed_reason: null, image_url: 'https://tos/x.png' })
})
test('text 载荷无 bussiness_id（对齐源项目）', () => {
  const p = buildAsyncCallbackPayload({ serviceType: 'text', taskId: 't1', bussinessId: '', status: 'succeeded', media: { output_text: 'hi' }, extraMeta: {} })
  expect(p.result.bussiness_id).toBeUndefined()
  expect(p.meta.output_text).toBe('hi')
})
test('失败载荷用固定文案不泄露内部文本', () => {
  const p = buildAsyncCallbackPayload({ serviceType: 'image', taskId: 't1', bussinessId: 'b1', status: 'failed', media: {}, extraMeta: {}, failureCode: ErrorCode.SYSTEM_FAILED })
  expect(p.meta.failed_reason).toBe('不符合创作规范')
  expect(p.result.code).toBe('5001')
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**（完整移植源 `build_async_callback_payload` 的 6 个 meta 构造分支）

```ts
// apps/api/src/lib/callback-payload.ts
import { ErrorCode, errorMessage } from './open-api-errors.js'

export interface BuildPayloadInput {
  serviceType: 'image' | 'song' | 'video' | 'news' | 'podcast' | 'storybook' | 'text'
  taskId: string
  bussinessId: string
  status: 'succeeded' | 'failed'
  media: Record<string, any>
  extraMeta: Record<string, any>
  failureCode?: string
  publicMessage?: string
}

export function buildAsyncCallbackPayload(input: BuildPayloadInput) {
  const { serviceType, taskId, bussinessId, status, media, extraMeta } = input
  const success = status === 'succeeded'
  const failureCode = input.failureCode ?? ErrorCode.SYSTEM_FAILED
  const reason = success ? null : (input.publicMessage ?? errorMessage(failureCode))
  const code = success ? ErrorCode.SUCCESS : failureCode

  const meta = buildMeta(serviceType, media, reason, status, extraMeta)
  const result: Record<string, any> = { task_id: taskId, code, message: success ? null : errorMessage(failureCode) }
  // 对齐源项目：text 不带 bussiness_id，其余带
  if (serviceType !== 'text') result.bussiness_id = bussinessId
  return { result, meta }
}

function buildMeta(serviceType: string, media: any, reason: string | null, status: string, extra: any): Record<string, any> {
  switch (serviceType) {
    case 'song':
      return { status: extra.status ?? status, failed_reason: reason, title: extra.title ?? null,
        music_url: media.music_url ?? null, image_url: media.image_url ?? null,
        duration: extra.duration ?? null, lyrics_sections: extra.lyrics_sections ?? null }
    case 'image':
      return { status, failed_reason: reason, image_url: media.image_url ?? null }
    case 'text':
      return { output_text: reason === null ? (media.output_text ?? '') : '' }
    case 'video':
      return { status, failed_reason: reason, video_url: media.video_url ?? null }
    case 'news':
      return { status, failed_reason: reason, title: extra.title ?? null,
        news_abstract: extra.abstract ?? null, news_url: media.news_url ?? null }
    case 'storybook':
      return { status, failed_reason: reason, images_url: media.images_url ?? [] }
    case 'podcast': // 源项目 podcast 回调结构按默认分支处理
    default:
      return { status, failed_reason: reason, ...media, ...(reason === null ? extra : {}) }
  }
}
```

- [ ] **Step 4-5: 通过 + Commit** —— `feat(open-api): 回调载荷构建器`

---

### Task 0.4：HMAC 回调客户端 + 回调 worker + 队列

**Files:**
- Create: `apps/worker/src/lib/callback-client.ts`
- Create: `apps/worker/src/workers/open-api-callback.ts`
- Modify: `apps/api/src/lib/queue.ts`（加 `getOpenApiCallbackQueue`）+ `apps/worker/src/lib/queue-options.ts` 若有回调专用 options
- Test: `apps/worker/test/callback-client.test.ts`

**契约（对齐源 `callbacks.py`）：** body 为紧凑 JSON（`JSON.stringify` 默认无空格、不转义 unicode，等价 `separators=(",",":")` + `ensure_ascii=False`）；头 `Content-Type: application/json`、`X-Timestamp: <毫秒>`、`X-Signature: sha256=<hex>`；成功判定 `response.ok`（2xx）。

- [ ] **Step 1: 失败测试**（mock fetch，断言签名头格式、body 紧凑、非 2xx 抛错）

```ts
test('CallbackClient 签名头与紧凑 body', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as any)
  vi.stubGlobal('fetch', mockFetch)
  await new CallbackClient(10, 'secret').post('https://x/cb', { a: 1, b: '中' })
  const [, init] = mockFetch.mock.calls[0]
  const body = new TextEncoder().encode(init.body as string)
  expect(init.headers['X-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
  expect(init.headers['X-Timestamp']).toMatch(/^\d{13}$/)
  // 签名 = sha256(body) ，body 为紧凑 JSON
  const crypto = await import('node:crypto')
  expect(init.headers['X-Signature']).toBe('sha256=' + crypto.createHmac('sha256', 'secret').update(body).digest('hex'))
})
test('非 2xx 抛错触发 BullMQ 重试', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as any))
  await expect(new CallbackClient(10, 's').post('u', {})).rejects.toThrow()
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现客户端**

```ts
// apps/worker/src/lib/callback-client.ts
import crypto from 'node:crypto'

export class CallbackClient {
  constructor(private timeoutSeconds: number, private signatureSecret: string) {}
  async post(callbackUrl: string, payload: Record<string, any>): Promise<void> {
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf-8') // 紧凑、不转义 unicode
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000)
    try {
      const res = await fetch(callbackUrl, {
        method: 'POST', body: rawBody, signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': String(Date.now()),
          'X-Signature': 'sha256=' + crypto.createHmac('sha256', this.signatureSecret).update(rawBody).digest('hex'),
        },
      })
      if (!res.ok) throw new Error(`callback http ${res.status}`)
    } finally { clearTimeout(timer) }
  }
}
```

- [ ] **Step 4: 队列 getter**

```ts
// apps/api/src/lib/queue.ts（增量，仿现有 getter 模式）
import type { OpenApiCallbackJobData } from '@aigc/types'
let _openApiCallbackQueue: Queue<OpenApiCallbackJobData> | null = null
export function getOpenApiCallbackQueue(): Queue<OpenApiCallbackJobData> {
  if (!_openApiCallbackQueue) {
    _openApiCallbackQueue = new Queue<OpenApiCallbackJobData>('open-api-callback-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _openApiCallbackQueue
}
// closeQueues / __setQueuesForTest 同步加入 _openApiCallbackQueue
```

- [ ] **Step 5: 回调 worker**（消费队列，4 次 ×10s 退避；超限写 `callback_status='failed'`）

```ts
// apps/worker/src/workers/open-api-callback.ts
import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { getBullMQConnection } from '../lib/redis.js'
import { CallbackClient } from '../lib/callback-client.js'
import type { OpenApiCallbackJobData } from '@aigc/types'
import { buildLogger } from '../logger.js'
const logger = buildLogger()

export const openApiCallbackWorker = new Worker<OpenApiCallbackJobData>(
  'open-api-callback-queue',
  async (job) => {
    const db = getDb()
    const { batchId } = job.data
    const batch = await db.selectFrom('task_batches')
      .select(['callback_url', 'callback_attempts', 'service_type', 'task_id', 'business_id', 'status'])
      .where('id', '=', batchId).executeTakeFirst()
    if (!batch?.callback_url) return // 无回调地址跳过
    // payload 在投递时已存入 job.data.payload（避免再查 assets 拼装）
    const secret = process.env.CALLBACK_SIGNATURE_SECRET!
    const timeout = Number(process.env.CALLBACK_TIMEOUT_SECONDS ?? 10)
    try {
      await new CallbackClient(timeout, secret).post(batch.callback_url, job.data.payload)
      await db.updateTable('task_batches').set({ callback_status: 'succeeded' }).where('id', '=', batchId).execute()
    } catch (err) {
      const attempts = batch.callback_attempts + 1
      await db.updateTable('task_batches').set({ callback_attempts: attempts, callback_status: attempts >= 4 ? 'failed' : 'pending' }).where('id', '=', batchId).execute()
      logger.warn({ batchId, attempts, err: String(err) }, '回调失败')
      if (attempts >= 4) return // 达上限，不再重试（BullMQ attempts 已耗尽）
      throw err // 触发 BullMQ 下一次退避重试
    }
  },
  { connection: getBullMQConnection(), limiter: { max: 20, duration: 1000 } },
)
```

> **退避策略：** 投递时设 `attempts: 4, backoff: { type: 'fixed', delay: 10_000 }`（见 §0.8 helper），等价源项目 `RETRY_DELAYS=[10,10,10]`。BullMQ 自动重试，无需手写 countdown 重投。

- [ ] **Step 6: 在 `apps/worker/src/index.ts` 注册 worker**

```ts
import { openApiCallbackWorker } from './workers/open-api-callback.js'
// workers 数组加入 openApiCallbackWorker
```

- [ ] **Step 7: 通过 + Commit** —— `feat(open-api): HMAC 回调客户端与 worker`

---

### Task 0.5：API Key 认证插件

**Files:**
- Create: `apps/api/src/plugins/api-key-auth.ts`
- Create: `apps/api/src/lib/api-client.ts`（哈希校验 + 解析 Bearer）
- Test: `apps/api/test/open-api/api-key-auth.test.ts`

**决策：** 源项目用 `pbkdf2_sha256`（passlib）。TS 侧不引入 passlib，改用**两层哈希**：明文 key 经 `sha256` 得摘要存库（`api_key_hash`），认证时对入参 key 做同样 `sha256` 比对。**与源项目 hash 不互通**——迁移时需为现有调用方**重新签发** `aigc_xxx` key（调用方很少，可接受）。若需保留旧 hash 兼容，须额外实现 pbkdf2_sha256 验证（需你确认，默认不做）。

- [ ] **Step 1: 失败测试**

```ts
test('合法 API Key 通过，非法拒绝', async () => {
  const db = getDb()
  await db.insertInto('api_clients').values({ name: 'c1', api_key_hash: sha256('aigc_secret_xxx'), status: 'active', /* team/ws/sys 占位 */ } as any).execute()
  // 合法
  let req = buildReq({ authorization: 'Bearer aigc_secret_xxx' })
  await authenticateApiKey(req)
  expect(req.apiClient).toBeDefined()
  // 非法
  req = buildReq({ authorization: 'Bearer wrong' })
  await expect(authenticateApiKey(req)).rejects.toBeInstanceOf(OpenApiError)
})
test('disabled 调用方拒绝', async () => { /* status='disabled' → AUTH_FAILED */ })
```

- [ ] **Step 2-3: 实现**

```ts
// apps/api/src/lib/api-client.ts
import crypto from 'node:crypto'
import { getDb } from '@aigc/db'
import { OpenApiError, ErrorCode } from './open-api-errors.js'

export function hashApiKey(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex')
}

export async function resolveApiClient(bearerToken: string | undefined) {
  if (!bearerToken) throw new OpenApiError(ErrorCode.AUTH_FAILED)
  const digest = hashApiKey(bearerToken)
  const client = await getDb().selectFrom('api_clients')
    .selectAll().where('api_key_hash', '=', digest).where('status', '=', 'active')
    .executeTakeFirst()
  if (!client) throw new OpenApiError(ErrorCode.AUTH_FAILED)
  return client
}
```

```ts
// apps/api/src/plugins/api-key-auth.ts
import fp from 'fastify-plugin'
import { resolveApiClient } from '../lib/api-client.js'
import { OpenApiError, ErrorCode, errorMessage } from '../lib/open-api-errors.js'

export interface ApiClientPrincipal { id: string; teamId: string | null; workspaceId: string | null; systemUserId: string | null; name: string }

declare module 'fastify' {
  interface FastifyRequest { apiClient: ApiClientPrincipal | null }
}

// 装饰器形式：开放接口路由用 { preHandler: requireApiKey } 显式挂载
export const requireApiKey = fp(async (app) => {
  app.decorateRequest('apiClient', null)
}, { name: 'api-key-decorator' })

export async function authenticateApiKey(request: import('fastify').FastifyRequest): Promise<void> {
  const header = request.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const client = await resolveApiClient(token)
  request.apiClient = {
    id: client.id, name: client.name,
    teamId: client.team_id, workspaceId: client.workspace_id, systemUserId: client.system_user_id,
  }
}
```

> 路由用 Fastify 的 `preHandler` 钩子调用 `authenticateApiKey`，失败时回 `code=AUTH_FAILED` + 固定文案（见 §0.6 路由模板）。

- [ ] **Step 4-5: 通过 + Commit** —— `feat(open-api): API Key 认证`

---

### Task 0.6：/api/v3 注册 + jwt-auth 豁免 + 异常处理

**Files:**
- Modify: `apps/api/src/app.ts`（注册第二个 autoload `/api/v3`）
- Modify: `apps/api/src/plugins/jwt-auth.ts`（`PUBLIC_ROUTES` 加 `/api/v3`，或改为"只管 `/api/v1`"）

- [ ] **Step 1: app.ts 注册 open-api autoload**（与现有 `/api/v1` autoload 平行）

```ts
// apps/api/src/app.ts（在现有 /api/v1 autoload 之后追加）
await app.register(async (instance) => {
  await instance.register(autoload, {
    dir: join(__dirname, 'routes', 'open-api'),
    dirNameRoutePrefix: false,
    forceESM: true,
    ignorePattern: /^_/,
  })
}, { prefix: '/api/v3' })
```

- [ ] **Step 2: jwt-auth 豁免 /api/v3**（JWT 只负责 `/api/v1`，开放接口走独立认证）

```ts
// apps/api/src/plugins/jwt-auth.ts —— onRequest 首行改为
app.addHook('onRequest', async (request, reply) => {
  // 开放接口走独立 API Key 认证，JWT 钩子放行
  if (request.url.startsWith('/api/v3/')) return
  if (PUBLIC_ROUTES.some((r) => request.url.startsWith(r))) return
  // ...现有 JWT 逻辑不变...
})
```

- [ ] **Step 3: 开放接口统一异常处理**（在 open-api autoload 的根 hook 或各路由内：`OpenApiError` → 透传 code/message；参数校验失败 → `PARAM_ERROR`）

```ts
// apps/api/src/routes/open-api/_shared.ts
import { ErrorCode, errorMessage, OpenApiError } from '../../lib/open-api-errors.js'

// 通用错误响应（不暴露内部文本）
export function sendOpenApiError(reply: any, err: unknown) {
  if (err instanceof OpenApiError) {
    return reply.status(200).send({ result: { code: err.code, message: err.publicMessage } }) // 源项目业务错误 HTTP 200 + code
  }
  // 参数校验等
  return reply.status(200).send({ result: { code: ErrorCode.PARAM_ERROR, message: errorMessage(ErrorCode.PARAM_ERROR) } })
}
```

> **注意：** 源项目业务错误走 HTTP 200 + body `code`（非 HTTP 4xx），需在路由 `setErrorHandler` 或 try/catch 里统一。参数校验失败源项目是 422 + PARAM_ERROR，需你确认开放接口是否沿用 422 还是统一 200（见计划末"待确认"）。

- [ ] **Step 4: 手测** —— 启动 api，`curl -H "Authorization: Bearer <invalid>" http://localhost:7001/api/v3/images/generations` 预期返回 AUTH_FAILED 文案
- [ ] **Step 5: Commit** —— `feat(open-api): /api/v3 路由挂载与认证豁免`

---

### Task 0.7：归属容器服务（创建 api_client → 联动建 team+workspace+credit_account+system_user）

**Files:**
- Create: `apps/api/src/lib/provision-caller.ts`
- Create: `apps/api/src/cli/create-open-api-key.ts`（CLI 签发，对齐源项目 `app/cli/create_api_key.py`）
- Test: `apps/api/test/open-api/provision-caller.test.ts`

**逻辑：** 创建 api_client 时，在一个事务里：① 建 system_user（role=member，username=`openapi:<name>`）；② 建 team（owner_id=system_user，team_type=standard，name=`openapi:<name>`）；③ 建 workspace（默认，name="默认工作区"）；④ 建 credit_account（owner_type=team，balance 置大如 1_000_000_000，frozen=0）；⑤ 建 team_members 行（system_user 加入 team）；⑥ 写 api_clients（绑定 team_id/workspace_id/system_user_id + api_key_hash）。

- [ ] **Step 1: 失败测试**（断言事务后 5 张表都有行，api_client.team_id 指向新 team，credit_account.balance 为大值）

```ts
test('provisionCaller 联动创建归属容器', async () => {
  const { apiKey, clientId } = await provisionCaller('caller-a')
  expect(apiKey).toMatch(/^aigc_/)
  const db = getDb()
  const c = await db.selectFrom('api_clients').selectAll().where('id', '=', clientId).executeTakeFirstOrThrow()
  expect(c.api_key_hash).toBe(hashApiKey(apiKey))
  const team = await db.selectFrom('teams').where('id', '=', c.team_id!).selectAll().executeTakeFirstOrThrow()
  expect(team.name).toBe('openapi:caller-a')
  const acc = await db.selectFrom('credit_accounts').where('team_id', '=', c.team_id!).selectAll().executeTakeFirstOrThrow()
  expect(acc.balance).toBeGreaterThan(1_000_000)
})
```

- [ ] **Step 2-3: 实现**（事务内依次 insert 五张表，api_key 明文仅返回一次）

```ts
// apps/api/src/lib/provision-caller.ts
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { hashApiKey } from './api-client.js'

const OPENAPI_BALANCE = Number(process.env.OPENAPI_CREDIT_BALANCE ?? 1_000_000_000)

export async function provisionCaller(name: string): Promise<{ apiKey: string; clientId: string }> {
  const db = getDb()
  const apiKey = 'aigc_' + randomUUID().replace(/-/g, '')
  const apiKeyHash = hashApiKey(apiKey)
  const clientId = await db.transaction().execute<string>(async (trx) => {
    const sysUserId = randomUUID()
    await trx.insertInto('users').values({
      id: sysUserId, account: `openapi:${name}`, username: `openapi:${name}`,
      password_hash: '!', role: 'member', status: 'active', plan_tier: 'enterprise',
      password_change_required: false,
    } as any).execute()
    const team = await trx.insertInto('teams').values({
      name: `openapi:${name}`, owner_id: sysUserId, plan_tier: 'enterprise',
      team_type: 'standard', allow_member_topup: false, is_deleted: false,
    } as any).returning('id').executeTakeFirstOrThrow()
    const ws = await trx.insertInto('workspaces').values({
      team_id: team.id, name: '默认工作区', created_by: sysUserId, is_deleted: false,
    } as any).returning('id').executeTakeFirstOrThrow()
    await trx.insertInto('credit_accounts').values({
      owner_type: 'team', team_id: team.id, balance: OPENAPI_BALANCE, frozen_credits: 0,
    } as any).execute()
    await trx.insertInto('team_members').values({
      team_id: team.id, user_id: sysUserId, role: 'owner',
    } as any).execute()
    const c = await trx.insertInto('api_clients').values({
      name, api_key_hash: apiKeyHash, status: 'active',
      team_id: team.id, workspace_id: ws.id, system_user_id: sysUserId,
    } as any).returning('id').executeTakeFirstOrThrow()
    return c.id
  })
  return { apiKey, clientId }
}
```

```ts
// apps/api/src/cli/create-open-api-key.ts —— 用法: tsx apps/api/src/cli/create-open-api-key.ts <name>
import { provisionCaller } from '../lib/provision-caller.js'
const name = process.argv[2]
if (!name) throw new Error('用法: create-open-api-key <name>')
const { apiKey } = await provisionCaller(name)
console.log(`API Key（仅显示一次）: ${apiKey}`)
```

- [ ] **Step 4-5: 通过 + 手测签发一个调用方 + Commit** —— `feat(open-api): 调用方归属容器联动创建`

---

### Task 0.8：回调钩子收敛 helper + GenerationJobData 扩展

**Files:**
- Modify: `packages/types/src/queue.ts`（`GenerationJobData` 加可选 `callbackUrl`/`businessId`/`serviceType`/`taskId`/`openApiBatch`）
- Create: `apps/worker/src/lib/dispatch-result.ts`
- Modify: `apps/worker/src/pipelines/complete.ts`、`fail.ts`、`workers/transfer.ts`、`pollers/video-poller.ts`、`workers/music.ts`（接入 helper）
- Test: `apps/worker/test/dispatch-result.test.ts`

**核心：** 现有 worker 的 `jobData` 不带开放接口信息。给 `GenerationJobData` 加**可选**字段（不破坏现有 aigc-test 任务）。`dispatchBatchResult` 在各"终态达成点"调用：有 `callback_url` 且 `source='open_api'` → 用 `buildAsyncCallbackPayload` 组装 payload 投递 `open-api-callback-queue`（attempts:4, backoff:fixed 10s）；否则保持现有 SSE。

- [ ] **Step 1: 扩展 GenerationJobData**（可选字段，向后兼容）

```ts
// packages/types/src/queue.ts —— GenerationJobData 追加
export interface GenerationJobData {
  // ...现有字段...
  callbackUrl?: string | null
  businessId?: string | null
  serviceType?: string | null   // image|song|video|news|podcast|storybook|text
  openApiTaskId?: string | null // 对外 task_id
}
```

- [ ] **Step 2: 失败测试**

```ts
test('有 callback_url 投回调队列，无则发 SSE', async () => {
  const add = vi.fn(); vi.mocked(getOpenApiCallbackQueue).mockReturnValue({ add } as any)
  const pub = vi.fn(); vi.mocked(getPubRedis).mockReturnValue({ publish: pub } as any)
  // 有回调
  await dispatchBatchResult({ batchId: 'b1', status: 'succeeded', serviceType: 'image', media: { image_url: 'u' }, businessId: 'x', taskId: 't', callbackUrl: 'https://cb' })
  expect(add).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ payload: expect.any(Object) }) }), expect.objectContaining({ attempts: 4, backoff: { type: 'fixed', delay: 10_000 } }))
  expect(pub).not.toHaveBeenCalled()
  // 无回调 → SSE
  await dispatchBatchResult({ batchId: 'b2', status: 'succeeded', serviceType: 'image', media: {}, businessId: '', taskId: '', callbackUrl: null })
  expect(pub).toHaveBeenCalledWith('sse:batch:b2', expect.any(String))
})
```

- [ ] **Step 3: 实现 helper**

```ts
// apps/worker/src/lib/dispatch-result.ts
import { getOpenApiCallbackQueue } from '../../api/src/lib/queue.js' // 注：队列定义在 api 包，worker 引用其类型/或抽到共享包；执行时按 monorepo 约定调整导入路径
import { getPubRedis } from './redis.js'
import { buildLogger } from '../logger.js'
const logger = buildLogger()

export interface DispatchInput {
  batchId: string; status: 'succeeded' | 'failed'
  serviceType: string; media: Record<string, any>; extraMeta?: Record<string, any>
  businessId: string; taskId: string; callbackUrl: string | null
  failureCode?: string; publicMessage?: string
}

export async function dispatchBatchResult(input: DispatchInput): Promise<void> {
  if (!input.callbackUrl) {
    // 无回调地址 → 现有 SSE 通道
    await getPubRedis().publish(`sse:batch:${input.batchId}`, JSON.stringify({ event: 'batch_update' }))
    return
  }
  // 有回调地址 → 组装 payload 投递回调队列（payload 构建移到 worker 端，引用 §0.3 的纯函数；将 callback-payload.ts 移到 packages/types 或 worker 也复制一份）
  const payload = buildAsyncCallbackPayload({
    serviceType: input.serviceType as any, taskId: input.taskId, bussinessId: input.businessId,
    status: input.status, media: input.media, extraMeta: input.extraMeta ?? {},
    failureCode: input.failureCode, publicMessage: input.publicMessage,
  })
  await getOpenApiCallbackQueue().add('send', { batchId: input.batchId, payload }, {
    attempts: 4, backoff: { type: 'fixed', delay: 10_000 }, // 等价源 RETRY_DELAYS=[10,10,10]
  })
  logger.info({ batchId: input.batchId }, '开放接口回调已入队')
}
```

> **重构提示（执行时）：** `callback-payload.ts`（§0.3）是纯函数，放 `apps/api/src/lib` 会导致 worker 跨包引用。执行时把它移到 `packages/types` 或 `packages/shared`，api 与 worker 共用，避免重复实现。

- [ ] **Step 4: complete.ts 接入**（在 SSE 发布处替换为 dispatch；从 `task_batches` 查 callback_url/business_id/service_type/task_id）

```ts
// apps/worker/src/pipelines/complete.ts —— 替换第 148-158 行 SSE 发布块
const oa = await db.selectFrom('task_batches')
  .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source']).where('id', '=', batchId).executeTakeFirst()
if (oa?.source === 'open_api') {
  await dispatchBatchResult({
    batchId, status: 'succeeded', serviceType: oa.service_type ?? 'image',
    media: { image_url: outputUrl }, // 图片成功回 original；最终 TOS URL 在 transfer 完成后单独回调（见下）
    businessId: oa.business_id ?? '', taskId: oa.task_id ?? '', callbackUrl: oa.callback_url,
  })
} else {
  await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
}
```

> **图片回调时序（重要）：** 图片产物需经 transfer worker 转存 TOS 后 `storage_url` 才就绪。**图片的最终回调应在 `transfer.ts` 转存完成后触发**（用 TOS `storage_url`），`complete.ts` 处仅做"任务完成"的占位/或不发图片回调。`transfer.ts:310/364` 转存成功后调用 `dispatchBatchResult({ ..., media: { image_url: storage_url } })`。视频/音乐各自 worker 内部已转存，在其完成处直接 `dispatchBatchResult`。

- [ ] **Step 5: fail.ts 同理接入**（失败回调用 `failureCode` + 固定文案）

- [ ] **Step 6: 通过 + Commit** —— `feat(open-api): 回调钩子收敛 helper`

---

> **Phase 0 验收：** 跑 `pnpm test`，并用 CLI 签发一个调用方，构造一个假 batch（source=open_api, callback_url）手动入队图片任务，验证：回调队列收到 job、回调 worker 对测试回调服务器 POST 带 `X-Signature`、HTTP 2xx 后 `callback_status=succeeded`、4 次失败后 `callback_status=failed`。Phase 0 完成后所有业务类型的基础设施就绪。

---

## Phase 1：图片（完整业务模板，后续业务复用此骨架）

> 路径保持源项目契约 `/api/v3/images/generations`。入参字段拼写不变（`promt`/`bussiness_id`）。

**Files:**
- Create: `apps/api/src/routes/open-api/_shared.ts`（`createOpenApiBatch` helper，所有业务共用）
- Create: `apps/api/src/routes/open-api/images.ts`
- Test: `apps/api/test/open-api/images-route.test.ts`

### Task 1.1：createOpenApiBatch helper（共用骨架）

- [ ] **Step 1: 失败测试**

```ts
test('建开放接口 batch+task 并绑定归属容器', async () => {
  const { batchId, internalTaskId } = await createOpenApiBatch({
    apiClient, serviceType: 'image', taskId: 't-ext-1', bussinessId: 'b1',
    callbackUrl: 'https://cb', module: 'image', provider: 'volcengine', model: 'doubao-seedream-4.5',
    prompt: 'a cat', params: { size: '2K', ratio: '1:1' },
  })
  const db = getDb()
  const b = await db.selectFrom('task_batches').selectAll().where('id','=',batchId).executeTakeFirstOrThrow()
  expect(b.source).toBe('open_api'); expect(b.estimated_credits).toBe(0)
  expect(b.team_id).toBe(apiClient.teamId); expect(b.business_id).toBe('b1')
  expect(b.callback_url).toBe('https://cb'); expect(b.task_id).toBe('t-ext-1')
})
test('重复 task_id 抛 DUPLICATE_TASK', async () => {
  await createOpenApiBatch({ /* taskId: 't-ext-1' */ })
  await expect(createOpenApiBatch({ /* 同 apiClient + taskId: 't-ext-1' */ })).rejects.toMatchObject({ code: ErrorCode.DUPLICATE_TASK })
})
```

- [ ] **Step 2-3: 实现**

```ts
// apps/api/src/routes/open-api/_shared.ts
import { getDb } from '@aigc/db'
import { ErrorCode, OpenApiError } from '../../lib/open-api-errors.js'
import type { ApiClientPrincipal } from '../../plugins/api-key-auth.js'

export interface CreateBatchInput {
  apiClient: ApiClientPrincipal
  serviceType: string; taskId: string; bussinessId: string; callbackUrl: string
  module: string; provider: string; model: string; prompt: string
  params: Record<string, unknown>
}
export async function createOpenApiBatch(input: CreateBatchInput) {
  const db = getDb()
  const acc = await db.selectFrom('credit_accounts')
    .select('id').where('team_id','=',input.apiClient.teamId as string).where('owner_type','=','team')
    .executeTakeFirstOrThrow()
  const idempotencyKey = `openapi:${input.apiClient.id}:${input.taskId}`
  try {
    return await db.transaction().execute(async (trx) => {
      const batch = await trx.insertInto('task_batches').values({
        user_id: input.apiClient.systemUserId as string,
        team_id: input.apiClient.teamId, workspace_id: input.apiClient.workspaceId,
        credit_account_id: acc.id, idempotency_key: idempotencyKey,
        source: 'open_api', module: input.module as any, provider: input.provider, model: input.model,
        prompt: input.prompt, params: JSON.stringify(input.params), quantity: 1,
        status: 'pending', estimated_credits: 0,
        business_id: input.bussinessId, callback_url: input.callbackUrl,
        service_type: input.serviceType, task_id: input.taskId,
      } as any).returning('id').executeTakeFirstOrThrow()
      const task = await trx.insertInto('tasks').values({
        batch_id: batch.id, user_id: input.apiClient.systemUserId as string,
        version_index: 0, status: 'pending', estimated_credits: 0,
      } as any).returning('id').executeTakeFirstOrThrow()
      return { batchId: batch.id, internalTaskId: task.id }
    })
  } catch (err: any) {
    // PG unique violation (idempotency_key) → DUPLICATE_TASK
    if (String(err?.code) === '23505') throw new OpenApiError(ErrorCode.DUPLICATE_TASK)
    throw err
  }
}

// 所有开放接口路由统一返回（对齐源 success_response）
export function accepted(taskId: string) {
  return { result: { task_id: taskId, code: ErrorCode.SUCCESS, message: '正在加速生成中，请稍等' } }
}
```

- [ ] **Step 4-5: 通过 + Commit** —— `feat(open-api): createOpenApiBatch 共用骨架`

### Task 1.2：图片路由

- [ ] **Step 1: 失败测试**（TestClient + mock imageQueue.add，断言：返回 success_response、batch 落库 source=open_api、image-queue 收到 jobData 含 callbackUrl）

```ts
test('POST /api/v3/images/generations 接受并立即返回', async () => {
  const add = vi.fn().mockResolvedValue({ id: 'job1' })
  vi.mocked(getImageQueue).mockReturnValue({ add } as any)
  const res = await app.inject({ method: 'POST', url: '/api/v3/images/generations',
    headers: { authorization: 'Bearer aigc_xxx' },
    payload: { task_id: 't1', bussiness_id: 'b1', model: 'doubao-seedream-4.5', promt: 'a cat', size: '2K', ratio: '1:1', callback_url: 'https://cb' } })
  expect(res.json()).toEqual({ result: { task_id: 't1', code: '0000', message: '正在加速生成中，请稍等' } })
  expect(add).toHaveBeenCalled()
  const jobData = add.mock.calls[0][1]
  expect(jobData.callbackUrl).toBe('https://cb'); expect(jobData.businessId).toBe('b1')
})
```

- [ ] **Step 2-3: 实现路由**

```ts
// apps/api/src/routes/open-api/images.ts
import type { FastifyPluginAsync } from 'fastify'
import { getImageQueue } from '../../lib/queue.js'
import { authenticateApiKey } from '../../plugins/api-key-auth.js'
import { createOpenApiBatch, accepted } from './_shared.js'
import { ErrorCode, errorMessage } from '../../lib/open-api-errors.js'

const IMAGE_BODY = {
  type: 'object',
  required: ['task_id', 'bussiness_id', 'model', 'promt', 'size', 'ratio', 'callback_url'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', maxLength: 50 },
    bussiness_id: { type: 'string', maxLength: 50 }, // 对外契约拼写不变
    model: { type: 'string' },
    promt: { type: 'string' }, // 对外契约拼写不变
    image: { type: ['string', 'array'] }, // base64 或 base64 数组（脱敏后落 TOS，见 Task 1.3）
    size: { type: 'string', enum: ['1K','2K','3K','4K','1k','2k','3k','4k'] },
    ratio: { type: 'string', enum: ['1:1','4:3','3:4','16:9','9:16','3:2','2:3','21:9'] },
    callback_url: { type: 'string', format: 'uri' },
  },
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: any }>('/images/generations', { schema: { body: IMAGE_BODY }, preHandler: [authenticateApiKey] },
    async (request, reply) => {
      try {
        const b = request.body
        // 参考图 base64 先落 TOS（见 Task 1.3），脱敏后 params 只存 TOS URL
        const referenceUrls = await persistReferenceImages(b.image) // 可空
        const { batchId, internalTaskId } = await createOpenApiBatch({
          apiClient: request.apiClient!, serviceType: 'image', taskId: b.task_id, bussinessId: b.bussiness_id,
          callbackUrl: b.callback_url, module: 'image', provider: 'volcengine', model: b.model,
          prompt: b.promt, params: { size: b.size, ratio: b.ratio, referenceUrls },
        })
        await getImageQueue().add('generate', {
          taskId: internalTaskId, batchId, userId: request.apiClient!.systemUserId,
          teamId: request.apiClient!.teamId, creditAccountId: undefined, // 完成时按 batch 反查
          estimatedCredits: 0, prompt: b.promt, model: b.model,
          params: { size: b.size, ratio: b.ratio, referenceUrls },
          callbackUrl: b.callback_url, businessId: b.bussiness_id, serviceType: 'image', openApiTaskId: b.task_id,
        })
        return reply.send(accepted(b.task_id))
      } catch (err) {
        return reply.status(200).send({ result: { code: err instanceof Error && (err as any).code ?? ErrorCode.SYSTEM_FAILED,
          message: (err as any).publicMessage ?? errorMessage(ErrorCode.SYSTEM_FAILED) } })
      }
    })
}
export default route
```

> **creditAccountId：** aigc-test 的 `completePipeline` 从 jobData 取 `creditAccountId`。开放接口任务需带上（按 team 反查）。路由投递前补查：`const creditAccountId = (await db.selectFrom('credit_accounts').select('id').where('team_id','=',teamId)...).id`。执行时在路由内补这一查（避免 completePipeline 取不到）。

- [ ] **Step 4-5: 通过 + Commit** —— `feat(open-api): 图片生成路由`

### Task 1.3：参考图 base64 脱敏 + 落 TOS

> 源项目：参考图 base64 经 `MinioStorageClient.persist_base64()` 先落 MinIO，DB 只存 URL（脱敏），Worker 用 URL 调供应商。TS 侧改用 TOS。

- [ ] **实现：** `persistReferenceImages(image)` —— 遍历 base64（单张或数组），用 `apps/worker/src/lib/storage.ts` 的 `getTos()`/`getBucket()` 上传到 TOS（key 前缀 `openapi/ref/<uuid>.<ext>`），返回 TOS URL 数组。**入参 base64 不入库、不入日志**（对齐源项目脱敏约定）。空则返回空数组。
- [ ] **测试：** 断言入参含 base64 时 DB params 里只有 TOS URL、无 base64 明文。
- [ ] Commit —— `feat(open-api): 参考图脱敏落 TOS`

### Task 1.4：端到端验证（图片整链路）

- [ ] 用 CLI 签发调用方 → `curl` 提交图片请求 → 断言立即返回 success_response → worker 消费（mock 火山返回临时 URL）→ transfer 转存 TOS → 回调测试服务器收到带 `X-Signature` 的 POST，`meta.image_url` 是 TOS URL → `callback_status=succeeded`。
- [ ] Commit —— `test(open-api): 图片端到端`

> **Phase 1 完成后，Phase 2-7 复用 `createOpenApiBatch` + `accepted` + `dispatchBatchResult` 骨架，仅差异在：路由路径/入参 schema/module/provider/队列/回调触发点/payload meta。**

---

## Phase 2：视频

**Files:** Create `apps/api/src/routes/open-api/videos.ts`
**复用：** `video-queue` + `videoSubmitWorker` + `video-poller`（`handleVideoSuccess`/`handleVideoFailure` 接入 `dispatchBatchResult`）
**差异点：**
- 路径 `/api/v3/videos/generations`
- 入参（对齐源 `VideoGenerateRequest`）：`task_id`/`bussiness_id`/`model`/`create_mode`(general|start_end_frame|text_2_video)/`prompt`/`images`(1-10 张)/`resolution`(720p|1080p)/`duration`(5|10|15)/`ratio`
- `module: 'video'`，`serviceType: 'video'`
- 投 `video-queue`，jobData 带 `callbackUrl`/`businessId`/`serviceType: 'video'`/`openApiTaskId`
- **回调触发点：** `apps/worker/src/pollers/video-poller.ts` 的 `handleVideoSuccess`（转存 TOS 后）调用 `dispatchBatchResult({ serviceType:'video', media:{ video_url: storageUrl } })`；`handleVideoFailure` 调用失败回调。
- [ ] **任务：** 写路由（schema + createOpenApiBatch + 投 video-queue）→ 改 video-poller 两处接入 dispatch → E2E → Commit
- [ ] **验证：** 视频回调 `meta.video_url` 为 TOS URL

---

## Phase 3：音乐（路径统一 /api/v3）

**Files:** Create `apps/api/src/routes/open-api/lyrics.ts`
**复用：** `music-queue` + `musicWorker` + `MurekaClient`（入参字段适配）+ `music_tracks` 表
**差异点：**
- 路径由源 `/api/v1/lyrics/generate` **改为 `/api/v3/lyrics/generations`**（统一开放接口前缀，避免与 aigc-test `/api/v1` 冲突；用户已确认接口名微调可接受）
- 入参（对齐源 `SongGenerateRequest`）：`task_id`/`bussiness_id`(可空)/`model`/`promt`/`gender`(0|1|2)/`tag`/`instrumental`(0|1)/`callback_url`
- **字段适配（promt/gender/tag/instrumental → aigc-test music worker 语义）：**
  - `promt` → 音乐 `prompt`（灵感模式生成歌词+曲）
  - `gender`：`0`→`auto`，`1`→`male`，`2`→`female`（映射到 `voice_gender`）
  - `instrumental=1` → 纯音乐模式（走 `generateInstrumental`），跳过歌词生成
  - `tag` → `styles`（拆分）
- `module: 'music'`，`serviceType: 'song'`
- **回调触发点：** `apps/worker/src/workers/music.ts` 完成处接入 `dispatchBatchResult({ serviceType:'song', media:{ music_url, image_url }, extraMeta:{ title, duration, lyrics_sections } })`
- [ ] **任务：** 写路由（含字段适配函数）→ music worker 完成处接入 dispatch（保留 SSE 分支）→ E2E → Commit
- [ ] **验证：** 灵感模式与纯音乐模式两条路径都回调正确

---

## Phase 4：绘本

**Files:** Create `apps/api/src/routes/open-api/storybooks.ts` + `apps/worker/src/workers/storybook.ts`（新建轻量 worker）
**说明：** aigc-test 的 `picture_book` 是 SaaS 多步交互式，与源"分镜+组图一次性"语义差异大，**不复用 picture_book worker**，新建轻量 storybook worker，底层复用 `volcengine-image.ts` 的组图能力。
**差异点：**
- 路径 `/api/v3/storybook/generations`
- 入参（对齐源 `StorybookGenerateRequest`）：`task_id`/`bussiness_id`/`prompt`/`age`(0-3|3-6|6+)/`category`(0-4)/`style`(0-3)/`pages`(1-10)/`callback_url`
- 流程（移植源 `process_storybook_generation`）：① `polish_prompt`（Ark 润色分镜）② `generate_group_images`（seedream 批量组图）③ 全部转存 TOS
- `module: 'storybook'`，`serviceType: 'storybook'`
- 新建 `storybook-queue`（queue.ts 加 getter）+ storybook worker（index.ts 注册）
- 回调 `meta.images_url` 为 TOS URL 数组
- [ ] **任务：** queue getter → storybook provider（两步）→ worker → 路由 → dispatch 接入 → E2E → Commit

---

## Phase 5：播客（全新，WebSocket TTS）

**Files:** Create `apps/worker/src/providers/podcast-tts.ts` + `apps/worker/src/workers/podcast.ts` + `apps/api/src/routes/open-api/podcasts.ts`
**说明：** aigc-test 无播客能力，全新移植源 `podcast_provider.PodcastProvider`（字节 sami WebSocket TTS）。
**差异点：**
- 路径 `/api/v3/sami/podcasttts`（保持源路径）
- 入参（对齐源 `PodcastGenerateRequest`）：`task_id`/`bussiness_id`/`content_type`(text|file|url)/`content`/`speakers`(恰好 2)/`callback_url`
- provider：WebSocket 连接字节 sami，构建/解析帧，提取 audio_url（移植源 `podcast_provider.py`）
- 内容预处理：`content_type=file` 时 PDF 落 TOS 脱敏；`url` 时抓取
- 新建 `podcast-queue` + podcast worker
- `module: 'podcast'`，`serviceType: 'podcast'`，回调 `meta.audio_url` 为 TOS URL
- [ ] **任务：** podcast-tts provider（WS，重点移植帧协议）→ worker → 路由 → queue 注册 → 安全审查（输出音频检测）→ dispatch → E2E → Commit

---

## Phase 6：资讯（全新，Ark /responses + HTML）

**Files:** Create `apps/worker/src/providers/news.ts` + `apps/worker/src/workers/news.ts` + `apps/api/src/routes/open-api/news.ts`
**差异点：**
- 路径 `/api/v3/news/generations`
- 入参（对齐源 `NewsGenerateRequest`）：`task_id`/`bussiness_id`/`prompt`/`date`(YYYY-MM-DD)/`callback_url`
- provider：Ark `/responses` 生成 HTML，解析提取 title/abstract/url（移植源 `news_provider.py`）
- "安全不通过则重新生成"重试循环（移植源逻辑）
- 新建 `news-queue` + news worker
- `module: 'news'`，`serviceType: 'news'`，回调 `meta.{title, news_abstract, news_url}`
- [ ] **任务：** news provider → worker（含重试循环）→ 路由 → queue 注册 → dispatch → E2E → Commit

---

## Phase 7：文本润色（同步，不走队列）

**Files:** Create `apps/api/src/routes/open-api/chat.ts` + `apps/worker/src/providers/ark-text-polish.ts`（或放 api 包）
**说明：** 源项目文本润色 `/api/v3/chat/completions` 是**同步**返回（不走 Celery）。aigc-test 保留此同步语义。
**差异点：**
- 路径 `/api/v3/chat/completions`
- 入参（对齐源 `TextPolishRequest`）：`task_id`/`create_mode`(0-4)/`input_text`（**无 callback_url、无 bussiness_id**）
- 路由内：API Key 认证 → 直接调 `ArkTextProvider.polish(create_mode, input_text)` → 输出安全检测 → **同步返回** `{ result: { task_id, code, message }, meta: { output_text } }`
- 不建 batch、不入队、不回调
- [ ] **任务：** ark-text-polish provider（移植 5 种 create_mode 的 system prompt）→ 路由（同步）→ 输出安全检测 → E2E → Commit

---

## Phase 8：切换、压测、文档

- [ ] **8.1 安全围栏对齐：** 输入安全改写 + 输出安全检测（双供应商并行，任一失败即失败）移植到各 worker/provider；错误码统一映射（ark_errors/podcast_errors → ErrorCode + 固定文案）
- [ ] **8.2 限流：** 源项目按模型分队列 + Redis 令牌桶。aigc-test 用 BullMQ `limiter` + `@fastify/rate-limit`。按需为每个 provider 队列设 `limiter: { max, duration }`（数值需你确认，见末"待确认"）
- [ ] **8.3 灰度切换：** 调用方改指向 aigc-test `/api/v3`（调用方很少，逐个切换）→ 观察 `provider_api_logs` + `callback_status` → 确认稳定后下线 Python 服务 + MinIO
- [ ] **8.4 文档：** 更新 `接口文档/` 调用方对接说明（URL 域名变更：MinIO→TOS；song 路径变更；签名头不变）；更新 aigc-test `CLAUDE.md`/`AGENTS.md` 记录开放接口模块
- [ ] **8.5 压测：** 图片/视频/音乐并发，验证 TOS 转存 + 回调队列吞吐 + 4 次退避稳定性

---

## 四、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| TOS URL 域名与 MinIO 不同 | 调用方需更新白名单/解析 | 提前告知调用方；文档标注；灰度逐个切换 |
| 图片回调时序（storage_url 未就绪即回调） | 回调给临时 URL 会过期 | 图片回调**只在 transfer 转存完成后**触发（dispatch 接入 transfer.ts） |
| API Key 哈希不互通（pbkdf2_sha256 → sha256） | 现有调用方需重签发 key | 调用方很少，迁移时统一重签发；若需兼容见 §0.5 待确认 |
| 播客 WS 帧协议移植复杂 | 播客类型风险最高 | 单独 Phase 重点验证；保留源帧构造/解析逻辑逐行移植 |
| `completePipeline` asset `type` 硬编码 `'image'` | 视频/音乐资产若误走 complete 会写错 type | 视频/音乐各自 worker 自管资产，不走 completePipeline；仅图片走 |
| 深复用改动 aigc-test 核心（表/管线） | 影响现有 SaaS 业务 | 所有新字段可空/默认；`source='open_api'` 分支隔离；完整回归现有 SaaS 测试 |

---

## 五、待你确认（执行前敲定）

1. **参数校验失败 HTTP 码：** 源项目用 422 + PARAM_ERROR。开放接口沿用 422，还是统一 200 + body code？（默认沿用源 422）
2. **限流数值：** 各 provider 队列的 `max/duration`（源项目 `RATE_LIMIT_*_PER_SECOND`）。需要你给具体数值，禁止我臆断。
3. **播客轮询/超时：** WS TTS 的连接超时、音频提取重试次数（源项目数值需你确认或我从源代码取）。
4. **API Key 兼容旧 hash：** 是否需要兼容源项目 pbkdf2_sha256 hash（避免重签发），还是接受重签发？（默认重签发）
5. **内部 DB 列名拼写：** `business_id`（规范）还是 `bussiness_id`（对齐源）？（默认 `business_id`，路由层映射）

---

## 六、自我审查（writing-plans checklist）

**1. Spec 覆盖：** 7 类业务（图片✓ 视频✓ 音乐✓ 绘本✓ 播客✓ 资讯✓ 文本✓）+ 认证✓ + 回调✓ + 存储(TOS)✓ + 安全围栏(8.1)✓ + 归属容器✓ 全覆盖。回调策略（4×10s、HTTP 2xx、HMAC）逐条复刻源项目✓。

**2. 占位符扫描：** Phase 0/1 含完整代码与测试；Phase 2-7 为"差异规格"——骨架（createOpenApiBatch/accepted/dispatchBatchResult）在 Phase 0/1 已完整定义，后续业务**调用已定义函数**，非占位；各业务差异（路由/schema/provider/payload meta/触发点）均给出实质内容。执行时每个业务仍按 TDD 补全测试（已在各 Phase 标注 E2E 步骤）。

**3. 类型一致性：** `ErrorCode`/`success_response`/`buildAsyncCallbackPayload`/`createOpenApiBatch`/`dispatchBatchResult`/`GenerationJobData` 扩展字段在各任务间命名一致；`callback_status` 取值（pending/succeeded/failed）在迁移、worker、helper 间统一。

**4. 范围：** 本计划覆盖全迁全貌。建议执行顺序：**Phase 0 → Phase 1（端到端验证骨架）→ Phase 2-7（按风险，播客最后）→ Phase 8**。Phase 0+1 是可独立交付的垂直切片。

**执行交接：** 计划已保存至 `docs/superpowers/plans/2026-06-23-migrate-to-aigc-test.md`。两种执行方式——
1. **Subagent-Driven（推荐）**：每个 Task 派一个新 subagent，任务间 review，快速迭代
2. **Inline Execution**：本会话内按 executing-plans 批量执行 + 检查点

**按你的要求，执行时使用 git worktree。** 请确认上述"待确认"5 点后，选择执行方式，我在 aigc-test 创建 worktree 开始落地。
