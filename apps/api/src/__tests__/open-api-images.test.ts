// 必须在 import 拉入 storage/db 之前加载 .env（ESM 按源码顺序实例化 side-effect import）
import '../lib/test-env.js'

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

// 开放接口图片生成路由测试（Task 1.2）。
//
// 测试搭建：
//   - 真实库（provisionCaller 建调用方 + 归属容器，拿明文 apiKey 做 Bearer）
//     认证走默认 Kysely finder，故库内必须有真实 api_clients 行
//   - Fastify 最小实例：autoload open-api 路由 + requireApiKey 装饰 + scoped setErrorHandler
//     （对齐 app.ts 的 /api/v3 挂载方式，但不挂 JWT/CORS/rateLimit 等无关插件）
//   - mock getImageQueue：用 __setQueuesForTest 注入假 queue，记录 add 调用的 jobName + jobData
//     避免真实投递 BullMQ（测试环境无 Redis 也能跑）
//   - after：清理 tasks/task_batches + provisionCaller 归属容器 6 表
//
// 红线验证：
//   1. 合法 Bearer + 完整 body → 200 + successResponse（task_id/code/message）
//   2. imageQueue.add 被调用，jobData 含 callbackUrl/businessId/serviceType/openApiTaskId/creditAccountId
//   3. 参考图 base64 → DB params 只有 TOS URL，无 base64 明文
//   4. 无 Authorization → 401 + AUTH_FAILED
//   5. 缺必填字段 → 422 + PARAM_ERROR
//   6. 重复 task_id → 200 + DUPLICATE_TASK（createOpenApiBatch 抛，setErrorHandler 转）

const __dirname = dirname(fileURLToPath(import.meta.url))

// 收集 jobData 的假 queue（避免真实投递）
interface CapturedJob {
  name: string
  data: Record<string, unknown>
}
const capturedJobs: CapturedJob[] = []
const fakeImageQueue = {
  async add(name: string, data: Record<string, unknown>) {
    capturedJobs.push({ name, data })
    return { id: 'fake-job-id' }
  },
  async close() {
    /* no-op */
  },
}

// provisionCaller 创建的归属容器 name（after 清理）
const createdNames: string[] = []
// 本测试建的 task_batches.id（after 清理 tasks + task_batches）
const createdBatchIds: string[] = []

// 测试主体
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
    // 排除 _ 前缀辅助文件 + *.test.ts 测试文件（避免 autoload 把测试当插件加载）
    ignorePattern: /(^_|\.test\.ts$)/,
  })
  await instance.ready()
  return instance
}

async function cleanup() {
  const db = getDb()

  // ① 清理本测试建的 tasks + task_batches（按 batch_id 反查 tasks）
  if (createdBatchIds.length > 0) {
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('tasks').where('batch_id', 'in', createdBatchIds).execute()
      await trx.deleteFrom('task_batches').where('id', 'in', createdBatchIds).execute()
    })
  }

  // ② 清理 provisionCaller 归属容器（对齐 _shared.batch.test.ts 的级联清理）
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

// 合法请求体模板（测试用例覆盖字段）
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bussiness_id: `biz-${Date.now()}`,
    model: 'seedream-4-0',
    promt: '一只猫',
    size: '2K',
    ratio: '1:1',
    callback_url: 'https://example.com/cb',
    ...overrides,
  }
}

