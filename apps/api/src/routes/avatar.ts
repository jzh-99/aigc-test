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

const UPLOAD_DIR = '/tmp/avatar-uploads'
const MAX_FILE_AGE_MS = 20 * 60 * 1000 // 20 minutes — enough for generation
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_AUDIO_SIZE = 20 * 1024 * 1024 // 20 MB

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp']
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac']
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}
const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
}
const SAFE_ID = /^[\w-]+\.(jpg|jpeg|png|webp|mp3|wav|m4a|aac)$/

const OMNI_REQ_KEY = 'jimeng_realman_avatar_picture_omni_v15'
const OMNI_API_VERSION = '2022-08-31'
const CREDITS_PER_SECOND = 50

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true })

  const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

  // ── POST /avatar/upload ─────────────────────────────────────────────────────
  // Upload image or audio; returns temp_id + public URL for Volcengine to fetch
  app.post('/avatar/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_AUDIO_SIZE } })
    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? ''
    const isImage = IMAGE_EXTS.includes(ext)
    const isAudio = AUDIO_EXTS.includes(ext)
    if (!isImage && !isAudio) {
      return reply.badRequest('Unsupported file type. Images: jpg/png/webp; Audio: mp3/wav/m4a/aac')
    }
    if (isImage && data.file.bytesRead > MAX_IMAGE_SIZE) {
      return reply.badRequest('Image too large (max 10 MB)')
    }

    const id = `${randomUUID()}.${ext}`
    const filePath = join(UPLOAD_DIR, id)
    await pipeline(data.file, createWriteStream(filePath))

    return { temp_id: id, url: `${BASE_URL}/api/v1/avatar/uploads/${id}` }
  })

  // ── GET /avatar/uploads/:id ─────────────────────────────────────────────────
  // Serve temp files publicly so Volcengine can fetch them (no auth)
  app.get<{ Params: { id: string } }>('/avatar/uploads/:id', async (request, reply) => {
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
      const mime = IMAGE_MIME[ext] ?? AUDIO_MIME[ext] ?? 'application/octet-stream'
      reply.header('Content-Type', mime)
      reply.header('Content-Length', s.size)
      reply.header('Cache-Control', 'no-store')
      reply.header('X-Robots-Tag', 'noindex')
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send()
    }
  })

  // ── POST /avatar/generate ───────────────────────────────────────────────────
  app.post<{
    Body: {
      workspace_id: string
      image_url: string
      audio_url: string
      audio_duration: number   // seconds, detected client-side via HTML5 Audio
      prompt?: string
      resolution?: '720p' | '1080p'
    }
  }>('/avatar/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['workspace_id', 'image_url', 'audio_url', 'audio_duration'],
        properties: {
          workspace_id: { type: 'string', format: 'uuid' },
          image_url: { type: 'string', minLength: 1 },
          audio_url: { type: 'string', minLength: 1 },
          audio_duration: { type: 'number', minimum: 1, maximum: 60 },
          prompt: { type: 'string', maxLength: 2000 },
          resolution: { type: 'string', enum: ['720p', '1080p'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { workspace_id: workspaceId, image_url, audio_url, audio_duration, prompt, resolution } = request.body
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
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '查看者无权生成数字人视频' } })
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

    if (!team || team.team_type !== 'standard') {
      return reply.status(403).send({ success: false, error: { code: 'AVATAR_DISABLED', message: '当前团队未开通数字人能力' } })
    }

    // Check concurrent avatar tasks — API only supports 1 concurrent
    const activeTasks = await db
      .selectFrom('tasks')
      .innerJoin('task_batches', 'tasks.batch_id', 'task_batches.id')
      .select(db.fn.count('tasks.id').as('count'))
      .where('tasks.status', '=', 'processing')
      .where('task_batches.module', '=', 'avatar' as any)
      .executeTakeFirstOrThrow()

    if (Number(activeTasks.count) >= 1) {
      return reply.status(429).send({
        success: false,
        error: { code: 'AVATAR_CONCURRENT_LIMIT', message: '数字人生成同时只支持1个任务，请等待当前任务完成后再提交' },
      })
    }

    // Calculate credits based on audio duration
    const estimatedSeconds = Math.ceil(audio_duration)
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
            module: 'avatar',
            provider: 'volcengine',
            model: OMNI_REQ_KEY,
            prompt: prompt ?? '',
            params: JSON.stringify({
              image_url,
              audio_url,
              audio_duration: estimatedSeconds,
              resolution: resolution ?? '720p',
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
      app.log.error({ err }, 'Failed to create avatar batch/task, refunding credits')
      try { await refundCredits(teamId, creditAccountId, userId, estimatedCredits) } catch { /* ignore */ }
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回' } })
    }

    // Submit to Volcengine OmniHuman API
    const volcBody: Record<string, unknown> = {
      req_key: OMNI_REQ_KEY,
      image_url,
      audio_url,
      enable_hd: resolution === '1080p',
    }
    if (prompt?.trim()) volcBody.prompt = prompt.trim()

    let externalTaskId: string | undefined
    let lastError = ''
    try {
      const { url, headers, body: signedBody } = buildSignedRequest('CVSubmitTask', OMNI_API_VERSION, volcBody)
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
        throw new Error(`Volcengine Avatar API error ${json.code}: ${json.message ?? 'unknown'}`)
      }
      externalTaskId = json.data.task_id
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      app.log.error({ taskId, batchId, err: lastError }, 'Avatar API submission failed')
    }

    if (!externalTaskId) {
      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('tasks').set({ status: 'failed', error_message: lastError.slice(0, 1000), completed_at: new Date().toISOString() }).where('id', '=', taskId).execute()
        await trx.updateTable('task_batches').set({ status: 'failed', failed_count: sql`failed_count + 1` }).where('id', '=', batchId).execute()
        await trx.updateTable('credit_accounts').set({ frozen_credits: sql`frozen_credits - ${estimatedCredits}` }).where('id', '=', creditAccountId).execute()
        await trx.updateTable('team_members').set({ credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)` }).where('team_id', '=', teamId).where('user_id', '=', userId).execute()
        await trx.insertInto('credits_ledger').values({ credit_account_id: creditAccountId, user_id: userId, amount: estimatedCredits, type: 'refund', task_id: taskId, batch_id: batchId, description: `Avatar generation failed to submit: ${lastError.slice(0, 200)}` }).execute()
      })
      try { await (request.server as any).redis.publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' })) } catch { /* ignore */ }
      return reply.status(502).send({ success: false, error: { code: 'AVATAR_API_ERROR', message: `数字人生成服务暂时不可用：${lastError.slice(0, 300)}` } })
    }

    await db.updateTable('tasks').set({ external_task_id: externalTaskId }).where('id', '=', taskId).execute()

    return reply.status(201).send({
      id: batchId,
      module: 'avatar',
      provider: 'volcengine',
      model: OMNI_REQ_KEY,
      prompt: prompt ?? '',
      params: { image_url, audio_url, audio_duration: estimatedSeconds, resolution: resolution ?? '720p' },
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
