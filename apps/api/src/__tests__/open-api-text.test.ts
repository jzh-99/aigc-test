// 必须在 import 拉入 db 之前加载 .env（ESM 按源码顺序实例化 side-effect import）
import '../lib/test-env.js'

// 开放接口文本润色路由测试（Phase 7，同步链路）。
//
// 测试搭建（对齐 news.test.ts）：
//   - 真实库（provisionCaller 建调用方 + 归属容器，拿明文 apiKey 做 Bearer）
//   - Fastify 最小实例：autoload open-api 路由 + requireApiKey + scoped setErrorHandler
//   - mock globalThis.fetch：拦截 polishText 的 Ark /chat/completions 调用（不真实联网）
//   - after：清理 tasks/task_batches + provisionCaller 归属容器
//
// 红线验证：
//   1. 合法请求 → 200 + successResponse + meta.output_text + task=completed
//   2. create_mode 非法枚举 → 422
//   3. 缺 input_text → 422
//   4. 无 Authorization → 401
//   5. 重复 task_id → 200 + DUPLICATE_TASK + meta:{}
//   6. Ark 失败 → 200 + EXTERNAL_SERVICE_FAILED + meta.output_text=""
//   7. DOUBAO_API_KEY 缺失 → 400 + MODEL_CONFIG_ERROR（对齐源 HTTPException(400)）
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import autoload from '@fastify/autoload'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { closeDb, getDb } from '@aigc/db'

import { requireApiKey } from '../plugins/api-key-auth.js'
import { sendOpenApiError } from '../routes/open-api/_shared.js'
import { ErrorCode } from '../lib/open-api-errors.js'
import { provisionCaller } from '../lib/provision-caller.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── mock globalThis.fetch（拦截 Ark /chat/completions）─────────────────────────
const originalFetch = globalThis.fetch

interface FetchCall {
  url: string
  body: unknown
}
let fetchCalls: FetchCall[] = []

function installFetchMock(responses: Array<{ body: unknown; ok?: boolean; status?: number }>): void {
  fetchCalls = []
  const queue = responses.map((r) => ({ body: r.body, ok: r.ok ?? true, status: r.status ?? 200 }))
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    fetchCalls.push({
      url: typeof _input === 'string' ? _input : _input.toString(),
      body,
    })
    const next = queue.shift() ?? { body: { choices: [{ message: { content: '默认润色结果' } }] }, ok: true, status: 200 }
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as Response
  }) as typeof globalThis.fetch
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

const createdNames: string[] = []
const createdBatchIds: string[] = []

let app: Fastify.FastifyInstance
let savedArkKey: string | undefined

async function buildTestApp() {
  const instance = Fastify({ logger: false })
  await instance.register(requireApiKey)
  instance.setErrorHandler((err, _req, reply) => {
    sendOpenApiError(reply, err)
  })
  await instance.register(autoload, {
    dir: join(__dirname, '../routes/open-api'),
    dirNameRoutePrefix: false,
    forceESM: true,
    autoHooks: false,
    cascadeHooks: false,
    ignorePattern: /(^_|\.test\.ts$)/,
  })
  await instance.ready()
  return instance
}

async function cleanup() {
  const db = getDb()

  if (createdBatchIds.length > 0) {
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('tasks').where('batch_id', 'in', createdBatchIds).execute()
      await trx.deleteFrom('task_batches').where('id', 'in', createdBatchIds).execute()
    })
  }

  if (createdNames.length === 0) return
  const teamNames = createdNames.map((n) => `openapi:${n}`)
  const teams = await db
    .selectFrom('teams')
    .select(['id', 'owner_id'])
    .where('name', 'in', teamNames)
    .execute()
  const teamIds = teams.map((t) => t.id)
  const userIds = teams.map((t) => t.owner_id)

  const acctIds = teamIds.length
    ? (
        await db
          .selectFrom('credit_accounts')
          .select('id')
          .where('team_id', 'in', teamIds)
          .execute()
      ).map((r) => r.id)
    : []

  await db.transaction().execute(async (trx) => {
    if (teamIds.length > 0) {
      await trx.deleteFrom('api_clients').where('team_id', 'in', teamIds).execute()
      if (acctIds.length > 0) {
        await trx.deleteFrom('credits_ledger').where('credit_account_id', 'in', acctIds).execute()
      }
      await trx.deleteFrom('credit_accounts').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('team_members').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('workspaces').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('teams').where('id', 'in', teamIds).execute()
    }
    if (userIds.length > 0) {
      await trx.deleteFrom('users').where('id', 'in', userIds).execute()
    }
  })
}

function uniqueName(label: string): string {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `test:${label}:${tag}`
}

// 合法请求体模板（对齐源 TextPolishRequest 必填字段）
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    create_mode: '1',
    input_text: '一只在月光下的猫',
    ...overrides,
  }
}

