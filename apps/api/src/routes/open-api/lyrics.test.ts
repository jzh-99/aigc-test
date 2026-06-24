// 必须在 import 拉入 storage/db 之前加载 .env（ESM 按源码顺序实例化 side-effect import）
import '../../lib/test-env.js'

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import autoload from '@fastify/autoload'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { closeDb, getDb } from '@aigc/db'

import { __setQueuesForTest } from '../../lib/queue.js'
import { requireApiKey } from '../../plugins/api-key-auth.js'
import { sendOpenApiError } from './_shared.js'
import { ErrorCode } from '../../lib/open-api-errors.js'
import { provisionCaller } from '../../lib/provision-caller.js'

// 开放接口音乐生成路由测试（Phase 3）。
//
// 测试搭建（对齐 videos.test.ts）：
//   - 真实库（provisionCaller 建调用方 + 归属容器，拿明文 apiKey 做 Bearer）
//   - Fastify 最小实例：autoload open-api 路由 + requireApiKey + scoped setErrorHandler
//   - mock getMusicQueue：用 __setQueuesForTest 注入假 queue，记录 add 调用的 jobData
//   - after：清理 music_tracks/tasks/task_batches + provisionCaller 归属容器
//
// 红线验证：
//   1. 合法 Bearer + 完整 body（灵感模式 instrumental=0）→ 200 + successResponse
//   2. 合法 Bearer + 完整 body（纯音乐 instrumental=1）→ 200 + successResponse
//   3. musicQueue.add 被调用，jobData 字段对齐 MusicJobData + 回调字段 + trackId
//   4. 字段适配：gender→voice_gender、tag→styles、instrumental→type、promt→prompt
//   5. music_tracks 落库（type/mode/voice_gender/styles/prompt/model）
//   6. task_batches 落库 source=open_api、service_type=song、module=music
//   7. 无 Authorization → 401 + AUTH_FAILED
//   8. 缺必填字段 → 422 + PARAM_ERROR
//   9. gender 非法枚举 → 422
//   10. 重复 task_id → 200 + DUPLICATE_TASK

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CapturedJob {
  name: string
  data: Record<string, unknown>
}
const capturedJobs: CapturedJob[] = []
const fakeMusicQueue = {
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
const createdTrackIds: string[] = []

let app: Fastify.FastifyInstance

async function buildTestApp() {
  const instance = Fastify({ logger: false })
  await instance.register(requireApiKey)
  instance.setErrorHandler((err, _req, reply) => {
    sendOpenApiError(reply, err)
  })
  await instance.register(autoload, {
    dir: join(__dirname),
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

  if (createdTrackIds.length > 0) {
    await db.deleteFrom('music_tracks').where('id', 'in', createdTrackIds).execute()
  }

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

// 合法请求体模板（对齐源 SongGenerateRequest 必填字段）
// 默认灵感模式（instrumental='0'），gender='2'（auto），含 tag
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bussiness_id: `biz-${Date.now()}`,
    model: 'mureka-9',
    promt: '一首关于夏天的歌',
    gender: '2',
    tag: '流行,中国风',
    instrumental: '0',
    callback_url: 'https://example.com/cb',
    ...overrides,
  }
}

describe('POST /api/v3/lyrics/generate', () => {
  before(async () => {
    __setQueuesForTest({ musicQueue: fakeMusicQueue })
    app = await buildTestApp()
  })

  after(async () => {
    await app.close()
    __setQueuesForTest({ musicQueue: null })
    await cleanup()
    await closeDb()
  })

  test('灵感模式（instrumental=0）→ 200 + successResponse，jobData/music_tracks 字段适配正确', async () => {
    const name = uniqueName('song-insp')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-insp-${Date.now()}`
    const body = validBody({ task_id: taskId })

    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
    const json = res.json() as { result: { task_id: string; code: string; message: string } }
    assert.equal(json.result.task_id, taskId)
    assert.equal(json.result.code, ErrorCode.SUCCESS)

    // 验证 jobData 投递：字段对齐 MusicJobData + 回调字段
    assert.equal(capturedJobs.length >= 1, true, 'musicQueue.add 应被调用')
    const job = capturedJobs[capturedJobs.length - 1]
    assert.equal(job.name, 'music-generate')
    const data = job.data as Record<string, unknown>
    assert.equal(typeof data.taskId, 'string')
    assert.equal(typeof data.batchId, 'string')
    assert.equal(typeof data.trackId, 'string')
    assert.equal(typeof data.userId, 'string')
    assert.equal(typeof data.teamId, 'string')
    assert.equal(typeof data.workspaceId, 'string')
    assert.equal(typeof data.creditAccountId, 'string')
    assert.equal(data.estimatedCredits, 0)
    // 开放接口回调字段
    assert.equal(data.callbackUrl, 'https://example.com/cb')
    assert.equal(data.businessId, body.bussiness_id)
    assert.equal(data.serviceType, 'song')
    assert.equal(data.openApiTaskId, taskId)

    createdBatchIds.push(data.batchId as string)
    createdTrackIds.push(data.trackId as string)

    // 验证 task_batches 落库
    const db = getDb()
    const batch = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('id', '=', data.batchId as string)
      .executeTakeFirstOrThrow()
    assert.equal(batch.source, 'open_api')
    assert.equal(batch.task_id, taskId)
    assert.equal(batch.module, 'music')
    assert.equal(batch.service_type, 'song')
    assert.equal(batch.provider, 'mureka')
    assert.equal(batch.model, 'mureka-9')

    // 验证 music_tracks 落库 + 字段适配
    const track = await db
      .selectFrom('music_tracks')
      .selectAll()
      .where('id', '=', data.trackId as string)
      .executeTakeFirstOrThrow()
    // 字段适配红线：instrumental='0' → type='song'，mode='inspiration'
    assert.equal(track.type, 'song', "instrumental='0' 应映射为 type='song'")
    assert.equal(track.mode, 'inspiration')
    // gender='2' → voice_gender='auto'
    assert.equal(track.voice_gender, 'auto', "gender='2' 应映射为 voice_gender='auto'")
    // promt → prompt
    assert.equal(track.prompt, '一首关于夏天的歌')
    assert.equal(track.model, 'mureka-9')

    // 验证 task_batches.params 含 worker 读取的 MusicBatchParams 字段
    const params = typeof batch.params === 'string' ? JSON.parse(batch.params) : batch.params
    assert.equal(params.track_type, 'song')
    assert.equal(params.mode, 'inspiration')
    assert.equal(params.voice_gender, 'auto')
    // tag → styles 数组（按分隔符拆分 + 去重）
    assert.deepEqual(params.styles, ['流行', '中国风'])
    // styles 列也落库为数组
    const trackStyles = typeof track.styles === 'string' ? JSON.parse(track.styles) : track.styles
    assert.deepEqual(trackStyles, ['流行', '中国风'])
  })

  test('纯音乐模式（instrumental=1）→ 200，type 映射为 instrumental', async () => {
    const name = uniqueName('song-inst')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-inst-${Date.now()}`
    // gender='1'（女声）、tag 单值、instrumental='1'
    const body = validBody({
      task_id: taskId,
      gender: '1',
      tag: '民谣',
      instrumental: '1',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
    const json = res.json() as { result: { task_id: string; code: string } }
    assert.equal(json.result.task_id, taskId)
    assert.equal(json.result.code, ErrorCode.SUCCESS)

    const job = capturedJobs[capturedJobs.length - 1]
    const data = job.data as Record<string, unknown>
    createdBatchIds.push(data.batchId as string)
    createdTrackIds.push(data.trackId as string)

    // 验证 music_tracks 字段适配
    const db = getDb()
    const track = await db
      .selectFrom('music_tracks')
      .selectAll()
      .where('id', '=', data.trackId as string)
      .executeTakeFirstOrThrow()
    // 字段适配红线：instrumental='1' → type='instrumental'
    assert.equal(track.type, 'instrumental', "instrumental='1' 应映射为 type='instrumental'")
    assert.equal(track.mode, 'inspiration')
    // gender='1' → voice_gender='female'
    assert.equal(track.voice_gender, 'female', "gender='1' 应映射为 voice_gender='female'")
    // tag 单值 → styles 单元素数组
    const trackStyles = typeof track.styles === 'string' ? JSON.parse(track.styles) : track.styles
    assert.deepEqual(trackStyles, ['民谣'])
  })

  test(`gender='0' → voice_gender=male；bussiness_id 可空`, async () => {
    const name = uniqueName('song-male')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-male-${Date.now()}`
    const body = validBody({
      task_id: taskId,
      gender: '0',
      // bussiness_id 缺省（可空）
    })
    delete body.bussiness_id

    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}：${res.body}`)
    const json = res.json() as { result: { task_id: string; code: string } }
    assert.equal(json.result.task_id, taskId)

    const job = capturedJobs[capturedJobs.length - 1]
    const data = job.data as Record<string, unknown>
    createdBatchIds.push(data.batchId as string)
    createdTrackIds.push(data.trackId as string)

    const db = getDb()
    const track = await db
      .selectFrom('music_tracks')
      .selectAll()
      .where('id', '=', data.trackId as string)
      .executeTakeFirstOrThrow()
    assert.equal(track.voice_gender, 'male', "gender='0' 应映射为 voice_gender='male'")
    // bussiness_id 可空 → 路由适配为空串写入 business_id（与 createOpenApiBatch 契约一致）
    const batch = await db
      .selectFrom('task_batches')
      .select(['business_id'])
      .where('id', '=', data.batchId as string)
      .executeTakeFirstOrThrow()
    assert.equal(batch.business_id, '', 'bussiness_id 可空 → 路由适配为空串写入 business_id')
  })

  test('tag 可空 → styles 为空数组', async () => {
    const name = uniqueName('song-notag')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-notag-${Date.now()}`
    const body = validBody({ task_id: taskId })
    delete body.tag

    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })

    assert.equal(res.statusCode, 200)
    const job = capturedJobs[capturedJobs.length - 1]
    const data = job.data as Record<string, unknown>
    createdBatchIds.push(data.batchId as string)
    createdTrackIds.push(data.trackId as string)

    const db = getDb()
    const track = await db
      .selectFrom('music_tracks')
      .selectAll()
      .where('id', '=', data.trackId as string)
      .executeTakeFirstOrThrow()
    const trackStyles = typeof track.styles === 'string' ? JSON.parse(track.styles) : track.styles
    assert.deepEqual(trackStyles, [], 'tag 可空 → styles 应为空数组')
  })

  test('无 Authorization → 401 + AUTH_FAILED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      payload: validBody(),
    })
    assert.equal(res.statusCode, 401)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.AUTH_FAILED)
  })

  test('缺必填字段（无 model）→ 422 + PARAM_ERROR', async () => {
    const name = uniqueName('song-422')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody()
    delete body.model

    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('gender 非法枚举值（3）→ 422 + PARAM_ERROR', async () => {
    const name = uniqueName('song-gender')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ gender: '3' })

    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('instrumental 非法枚举值（2）→ 422 + PARAM_ERROR', async () => {
    const name = uniqueName('song-inst-422')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const body = validBody({ instrumental: '2' })

    const res = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(res.statusCode, 422)
    const json = res.json() as { result: { code: string } }
    assert.equal(json.result.code, ErrorCode.PARAM_ERROR)
  })

  test('重复 task_id → 200 + DUPLICATE_TASK', async () => {
    const name = uniqueName('song-dup')
    createdNames.push(name)
    const { apiKey } = await provisionCaller(name)
    const taskId = `task-dup-${Date.now()}`
    const body = validBody({ task_id: taskId })

    const r1 = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(r1.statusCode, 200)
    const job1 = capturedJobs[capturedJobs.length - 1] as CapturedJob
    createdBatchIds.push((job1.data as { batchId: string }).batchId)
    createdTrackIds.push((job1.data as { trackId: string }).trackId)

    const r2 = await app.inject({
      method: 'POST',
      url: '/lyrics/generate',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: body,
    })
    assert.equal(r2.statusCode, 200, '业务错误走 HTTP 200')
    const json2 = r2.json() as { result: { code: string } }
    assert.equal(json2.result.code, ErrorCode.DUPLICATE_TASK)
  })
})
