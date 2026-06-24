// 必须在 import 拉入 storage/db 之前加载 .env（ESM 按源码顺序实例化 side-effect import）
import '../lib/test-env.js'

// 开放接口资讯生成路由测试（Phase 6）。
//
// 测试搭建（对齐 podcasts.test.ts）：
//   - 真实库（provisionCaller 建调用方 + 归属容器，拿明文 apiKey 做 Bearer）
//   - Fastify 最小实例：autoload open-api 路由 + requireApiKey + scoped setErrorHandler
//   - mock getNewsQueue：用 __setQueuesForTest 注入假 queue，记录 add 调用的 jobData
//   - after：清理 tasks/task_batches + provisionCaller 归属容器
//
// 红线验证：
//   1. 合法 Bearer + 完整 body → 200 + successResponse
//   2. newsQueue.add 被调用，jobData 字段对齐 NewsJobData + 回调字段
//   3. task_batches 落库 source=open_api、service_type=news、module=news
//   4. date 格式校验：合法 YYYY-MM-DD 通过
//   5. date 格式非法（非 YYYY-MM-DD）→ 422
//   6. 缺必填字段 → 422
//   7. 无 Authorization → 401
//   8. 重复 task_id → 200 + DUPLICATE_TASK
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import autoload from '@fastify/autoload'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { closeDb, getDb } from '@aigc/db'

import { __setQueuesForTest } from '../lib/queue.js'
import { requireApiKey } from '../plugins/api-key-auth.js'
import { sendOpenApiError } from '../routes/open-api/_shared.js'
import { ErrorCode } from '../lib/open-api-errors.js'
import { provisionCaller } from '../lib/provision-caller.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CapturedJob {
  name: string
  data: Record<string, unknown>
}
const capturedJobs: CapturedJob[] = []
const fakeNewsQueue = {
  async add(name: string, data: Record<string, unknown>) {
    capturedJobs.push({ name, data })
    return { id: 'fake-job-id' }
  },
  async close() {
    /* no-op */
  },
}

const createdNames: string[] = []
const createdBatchIds: string[] = []

let app: Fastify.FastifyInstance

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

// 合法请求体模板（对齐源 NewsGenerateRequest 必填字段）
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bussiness_id: `biz-${Date.now()}`,
    prompt: '生成一份关于人工智能行业的资讯简报',
    date: '2026-06-23',
    callback_url: 'https://example.com/cb',
    ...overrides,
  }
}

describe('POST /api/v3/news/generations', () => {
  before(async () => {
    __setQueuesForTest({ newsQueue: fakeNewsQueue })
    app = await buildTestApp()
  })

  after(async () => {
    await app.close()
    __setQueuesForTest({ newsQueue: null })
    await cleanup()
    await closeDb()
  })

  test('合法请求 → 200 + successResponse，jobData 对齐 NewsJobData', async () => {
    const name = uniqueName('news-ok')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-news-${Date.now()}`
    const body = validBody({ task_id: taskId })

    const res = await app.inject({
      method: 'POST',
      url: '/news/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
    const json = res.json() as { result: { task_id: string; code: string } }
    assert.equal(json.result.task_id, taskId)
    assert.equal(json.result.code, ErrorCode.SUCCESS)

    // 验证 jobData 投递
    assert.ok(capturedJobs.length >= 1, 'newsQueue.add 应被调用')
    const job = capturedJobs[capturedJobs.length - 1]
    assert.equal(job.name, 'generate')
    const data = job.data as Record<string, unknown>
    assert.equal(typeof data.taskId, 'string')
    assert.equal(typeof data.batchId, 'string')
    assert.equal(typeof data.userId, 'string')
    assert.equal(typeof data.creditAccountId, 'string')
    assert.equal(data.estimatedCredits, 0)
    // 业务字段
    assert.equal(data.prompt, '生成一份关于人工智能行业的资讯简报')
    assert.equal(data.date, '2026-06-23')
    // 回调字段
    assert.equal(data.callbackUrl, 'https://example.com/cb')
    assert.equal(data.businessId, body.bussiness_id)
    assert.equal(data.serviceType, 'news')
    assert.equal(data.openApiTaskId, taskId)

    createdBatchIds.push(data.batchId as string)

    // 验证 task_batches 落库
    const db = getDb()
    const batch = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('id', '=', data.batchId as string)
      .executeTakeFirstOrThrow()
    assert.equal(batch.source, 'open_api')
    assert.equal(batch.task_id, taskId)
    assert.equal(batch.module, 'news')
    assert.equal(batch.service_type, 'news')
    assert.equal(batch.provider, 'ark')

    // params 含 date 业务字段
    const params = typeof batch.params === 'string' ? JSON.parse(batch.params) : batch.params
    assert.equal(params.date, '2026-06-23')
  })

  test('date 格式非法（非 YYYY-MM-DD）→ 422', async () => {
    const name = uniqueName('news-date')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ date: '2026/06/23' })

    const res = await app.inject({
      method: 'POST',
      url: '/news/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('缺必填字段 prompt → 422', async () => {
    const name = uniqueName('news-missing')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody()
    delete body.prompt

    const res = await app.inject({
      method: 'POST',
      url: '/news/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 422)
  })

  test('无 Authorization → 401', async () => {
    const body = validBody()
    const res = await app.inject({
      method: 'POST',
      url: '/news/generations',
      payload: body,
    })

    assert.equal(res.statusCode, 401)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.AUTH_FAILED)
  })

  test('重复 task_id → 200 + DUPLICATE_TASK', async () => {
    const name = uniqueName('news-dup')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-dup-${Date.now()}`
    const body = validBody({ task_id: taskId })

    // 第一次：成功
    const res1 = await app.inject({
      method: 'POST',
      url: '/news/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res1.statusCode, 200)

    // 记录 batchId 用于清理
    const job1 = capturedJobs[capturedJobs.length - 1]
    createdBatchIds.push((job1.data as Record<string, unknown>).batchId as string)

    // 第二次：重复 task_id
    const res2 = await app.inject({
      method: 'POST',
      url: '/news/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res2.statusCode, 200)
    const json2 = res2.json() as { result: { code: string } }
    assert.equal(json2.result.code, ErrorCode.DUPLICATE_TASK)
  })
})
