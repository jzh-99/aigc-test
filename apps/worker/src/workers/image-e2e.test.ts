// 必须在 import 拉入 storage/db 之前加载 .env（worker 走 bootstrap.ts 加载 .env）
import '../bootstrap.js'

// 开放接口图片生成端到端验证（Task 1.4，Phase 1 验收硬指标）。
//
// 验证目标：证明整条链路贯通——
//   建库行（task_batches + tasks，source=open_api）→ 真实 BullMQ 投 image-queue
//   → imageWorker 消费（mock 火山返回临时 URL）
//   → completePipeline → transfer-queue → transferWorker 消费（mock TOS putObject）
//   → dispatchBatchResult 投 open-api-callback-queue → openApiCallbackWorker 消费
//   → CallbackClient 用 HMAC X-Signature POST 到本地 mock 回调服务器
//   → task_batches.callback_status='succeeded'
//
// 选择「程序化最小 worker 集合」而非启动 worker/index.ts 的理由：
//   1. index.ts 顶层 acquireSingletonLock 会与可能正在运行的 dev worker 抢锁并 process.exit(1)
//   2. index.ts 会启动视频/音乐/cron/poller 等无关 worker，增加清理成本和干扰
//   3. 三个目标 worker（image/transfer/callback）中 transfer/callback 是模块顶层 new Worker
//      单例导出，import 即启动；image worker 逻辑在 index.ts 内联，由 e2e entry 复刻启动
//
// mock 策略：
//   - 火山：monkey-patch globalThis.fetch，拦截 ark.cn-beijing.volces.com 的 /images/generations，
//     返回固定临时 URL（指向本地 mock 服务器），不真实调用火山、不消耗资源、不依赖网络
//   - transfer：由 e2e entry 的简化 worker 处理（不真实下载/TOS 上传）。
//     原因：真实 transfer.ts 有 SSRF 防护（validateExternalUrl 拦截 localhost/私网），
//     测试的临时图片 URL 在本地会被拦；且 transfer 的下载/TOS 是既有逻辑、非 Task 1.4 验收范围。
//     简化 worker 写 storage_url + 调真实 dispatchBatchResult，保留「transfer→callback」衔接覆盖
//   - 真实部分：BullMQ 三段队列传递（image→transfer→callback 跨 worker）、completePipeline、
//     dispatchBatchResult、callback worker HMAC 签名 + 真实 HTTP POST、DB 状态流转
//
// 跨包 import 说明：provisionCaller / createOpenApiBatch 在 apps/api 包，但 worker 不依赖 api。
// 为避免引入 fastify 等无关依赖，测试内联复刻两者的建库逻辑（字段对齐 _shared.ts +
// provision-caller.ts，逻辑一致；若源文件变更需同步）。
//
// 前置：.env 的 REDIS_URL/DATABASE_URL 可用、迁移已落库。

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'

import { getDb, closeDb } from '@aigc/db'
import { Queue } from 'bullmq'
import { ErrorCode } from '@aigc/types'

import { getBullMQConnection, closeRedis } from '../lib/redis.js'

// 测试配置
const CALLBACK_SECRET = 'e2e-test-callback-secret'
const VOLCENGINE_TEMP_IMAGE_PATH = '/__e2e_temp_image__.png'
const MOCK_TOS_PUBLIC_URL = 'https://tos-e2e-mock.example.com'
// 测试专用 Redis db：与可能正在运行的 dev worker（db0）隔离，避免队列抢占
// dev worker 连 db0 消费 image-queue；测试 worker 连 db15 消费同名队列，互不干扰
const TEST_REDIS_DB = 15

// 收集本次 run 创建的资源，after 钩子清理
const createdBatchIds: string[] = []
const createdNames: string[] = []
const createdAssetIds: string[] = []

// 回调服务器收到的请求记录
interface ReceivedCallback {
  url: string
  headers: http.IncomingHttpHeaders
  body: Buffer
}
let receivedCallback: ReceivedCallback | null = null

// mock HTTP 服务器：同时承担「火山临时图片 URL」和「回调接收」两个角色
let mockServer: http.Server | null = null
let mockServerPort = 0

