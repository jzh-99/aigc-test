import type { FastifyInstance } from 'fastify'
import { createWriteStream, createReadStream } from 'node:fs'
import { unlink, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { freezeCredits, refundCredits } from '../services/credit.js'
import { buildSignedRequest } from '../lib/volcengine-visual-sign.js'

const UPLOAD_DIR = '/tmp/action-imitation-uploads'
const MAX_FILE_AGE_MS = 40 * 60 * 1000 // 40 minutes — covers upload + up to 35-min generation
const MAX_VIDEO_SIZE = 200 * 1024 * 1024 // 200 MB

const VIDEO_EXTS = ['mp4', 'mov', 'webm']
const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
}
const SAFE_ID = /^[\w-]+\.(mp4|mov|webm)$/

const ACTION_REQ_KEY = 'jimeng_dreamactor_m20_gen_video'
const ACTION_API_VERSION = '2022-08-31'
const CREDITS_PER_SECOND = 20

export async function actionImitationRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true })

  const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

  // ── POST /action-imitation/upload ───────────────────────────────────────────
  // Upload driving video; returns temp_id + public URL for Volcengine to fetch
  app.post('/action-imitation/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_VIDEO_SIZE } })
    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
    if (!VIDEO_EXTS.includes(ext)) {
      return reply.badRequest('Unsupported file type. Video: mp4/mov/webm')
    }

    const id = `${randomUUID()}.${ext}`
    const filePath = join(UPLOAD_DIR, id)
    await pipeline(data.file, createWriteStream(filePath))

    return { temp_id: id, url: `${BASE_URL}/api/v1/action-imitation/uploads/${id}` }
  })

  // ── GET /action-imitation/uploads/:id ──────────────────────────────────────
  // Serve temp video files publicly so Volcengine can fetch them (no auth)
  app.get<{ Params: { id: string } }>('/action-imitation/uploads/:id', async (request, reply) => {
    const { id } = request.params
    if (!SAFE_ID.test(id)) return reply.status(404).send()

    const filePath = join(UPLOAD_DIR, id)
    try {
      const s = await stat(filePath)
      if (Date.now() - s.mtimeMs > MAX_FILE_AGE_MS) {
        await unlink(filePath).catch(() => {})
        return reply.status(404).send()
      }
      const ext = id.split('.').pop()!
      const mime = VIDEO_MIME[ext] ?? 'application/octet-stream'
      reply.header('Content-Type', mime)
      reply.header('Content-Length', s.size)
      reply.header('Cache-Control', 'no-store')
      reply.header('X-Robots-Tag', 'noindex')
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send()
    }
  })

  // ── POST /action-imitation/generate ────────────────────────────────────────
  app.post<{
    Body: {
      workspace_id: string
      image_base64: string   // base64 without data:xxx;base64, prefix
      image_mime: string     // 'image/jpeg' | 'image/png'
      video_url: string      // public URL of uploaded video
      video_duration: number // seconds, detected client-side via HTML5 Video API
    }
  }>('/action-imitation/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['workspace_id', 'image_base64', 'image_mime', 'video_url', 'video_duration'],
        properties: {
          workspace_id: { type: 'string', format: 'uuid' },
          image_base64: { type: 'string', minLength: 1 },
          image_mime: { type: 'string', enum: ['image/jpeg', 'image/jpg', 'image/png'] },
          video_url: { type: 'string', minLength: 1 },
          video_duration: { type: 'number', minimum: 1, maximum: 30 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { workspace_id: workspaceId, image_base64, image_mime, video_url, video_duration } = request.body
    const userId = request.user.id
    const db = getDb()

    // Verify workspace membership
    const wsMember = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .select(['workspaces.team_id', 'workspace_members.role'])
      .where('workspace_members.workspace_id', '=', workspaceId)
      .where('workspace_members.user_id', '=', userId)
      .executeTakeFirst()

    if (!wsMember && request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '你不是此工作区的成员' } })
    }
    if (wsMember?.role === 'viewer' && request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '查看者无权使用动作模仿' } })
    }

    let teamId: string
    if (wsMember) {
      teamId = wsMember.team_id
    } else {
      const workspace = await db.selectFrom('workspaces').select('team_id').where('id', '=', workspaceId).executeTakeFirst()
      if (!workspace) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '工作区未找到' } })
      teamId = workspace.team_id
    }

    const team = await db
      .selectFrom('teams')
      .select('team_type')
      .where('id', '=', teamId)
      .executeTakeFirst()

    if (!team || (team.team_type !== 'standard' && team.team_type !== 'avatar_enabled')) {
      return reply.status(403).send({ success: false, error: { code: 'ACTION_IMITATION_DISABLED', message: '当前团队未开通动作模仿能力' } })
    }

    // Check concurrent action_imitation tasks — API only supports 1 concurrent
    const activeTasks = await db
      .selectFrom('tasks')
      .innerJoin('task_batches', 'tasks.batch_id', 'task_batches.id')
      .select(db.fn.count('tasks.id').as('count'))
      .where('tasks.status', '=', 'processing')
      .where('task_batches.module', '=', 'action_imitation' as any)
      .executeTakeFirstOrThrow()

    if (Number(activeTasks.count) >= 1) {
      return reply.status(429).send({
        success: false,
        error: { code: 'ACTION_IMITATION_CONCURRENT_LIMIT', message: '动作模仿同时只支持1个任务，请等待当前任务完成后再提交' },
      })
    }

    // Calculate credits based on video duration
    const estimatedSeconds = Math.ceil(video_duration)
    const estimatedCredits = estimatedSeconds * CREDITS_PER_SECOND

    // Freeze credits
    let creditAccountId: string
    try {
      const result = await freezeCredits(teamId, userId, estimatedCredits)
      creditAccountId = result.creditAccountId
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Credit error'
      return reply.status(402).send({ success: false, error: { code: 'INSUFFICIENT_CREDITS', message: msg } })
    }

    // Create batch + task
    let batchId: string
    let taskId: string
    try {
      const _bt = await db.transaction().execute(async (trx: any) => {
        const batchResult = await trx
          .insertInto('task_batches')
          .values({
            idempotency_key: randomUUID(),
            user_id: userId,
            team_id: teamId,
            workspace_id: workspaceId,
            credit_account_id: creditAccountId,
            module: 'action_imitation',
            provider: 'volcengine',
            model: ACTION_REQ_KEY,
            prompt: '',
            params: JSON.stringify({
              video_url,
              video_duration: estimatedSeconds,
            }),
            quantity: 1,
            status: 'processing',
            estimated_credits: estimatedCredits,
          })
          .returning('id')
          .executeTakeFirstOrThrow()

        const taskResult = await trx
          .insertInto('tasks')
          .values({
            batch_id: batchResult.id,
            user_id: userId,
            version_index: 0,
            estimated_credits: estimatedCredits,
            status: 'processing',
            processing_started_at: new Date().toISOString(),
          })
          .returning('id')
          .executeTakeFirstOrThrow()

        return { batchId: batchResult.id, taskId: taskResult.id }
      })
      batchId = _bt.batchId
      taskId = _bt.taskId
    } catch (err) {
      app.log.error({ err }, 'Failed to create action_imitation batch/task, refunding credits')
      try { await refundCredits(teamId, creditAccountId, userId, estimatedCredits) } catch { /* ignore */ }
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回' } })
    }

    // Submit to Volcengine Action Imitation 2.0 API
    const volcBody: Record<string, unknown> = {
      req_key: ACTION_REQ_KEY,
      binary_data_base64: [image_base64],
      video_url,
      cut_result_first_second_switch: true,
    }

    let externalTaskId: string | undefined
    let lastError = ''
    try {
      const { url, headers, body: signedBody } = buildSignedRequest('CVSync2AsyncSubmitTask', ACTION_API_VERSION, volcBody)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers, body: signedBody, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }

      const json = (await res.json()) as { code: number; data?: { task_id?: string }; message?: string }
      if (json.code !== 10000 || !json.data?.task_id) {
        throw new Error(`Volcengine Action Imitation API error ${json.code}: ${json.message ?? 'unknown'}`)
      }
      externalTaskId = json.data.task_id
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      app.log.error({ taskId, batchId, err: lastError }, 'Action Imitation API submission failed')
    }

    if (!externalTaskId) {
      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('tasks').set({ status: 'failed', error_message: lastError.slice(0, 1000), completed_at: new Date().toISOString() }).where('id', '=', taskId).execute()
        await trx.updateTable('task_batches').set({ status: 'failed', failed_count: sql`failed_count + 1` }).where('id', '=', batchId).execute()
        await trx.updateTable('credit_accounts').set({ frozen_credits: sql`frozen_credits - ${estimatedCredits}` }).where('id', '=', creditAccountId).execute()
        await trx.updateTable('team_members').set({ credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)` }).where('team_id', '=', teamId).where('user_id', '=', userId).execute()
        await trx.insertInto('credits_ledger').values({ credit_account_id: creditAccountId, user_id: userId, amount: estimatedCredits, type: 'refund', task_id: taskId, batch_id: batchId, description: `Action Imitation failed to submit: ${lastError.slice(0, 200)}` }).execute()
      })
      try { await (request.server as any).redis.publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' })) } catch { /* ignore */ }
      return reply.status(502).send({ success: false, error: { code: 'ACTION_IMITATION_API_ERROR', message: `动作模仿服务暂时不可用：${lastError.slice(0, 300)}` } })
    }

    await db.updateTable('tasks').set({ external_task_id: externalTaskId }).where('id', '=', taskId).execute()

    return reply.status(201).send({
      id: batchId,
      module: 'action_imitation',
      provider: 'volcengine',
      model: ACTION_REQ_KEY,
      prompt: '',
      params: { video_url, video_duration: estimatedSeconds },
      quantity: 1,
      completed_count: 0,
      failed_count: 0,
      status: 'processing',
      estimated_credits: estimatedCredits,
      actual_credits: 0,
      created_at: new Date().toISOString(),
      tasks: [{
        id: taskId,
        version_index: 0,
        status: 'processing',
        estimated_credits: estimatedCredits,
        credits_cost: null,
        error_message: null,
        processing_started_at: new Date().toISOString(),
        completed_at: null,
        asset: null,
      }],
    })
  })
}