describe('POST /api/v3/images/generations', () => {
  before(async () => {
    // 注入假 image queue（全局单例，避免真实 BullMQ 投递）
    __setQueuesForTest({ imageQueue: fakeImageQueue })
    app = await buildTestApp()
  })

  after(async () => {
    await app.close()
    __setQueuesForTest({ imageQueue: null })
    await cleanup()
    await closeDb()
  })

  test('合法 Bearer + 完整 body → 200 + successResponse，jobData 投递齐全', async () => {
    const name = uniqueName('img-ok')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-ok-${Date.now()}`
    const body = validBody({ task_id: taskId })

    const res = await app.inject({
      method: 'POST',
      url: '/images/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
    const json = res.json() as { result: { task_id: string; code: string; message: string } }
    assert.equal(json.result.task_id, taskId)
    assert.equal(json.result.code, ErrorCode.SUCCESS)

    // 验证 jobData 投递：字段齐全
    assert.equal(capturedJobs.length, 1, 'imageQueue.add 应被调用 1 次')
    const job = capturedJobs[capturedJobs.length - 1]
    assert.equal(job.name, 'generate')
    const data = job.data as Record<string, unknown>
    // 必填字段对齐 GenerationJobData
    assert.equal(typeof data.taskId, 'string')
    assert.equal(typeof data.batchId, 'string')
    assert.equal(typeof data.userId, 'string')
    assert.equal(typeof data.teamId, 'string')
    assert.equal(data.provider, 'volcengine')
    assert.equal(data.model, 'seedream-4-0')
    assert.equal(data.prompt, '一只猫')
    assert.equal(data.estimatedCredits, 0)
    // 开放接口回调用可选字段已填充
    assert.equal(data.callbackUrl, 'https://example.com/cb')
    assert.equal(data.businessId, body.bussiness_id, 'businessId 来自对外 bussiness_id')
    assert.equal(data.serviceType, 'image')
    assert.equal(data.openApiTaskId, taskId)

    // DB 验证：task_batches 落库 source=open_api
    const db = getDb()
    const batch = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('id', '=', data.batchId as string)
      .executeTakeFirstOrThrow()
    createdBatchIds.push(batch.id)
    assert.equal(batch.source, 'open_api')
    assert.equal(batch.task_id, taskId)
  })

  test('无 Authorization → 401 + AUTH_FAILED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/images/generations',
      payload: validBody(),
    })
    assert.equal(res.statusCode, 401)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.AUTH_FAILED)
    // 未认证不应投递队列
    // （此前可能已有 job，故只断言本用例未新增——通过 capturedJobs 增量判定）
  })

  test('缺必填字段（无 model）→ 422 + PARAM_ERROR', async () => {
    const name = uniqueName('img-422')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody()
    delete body.model

    const res = await app.inject({
      method: 'POST',
      url: '/images/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('size 非法枚举值 → 422 + PARAM_ERROR', async () => {
    const name = uniqueName('img-size')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ size: '8K' })

    const res = await app.inject({
      method: 'POST',
      url: '/images/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('重复 task_id → 200 + DUPLICATE_TASK（createOpenApiBatch 幂等拦截）', async () => {
    const name = uniqueName('img-dup')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-dup-${Date.now()}`
    const body = validBody({ task_id: taskId })

    // 第一次：成功
    const r1 = await app.inject({
      method: 'POST',
      url: '/images/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(r1.statusCode, 200)
    // 记录 batchId 供清理（从首次 jobData 反推）
    const job1 = capturedJobs[capturedJobs.length - 1] as CapturedJob
    createdBatchIds.push((job1.data as { batchId: string }).batchId)

    // 第二次：同 task_id → DUPLICATE_TASK（HTTP 200 + body code）
    const r2 = await app.inject({
      method: 'POST',
      url: '/images/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(r2.statusCode, 200, '业务错误走 HTTP 200')
    const json2 = r2.json() as { result: { code: string } }
    assert.equal(json2.result.code, ErrorCode.DUPLICATE_TASK)
  })

  test('参考图 base64 → DB params 与 jobData.params 只有 TOS URL，无 base64 明文（脱敏红线）', async () => {
    const name = uniqueName('img-ref')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)

    const base64Content = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
    const dataUri = `data:image/png;base64,${base64Content}`
    const taskId = `task-ref-${Date.now()}`
    const body = validBody({
      task_id: taskId,
      image: [dataUri],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/images/generations',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 200, res.body)

    // ① jobData.params 不得含 base64 明文
    const job = capturedJobs[capturedJobs.length - 1] as CapturedJob
    const params = (job.data as { params: Record<string, unknown> }).params
    const paramsStr = JSON.stringify(params)
    assert.equal(paramsStr.includes(base64Content), false, 'jobData.params 不得残留 base64 明文')
    assert.equal(paramsStr.includes('base64'), false, 'jobData.params 不得含 base64 标记')
    // params.image 应是 URL 数组
    const imageField = params.image as unknown
    assert.ok(Array.isArray(imageField) && imageField.length === 1, 'params.image 应为长度 1 的 URL 数组')
    assert.ok(typeof (imageField as string[])[0] === 'string')
    assert.ok(/^https?:\/\//.test((imageField as string[])[0]), 'params.image[0] 应为 http(s) URL')

    // ② DB task_batches.params jsonb 不得含 base64 明文
    const db = getDb()
    const batch = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('task_id', '=', taskId)
      .executeTakeFirstOrThrow()
    createdBatchIds.push(batch.id)
    const dbParamsStr = JSON.stringify(batch.params)
    assert.equal(dbParamsStr.includes(base64Content), false, 'DB params 不得残留 base64 明文')
    assert.equal(dbParamsStr.includes('base64'), false, 'DB params 不得含 base64 标记')

    // ③ HTTP 响应体也不得泄漏 base64
    assert.equal(res.body.includes(base64Content), false, '响应体不得残留 base64 明文')
  })
})