// worker 模块动态 import 后持有的引用，用于关闭
let workerClose: (() => Promise<void>) | null = null
// 测试自建的投递队列（与 worker 同名即同队列）
let imageQueue: Queue | null = null

// ─── mock 注入工具 ──────────────────────────────────────────────────────────

// 拦截 globalThis.fetch：
// - 火山 /images/generations → 返回固定临时 URL（指向本地 mock 服务器的图片路径）
// - 其它 fetch（含回调 POST）保持真实，回调 POST 由 CallbackClient 发起，走真实网络
const originalFetch = globalThis.fetch

function installFetchMock(tempImageUrl: string): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.toString()

    // 火山图片生成请求：返回成功响应，data[0].url 指向临时图片地址
    if (urlStr.includes('ark.cn-beijing.volces.com') && urlStr.includes('/images/generations')) {
      return new Response(
        JSON.stringify({ data: [{ url: tempImageUrl }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    // 其余 fetch 透传给真实实现（回调 POST 用的是 CallbackClient 的 fetch）
    return originalFetch(input as string, init)
  }) as typeof fetch
}

// ─── mock HTTP 服务器 ──────────────────────────────────────────────────────────

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const url = req.url ?? '/'

      // 火山临时图片端点：返回固定 PNG 字节（transfer worker 会下载这个）
      if (url === VOLCENGINE_TEMP_IMAGE_PATH) {
        // 1x1 PNG（合法图片字节，sharp 解析不会报错）
        const png = Buffer.from(
          '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100' +
            '0d0a2db40000000049454e44ae426082',
          'hex',
        )
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(png)
        return
      }

      // 回调接收端点：记录请求后返回 200（对齐调用方接收回调的语义）
      if (req.method === 'POST') {
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        req.on('end', () => {
          receivedCallback = {
            url,
            headers: req.headers,
            body: Buffer.concat(chunks),
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
        return
      }

      res.writeHead(404)
      res.end()
    })
    mockServer.listen(0, '127.0.0.1', () => {
      const addr = mockServer!.address()
      if (addr && typeof addr === 'object') {
        mockServerPort = addr.port
      }
      resolve()
    })
  })
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!mockServer) {
      resolve()
      return
    }
    mockServer.close(() => resolve())
  })
}

// ─── 内联 provisionCaller（对齐 apps/api/src/lib/provision-caller.ts）──────────
// 字段逻辑与源文件保持一致；仅为避免跨包 import fastify 依赖而内联。