describe('POST /api/v3/chat/completions（文本润色，同步链路）', () => {
  before(async () => {
    // 文本润色路由检查 process.env.DOUBAO_API_KEY，测试环境兜底设值
    savedArkKey = process.env.DOUBAO_API_KEY
    process.env.DOUBAO_API_KEY = 'test-ark-key'
    app = await buildTestApp()
  })

  after(async () => {
    await app.close()
    restoreFetch()
    process.env.DOUBAO_API_KEY = savedArkKey
    await cleanup()
    await closeDb()
  })

  test('合法请求 → 200 + meta.output_text + task=completed', async () => {
    installFetchMock([{ body: { choices: [{ message: { content: '润色后的画面感提示词' } }] } }])
    try {
      const name = uniqueName('text-ok')
      createdNames.push(name)
      const { apiKey } = await provisionCaller(name)
      const taskId = `task-text-${Date.now()}`
      const body = validBody({ task_id: taskId })

      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: body,
      })

      assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
      const json = res.json() as { result: { task_id: string; code: string }; meta: { output_text: string } }
      assert.equal(json.result.task_id, taskId)
      assert.equal(json.result.code, ErrorCode.SUCCESS)
      assert.equal(json.meta.output_text, '润色后的画面感提示词')

      // 验证调用了 Ark /chat/completions
      assert.equal(fetchCalls.length, 1)
      assert.ok(fetchCalls[0].url.includes('/chat/completions'))

      // 验证 task_batches 落库（同步链路 source=open_api / service_type=text / module=text）
      const db = getDb()
      const batch = await db
        .selectFrom('task_batches')
        .selectAll()
        .where('task_id', '=', taskId)
        .executeTakeFirstOrThrow()
      createdBatchIds.push(batch.id)
      assert.equal(batch.source, 'open_api')
      assert.equal(batch.service_type, 'text')
      assert.equal(batch.module, 'text')
      assert.equal(batch.provider, 'ark')
      // 同步链路 callback_url 为空
      assert.ok(!batch.callback_url || batch.callback_url === '')

      // 验证 task 状态流转为 completed（同步链路无 processing 中间态）
      const task = await db
        .selectFrom('tasks')
        .select(['status', 'credits_cost'])
        .where('batch_id', '=', batch.id)
        .executeTakeFirstOrThrow()
      assert.equal(task.status, 'completed')
      assert.equal(task.credits_cost, 0)
    } finally {
      restoreFetch()
    }
  })

  test('create_mode 非法枚举 → 422', async () => {
    const name = uniqueName('text-mode')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ create_mode: '5' })

    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('缺 input_text → 422', async () => {
    const name = uniqueName('text-missing')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody()
    delete body.input_text

    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 422)
  })

  test('无 Authorization → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: validBody(),
    })

    assert.equal(res.statusCode, 401)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.AUTH_FAILED)
  })

  test('重复 task_id → 200 + DUPLICATE_TASK + meta:{}', async () => {
    installFetchMock([
      { body: { choices: [{ message: { content: '首次润色' } }] } },
      // 第二次重复请求不会调 polish（createOpenApiBatch 先抛 DUPLICATE_TASK）
    ])
    try {
      const name = uniqueName('text-dup')
      createdNames.push(name)
      const { apiKey } = await provisionCaller(name)
      const taskId = `task-dup-${Date.now()}`
      const body = validBody({ task_id: taskId })

      // 第一次：成功
      const res1 = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: body,
      })
      assert.equal(res1.statusCode, 200)

      // 记录 batchId 用于清理
      const db = getDb()
      const batch = await db
        .selectFrom('task_batches')
        .select('id')
        .where('task_id', '=', taskId)
        .executeTakeFirstOrThrow()
      createdBatchIds.push(batch.id)

      // 第二次：重复 task_id
      const res2 = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: body,
      })
      assert.equal(res2.statusCode, 200)
      const json2 = res2.json() as { result: { code: string }; meta: Record<string, unknown> }
      assert.equal(json2.result.code, ErrorCode.DUPLICATE_TASK)
      assert.deepEqual(json2.meta, {})

      // 重复请求不应再调 Ark
      assert.equal(fetchCalls.length, 1, '重复请求不应调用 polish')
    } finally {
      restoreFetch()
    }
  })

  test('Ark 失败 → 200 + EXTERNAL_SERVICE_FAILED + meta.output_text=""', async () => {
    installFetchMock([{ body: { error: 'upstream error' }, ok: false, status: 500 }])
    try {
      const name = uniqueName('text-fail')
      createdNames.push(name)
      const { apiKey } = await provisionCaller(name)
      const taskId = `task-fail-${Date.now()}`
      const body = validBody({ task_id: taskId })

      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: body,
      })

      // 业务错误 HTTP 200（对齐源 error_response）+ body code + meta.output_text=""
      assert.equal(res.statusCode, 200)
      const json = res.json() as { result: { code: string }; meta: { output_text: string } }
      assert.equal(json.result.code, ErrorCode.EXTERNAL_SERVICE_FAILED)
      assert.equal(json.meta.output_text, '')

      // 验证 task 状态流转为 failed
      const db = getDb()
      const batch = await db
        .selectFrom('task_batches')
        .select('id')
        .where('task_id', '=', taskId)
        .executeTakeFirstOrThrow()
      createdBatchIds.push(batch.id)
      const task = await db
        .selectFrom('tasks')
        .select('status')
        .where('batch_id', '=', batch.id)
        .executeTakeFirstOrThrow()
      assert.equal(task.status, 'failed')
    } finally {
      restoreFetch()
    }
  })

  test('DOUBAO_API_KEY 缺失 → 400 + MODEL_CONFIG_ERROR', async () => {
    // 临时删除 DOUBAO_API_KEY（对齐源 _provider_key 的 MODEL_CONFIG_ERROR，HTTPException(400)）
    const saved = process.env.DOUBAO_API_KEY
    delete process.env.DOUBAO_API_KEY
    try {
      const name = uniqueName('text-nokey')
      createdNames.push(name)
      const { apiKey } = await provisionCaller(name)
      const body = validBody({ task_id: `task-nokey-${Date.now()}` })

      const res = await app.inject({
        method: 'POST',
        url: '/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: body,
      })

      assert.equal(res.statusCode, 400, 'MODEL_CONFIG_ERROR 应 HTTP 400（对齐源 HTTPException）')
      const json = res.json() as { result: { code: string }; meta: Record<string, unknown> }
      assert.equal(json.result.code, ErrorCode.MODEL_CONFIG_ERROR)
      assert.deepEqual(json.meta, {})
    } finally {
      process.env.DOUBAO_API_KEY = saved
    }
  })
})
