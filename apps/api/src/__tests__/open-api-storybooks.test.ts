// 必须在 import 拉入 storage/db 之前加载 .env（ESM 按源码顺序实例化 side-effect import）
import '../lib/test-env.js'

// 开放接口绘本生成路由测试（Phase 4）。
//
// 测试搭建（对齐 lyrics.test.ts）：
//   - 真实库（provisionCaller 建调用方 + 归属容器，拿明文 apiKey 做 Bearer）
//   - Fastify 最小实例：autoload open-api 路由 + requireApiKey + scoped setErrorHandler
//   - mock getStorybookQueue：用 __setQueuesForTest 注入假 queue，记录 add 调用的 jobData
//   - after：清理 tasks/task_batches + provisionCaller 归属容器
//
// 红线验证：
//   1. 合法 Bearer + 完整 body → 200 + successResponse
//   2. storybookQueue.add 被调用，jobData 字段对齐 StorybookJobData + 回调字段
//   3. task_batches 落库 source=open_api、service_type=storybook、module=storybook
//   4. 无 Authorization → 401 + AUTH_FAILED
//   5. 缺必填字段 → 422 + PARAM_ERROR
//   6. age 非法枚举 → 422
//   7. category 越界 → 422
//   8. pages 越界（>10）→ 422
//   9. 重复 task_id → 200 + DUPLICATE_TASK
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
const fakeStorybookQueue = {
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

  await db.transaction().execute(async (trx) => {
    if (teamIds.length > 0) {
      await trx.deleteFrom('api_clients').where('team_id', 'in', teamIds).execute()
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

// 合法请求体模板（对齐源 StorybookGenerateRequest 必填字段）
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bussiness_id: `biz-${Date.now()}`,
    prompt: '一只小兔子的森林冒险',
    age: '3-6',
    category: 0,
    style: 1,
    pages: 4,
    callback_url: 'https://example.com/cb',
    ...overrides,
  }
}

describe('POST /api/v3/storybooks/generations', () => {
  before(async () => {
    __setQueuesForTest({ storybookQueue: fakeStorybookQueue })
    app = await buildTestApp()
  })

  after(async () => {
    await app.close()
    __setQueuesForTest({ storybookQueue: null })
    await cleanup()
    await closeDb()
  })

  test('合法请求 → 200 + successResponse，jobData 字段对齐 StorybookJobData', async () => {
    const name = uniqueName('sb-ok')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-ok-${Date.now()}`
    const body = validBody({ task_id: taskId })

    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
    const json = res.json() as { result: { task_id: string; code: string; message: string } }
    assert.equal(json.result.task_id, taskId)
    assert.equal(json.result.code, ErrorCode.SUCCESS)

    // 验证 jobData 投递：字段对齐 StorybookJobData + 回调字段
    assert.equal(capturedJobs.length >= 1, true, 'storybookQueue.add 应被调用')
    const job = capturedJobs[capturedJobs.length - 1]
    assert.equal(job.name, 'generate')
    const data = job.data as Record<string, unknown>
    assert.equal(typeof data.taskId, 'string')
    assert.equal(typeof data.batchId, 'string')
    assert.equal(typeof data.userId, 'string')
    assert.equal(typeof data.teamId, 'string')
    assert.equal(typeof data.workspaceId, 'string')
    assert.equal(data.estimatedCredits, 0)
    // 业务字段
    assert.equal(data.prompt, '一只小兔子的森林冒险')
    assert.equal(data.age, '3-6')
    assert.equal(data.category, 0)
    assert.equal(data.style, 1)
    assert.equal(data.pages, 4)
    // 开放接口回调字段
    assert.equal(data.callbackUrl, 'https://example.com/cb')
    assert.equal(data.businessId, body.bussiness_id)
    assert.equal(data.serviceType, 'storybook')
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
    assert.equal(batch.module, 'storybook')
    assert.equal(batch.service_type, 'storybook')
    assert.equal(batch.provider, 'volcengine')

    // 验证 params 含 worker 消费的业务字段
    const params = typeof batch.params === 'string' ? JSON.parse(batch.params) : batch.params
    assert.equal(params.age, '3-6')
    assert.equal(params.category, 0)
    assert.equal(params.style, 1)
    assert.equal(params.pages, 4)
  })

  test('age=6+ 合法边界 → 200', async () => {
    const name = uniqueName('sb-age')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-age-${Date.now()}`
    const body = validBody({ task_id: taskId, age: '6+' })

    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
    const job = capturedJobs[capturedJobs.length - 1]
    createdBatchIds.push((job.data as { batchId: string }).batchId)
  })

  test('pages=10 合法上界 → 200', async () => {
    const name = uniqueName('sb-pages')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-pages-${Date.now()}`
    const body = validBody({ task_id: taskId, pages: 10 })

    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200)
    const job = capturedJobs[capturedJobs.length - 1]
    createdBatchIds.push((job.data as { batchId: string }).batchId)
  })

  test('无 Authorization → 401 + AUTH_FAILED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      payload: validBody(),
    })
    assert.equal(res.statusCode, 401)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.AUTH_FAILED)
  })

  test('缺必填字段（无 pages）→ 422 + PARAM_ERROR', async () => {
    const name = uniqueName('sb-422')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody()
    delete body.pages

    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('age 非法枚举（4-6）→ 422', async () => {
    const name = uniqueName('sb-age-422')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ age: '4-6' })

    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('category 越界（5）→ 422', async () => {
    const name = uniqueName('sb-cat')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ category: 5 })

    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
  })

  test('pages 越界（11）→ 422', async () => {
    const name = uniqueName('sb-pages-422')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ pages: 11 })

    const res = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
  })

  test('重复 task_id → 200 + DUPLICATE_TASK', async () => {
    const name = uniqueName('sb-dup')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-dup-${Date.now()}`
    const body = validBody({ task_id: taskId })

    const r1 = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(r1.statusCode, 200)
    const job1 = capturedJobs[capturedJobs.length - 1] as CapturedJob
    createdBatchIds.push((job1.data as { batchId: string }).batchId)

    const r2 = await app.inject({
      method: 'POST',
      url: '/storybooks/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(r2.statusCode, 200, '业务错误走 HTTP 200')
    const json2 = r2.json() as { result: { code: string } }
    assert.equal(json2.result.code, ErrorCode.DUPLICATE_TASK)
  })
})