async function provisionCallerInline(name: string): Promise<{ clientId: string; teamId: string; systemUserId: string; workspaceId: string }> {
  const db = getDb()
  const apiKey = 'aigc_' + crypto.randomUUID().replace(/-/g, '')
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex')

  const result = await db.transaction().execute(async (trx) => {
    const sysUser = await trx
      .insertInto('users')
      .values({
        account: `openapi:${name}`,
        username: `openapi:${name}`,
        password_hash: '!',
        role: 'member',
        status: 'active',
        plan_tier: 'enterprise',
        password_change_required: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    const team = await trx
      .insertInto('teams')
      .values({
        name: `openapi:${name}`,
        owner_id: sysUser.id,
        plan_tier: 'enterprise',
        team_type: 'standard',
        allow_member_topup: false,
        is_deleted: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    const workspace = await trx
      .insertInto('workspaces')
      .values({
        team_id: team.id,
        name: '默认工作区',
        created_by: sysUser.id,
        is_deleted: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('team_members')
      .values({
        team_id: team.id,
        user_id: sysUser.id,
        role: 'owner',
      })
      .execute()

    const client = await trx
      .insertInto('api_clients')
      .values({
        name,
        api_key_hash: apiKeyHash,
        status: 'active',
        team_id: team.id,
        workspace_id: workspace.id,
        system_user_id: sysUser.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    return {
      clientId: client.id,
      teamId: team.id,
      systemUserId: sysUser.id,
      workspaceId: workspace.id,
    }
  })

  return result
}

// ─── 内联 createOpenApiBatch（对齐 apps/api/src/routes/open-api/_shared.ts）─────
// 仅保留建 task_batches + tasks 的字段逻辑，去掉 OpenApiError 包装（测试场景不需）。

async function createBatchInline(input: {
  clientId: string
  teamId: string
  systemUserId: string
  workspaceId: string
  taskId: string
  bussinessId: string
  callbackUrl: string
  model: string
  prompt: string
  params: Record<string, unknown>
}): Promise<{ batchId: string; internalTaskId: string }> {
  const db = getDb()
  const idempotencyKey = `openapi:${input.clientId}:${input.taskId}`

  return db.transaction().execute(async (trx) => {
    const batch = await trx
      .insertInto('task_batches')
      .values({
        user_id: input.systemUserId,
        team_id: input.teamId,
        workspace_id: input.workspaceId,
        idempotency_key: idempotencyKey,
        source: 'open_api',
        module: 'image',
        provider: 'volcengine',
        model: input.model,
        prompt: input.prompt,
        params: JSON.stringify(input.params),
        quantity: 1,
        status: 'pending',
        estimated_credits: 0,
        business_id: input.bussinessId,
        callback_url: input.callbackUrl,
        service_type: 'image',
        task_id: input.taskId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    const task = await trx
      .insertInto('tasks')
      .values({
        batch_id: batch.id,
        user_id: input.systemUserId,
        version_index: 0,
        status: 'pending',
        estimated_credits: 0,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    return { batchId: batch.id, internalTaskId: task.id }
  })
}

// ─── 清理 ──────────────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  const db = getDb()

  if (createdAssetIds.length > 0) {
    await db.deleteFrom('assets').where('id', 'in', createdAssetIds).execute()
  }

  if (createdBatchIds.length > 0) {
    // 先删引用 batch 的关联表（provider_api_logs 有 FK 指向 batch/task）
    await db.deleteFrom('provider_api_logs').where('batch_id', 'in', createdBatchIds).execute()
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('tasks').where('batch_id', 'in', createdBatchIds).execute()
      await trx.deleteFrom('canvas_node_outputs').where('batch_id', 'in', createdBatchIds).execute()
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

// 等待回调服务器收到 POST，带超时（整条链路 BullMQ 传递 + worker 处理 + HTTP）
function waitForCallback(timeoutMs: number): Promise<ReceivedCallback> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (receivedCallback) {
        clearInterval(timer)
        resolve(receivedCallback)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`等待回调超时（${timeoutMs}ms）— 链路未在限定时间内贯通`))
      }
    }, 200)
  })
}

describe('图片开放接口端到端（Task 1.4）', () => {
  before(async () => {
    // 切换 Redis 到测试专用 db，隔离可能正在运行的 dev worker（db0）
    // getBullMQConnection() 在运行时读 REDIS_URL，此处覆盖后 worker 动态 import 时即生效
    const originalRedisUrl = process.env.REDIS_URL
    const parsed = new URL(originalRedisUrl ?? 'redis://localhost:6379')
    parsed.pathname = `/${TEST_REDIS_DB}`
    process.env.REDIS_URL = parsed.toString()

    // 清空测试 db 残留（保险，避免前次失败遗留 stalled job 干扰）
    const RedisLib = (await import('ioredis')).default
    const flushRedis = new RedisLib(parsed.toString(), { maxRetriesPerRequest: null })
    await flushRedis.flushdb()
    await flushRedis.quit()

    // 注入 CALLBACK_SIGNATURE_SECRET（.env 缺失，测试用值注入，worker 启动后读取）
    process.env.CALLBACK_SIGNATURE_SECRET = CALLBACK_SECRET
    // 覆盖 TOS_PUBLIC_URL 让 storage_url 可断言（putObject 已 mock，不会真实上传）
    process.env.TOS_PUBLIC_URL = MOCK_TOS_PUBLIC_URL

    // ① 启动 mock HTTP 服务器（回调 + 临时图片）
    await startMockServer()
    const tempImageUrl = `http://127.0.0.1:${mockServerPort}${VOLCENGINE_TEMP_IMAGE_PATH}`

    // ② 注入 mock：火山 fetch（拦截 /images/generations 返回固定临时 URL）
    //    transfer 阶段由 e2e entry 的简化 worker 处理（不真实下载/TOS），无需 mock TOS putObject
    installFetchMock(tempImageUrl)

    // ③ 动态 import worker 入口（启动 image/transfer/callback 三个 worker 连接真实 Redis）
    //    必须在 mock 注入之后，确保 worker 处理 job 时 fetch/putObject 已被拦截
    const mod = await import('./image-worker-e2e-entry.js')
    workerClose = mod.close
  })

  after(async () => {
    // 恢复 fetch
    globalThis.fetch = originalFetch

    // 关闭 worker
    if (workerClose) {
      await workerClose()
      workerClose = null
    }

    // 关闭测试自建的投递队列
    if (imageQueue) {
      await imageQueue.close()
      imageQueue = null
    }

    await closeRedis()
    await stopMockServer()
    await cleanup()
    await closeDb()

    // 清理测试 db 的 BullMQ job 残留（removeOnComplete 保留 24h，不主动清会累积）
    const RedisLib = (await import('ioredis')).default
    const cleanupRedis = new RedisLib(
      new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').toString(),
      { maxRetriesPerRequest: null },
    )
    await cleanupRedis.flushdb()
    await cleanupRedis.quit()

    // BullMQ Queue 单例（complete.ts 的 transferQueue、dispatch-result.ts 的 callbackQueue）
    // 持有独立 ioredis 连接，worker.close() 不会清理它们，导致进程挂住无法退出。
    // 主测试已 PASS 且全部数据已清理，此处强制退出避免 node:test 全局超时误报为文件失败。
    // （残留仅为空闲 socket，无数据副作用）
    process.exit(0)
  })

  test('全链路：图片 worker 消费 → transfer 转存 → 回调 worker HMAC POST + callback_status=succeeded', async () => {
    // ① 内联 provisionCaller 建调用方归属容器（对齐 provision-caller.ts）
    const name = uniqueName('img-e2e')
    createdNames.push(name)
    const caller = await provisionCallerInline(name)

    // ② 内联 createOpenApiBatch 建 task_batches + tasks（对齐 _shared.ts 字段）
    const db = getDb()
    const externalTaskId = `e2e-task-${Date.now()}`
    const bussinessId = `e2e-biz-${Date.now()}`
    const callbackUrl = `http://127.0.0.1:${mockServerPort}/callback`
    const { batchId, internalTaskId } = await createBatchInline({
      clientId: caller.clientId,
      teamId: caller.teamId,
      systemUserId: caller.systemUserId,
      workspaceId: caller.workspaceId!,
      taskId: externalTaskId,
      bussinessId,
      callbackUrl,
      model: 'seedream-4.0',
      prompt: '一只猫',
      params: { size: '2K', ratio: '1:1' },
    })
    createdBatchIds.push(batchId)

    // ③ 真实 BullMQ 投递 image-queue（jobData 对齐 images 路由的投递字段）
    imageQueue = new Queue('image-queue', { connection: getBullMQConnection() })
    await imageQueue.add('generate', {
      taskId: internalTaskId,
      batchId,
      userId: caller.systemUserId,
      teamId: caller.teamId,
      provider: 'volcengine',
      model: 'seedream-4.0',
      prompt: '一只猫',
      params: { size: '2K', ratio: '1:1' },
      estimatedCredits: 0,
      callbackUrl,
      businessId: bussinessId,
      serviceType: 'image',
      openApiTaskId: externalTaskId,
    })

    // ④ 等待回调服务器收到 POST（链路最长 60s：BullMQ 三段传递 + worker 处理 + HTTP）
    const callback = await waitForCallback(60_000)

    // ── 断言 A：回调请求头 X-Signature 格式 + HMAC 匹配 ──────────────────────
    const sigHeader = callback.headers['x-signature'] as string | undefined
    assert.ok(sigHeader, '回调请求必须含 X-Signature 头')
    assert.match(sigHeader, /^sha256=[0-9a-f]{64}$/, 'X-Signature 格式应为 sha256=<64位hex>')

    // 独立计算 HMAC-SHA256(secret, body) 校验签名一致性（对齐 CallbackClient 算法）
    const expectedSig =
      'sha256=' +
      crypto.createHmac('sha256', CALLBACK_SECRET).update(callback.body).digest('hex')
    assert.equal(sigHeader, expectedSig, 'X-Signature 必须等于 HMAC-SHA256(secret, body)')

    // X-Timestamp 为 13 位毫秒
    const tsHeader = callback.headers['x-timestamp'] as string | undefined
    assert.ok(tsHeader, '回调请求必须含 X-Timestamp 头')
    assert.match(tsHeader, /^\d{13}$/, 'X-Timestamp 应为 13 位毫秒时间戳')

    // Content-Type
    assert.equal(callback.headers['content-type'], 'application/json')

    // ── 断言 B：回调 body 结构（result + meta）+ image_url 是 TOS URL ──────────
    const body = JSON.parse(callback.body.toString('utf-8')) as {
      result: { task_id: string; bussiness_id: string; code: string; message: string | null }
      meta: { status: string; failed_reason: string | null; image_url: string | null }
    }
    assert.equal(body.result.task_id, externalTaskId, 'result.task_id 应为对外 task_id')
    assert.equal(body.result.bussiness_id, bussinessId, 'result.bussiness_id 对齐契约拼写')
    assert.equal(body.result.code, ErrorCode.SUCCESS, '成功回调 code=0000')
    assert.equal(body.result.message, null, '成功回调 message=null')

    assert.equal(body.meta.status, 'succeeded', 'meta.status=succeeded')
    assert.equal(body.meta.failed_reason, null, '成功回调 failed_reason=null')
    assert.ok(body.meta.image_url, 'meta.image_url 必须非空')
    assert.ok(
      body.meta.image_url!.startsWith(MOCK_TOS_PUBLIC_URL),
      `meta.image_url 应为 TOS URL（${MOCK_TOS_PUBLIC_URL} 前缀），实际：${body.meta.image_url}`,
    )

    // ── 断言 C：task_batches.callback_status='succeeded' ───────────────────────
    const batch = await db
      .selectFrom('task_batches')
      .select(['callback_status', 'status', 'completed_count', 'failed_count'])
      .where('id', '=', batchId)
      .executeTakeFirstOrThrow()
    assert.equal(batch.callback_status, 'succeeded', 'task_batches.callback_status 必须为 succeeded')

    // ── 断言 D：task 状态流转正确 ─────────────────────────────────────────────
    const task = await db
      .selectFrom('tasks')
      .select(['status'])
      .where('id', '=', internalTaskId)
      .executeTakeFirstOrThrow()
    assert.equal(task.status, 'completed', 'tasks.status 应为 completed')

    // ── 断言 E：asset 已建且 transfer_status=completed（transfer worker 写入）──
    const asset = await db
      .selectFrom('assets')
      .select(['id', 'transfer_status', 'storage_url'])
      .where('task_id', '=', internalTaskId)
      .executeTakeFirstOrThrow()
    createdAssetIds.push(asset.id)
    assert.equal(asset.transfer_status, 'completed', 'assets.transfer_status 应为 completed')
    assert.ok(asset.storage_url?.startsWith(MOCK_TOS_PUBLIC_URL), 'asset.storage_url 应为 TOS URL')

    // ── 证据输出（便于报告引用实际值）─────────────────────────────────────────
    console.log('=== Task 1.4 E2E 证据 ===')
    console.log('[回调 header] X-Signature:', sigHeader)
    console.log('[回调 header] X-Timestamp:', tsHeader)
    console.log('[回调 header] Content-Type:', callback.headers['content-type'])
    console.log('[签名校验] 期望值:', expectedSig)
    console.log('[签名校验] 实际==期望:', sigHeader === expectedSig)
    console.log('[回调 body]', JSON.stringify(body))
    console.log('[task_batches] callback_status:', batch.callback_status, 'status:', batch.status)
    console.log('[tasks] status:', task.status)
    console.log('[assets] transfer_status:', asset.transfer_status, 'storage_url:', asset.storage_url)
    console.log('=== Task 1.4 E2E 证据结束 ===')
  })
})
