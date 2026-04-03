import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { freezeCredits, refundCredits } from '../services/credit.js'

const VIDEO_CREDITS_MAP: Record<string, number> = {
  'veo3.1-fast': 10,
  'veo3.1-components': 15,
  'seedance-1.5-pro': 5, // per-second price
  'seedance-2.0': 5,      // per-second price
  'seedance-2.0-fast': 5, // per-second price
}

// Map frontend model codes → actual Volcengine model IDs
const VOLCENGINE_MODEL_ID: Record<string, string> = {
  'seedance-1.5-pro': 'doubao-seedance-1-5-pro-251215',
  'seedance-2.0':     'doubao-seedance-2-0-260516',
  'seedance-2.0-fast':'doubao-seedance-2-0-lite-260516',
}

interface VideoGenerateBody {
  prompt: string
  workspace_id: string
  model?: string
  images?: string[]           // 首尾帧（首尾帧 Tab）
  reference_images?: string[] // 参考图（参考生视频 Tab，Seedance 2.0 专用）
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive'
  enable_upsample?: boolean
  resolution?: '720p' | '1080p'
  duration?: number
  generate_audio?: boolean
  camera_fixed?: boolean
}

export async function videoRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: VideoGenerateBody }>('/videos/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['prompt', 'workspace_id'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 4000 },
          workspace_id: { type: 'string', format: 'uuid' },
          model: {
            type: 'string',
            enum: ['veo3.1-fast', 'veo3.1-components', 'seedance-1.5-pro', 'seedance-2.0', 'seedance-2.0-fast'],
            default: 'veo3.1-fast'
          },
          images: { type: 'array', items: { type: 'string' }, maxItems: 2 },
          reference_images: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] },
          enable_upsample: { type: 'boolean' },
          resolution: { type: 'string', enum: ['720p', '1080p'] },
          duration: { type: 'integer', minimum: -1, maximum: 15 },
          generate_audio: { type: 'boolean' },
          camera_fixed: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      prompt,
      workspace_id: workspaceId,
      model = 'veo3.1-fast',
      images,
      reference_images,
      aspect_ratio,
      enable_upsample,
      resolution,
      duration,
      generate_audio,
      camera_fixed,
    } = request.body

    const isSeedance = model.startsWith('seedance-')
    const isSeedance2 = model === 'seedance-2.0' || model === 'seedance-2.0-fast'

    // Validate images count based on model
    if (images) {
      if (model === 'veo3.1-fast' && images.length > 2) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_IMAGES', message: 'veo3.1-fast 模型最多支持2张图片（首尾帧）' },
        })
      }
      if (model === 'veo3.1-components') {
        if (images.length < 1 || images.length > 3) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_IMAGES', message: 'veo3.1-components 模型需要1-3张参考图片' },
          })
        }
      }
      if (isSeedance && images.length > 2) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_IMAGES', message: 'Seedance 模型首尾帧最多支持2张图片' },
        })
      }
    } else if (model === 'veo3.1-components') {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_IMAGES', message: 'veo3.1-components 模型需要至少1张参考图片' },
      })
    }

    if (reference_images && reference_images.length > 0 && !isSeedance2) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'reference_images 仅支持 Seedance 2.0 系列模型' },
      })
    }

    // Calculate credits: seedance uses per-second pricing, others use flat rate
    const CREDITS_PER_SECOND = VIDEO_CREDITS_MAP[model] ?? 5
    const videoDuration = isSeedance ? (duration ?? 5) : undefined
    const VIDEO_CREDITS = isSeedance
      ? (videoDuration === -1 ? 15 : videoDuration!) * CREDITS_PER_SECOND
      : VIDEO_CREDITS_MAP[model] ?? 10

    const userId = request.user.id
    const db = getDb()

    // Check pending batch limit
    const pendingCount = await db
      .selectFrom('task_batches')
      .select(db.fn.count('id').as('count'))
      .where('user_id', '=', userId)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirstOrThrow()

    if (Number(pendingCount.count) >= 20) {
      return reply.status(429).send({
        success: false,
        error: { code: 'TOO_MANY_PENDING', message: '当前任务队列已满，请等待已有视频生成完成后再提交' },
      })
    }

    // Verify workspace membership
    const wsMember = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .select(['workspaces.team_id', 'workspace_members.role'])
      .where('workspace_members.workspace_id', '=', workspaceId)
      .where('workspace_members.user_id', '=', userId)
      .executeTakeFirst()

    if (!wsMember && request.user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '你不是此工作区的成员' },
      })
    }
    if (wsMember?.role === 'viewer' && request.user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '查看者无权生成视频' },
      })
    }

    let teamId: string
    if (wsMember) {
      teamId = wsMember.team_id
    } else {
      const workspace = await db
        .selectFrom('workspaces')
        .select('team_id')
        .where('id', '=', workspaceId)
        .executeTakeFirst()
      if (!workspace) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '工作区未找到' } })
      }
      teamId = workspace.team_id
    }

    const teamMember = await db
      .selectFrom('team_members')
      .select('user_id')
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    if (!teamMember) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '必须是团队成员才能生成视频' },
      })
    }

    // Freeze credits
    let creditAccountId: string
    try {
      const result = await freezeCredits(teamId, userId, VIDEO_CREDITS)
      creditAccountId = result.creditAccountId
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Credit error'
      return reply.status(402).send({
        success: false,
        error: { code: 'INSUFFICIENT_CREDITS', message: msg },
      })
    }

    // Create batch + task (status=processing, external_task_id will be set after API call)
    // Wrapped in try-catch: if DB fails after freeze, refund to prevent orphan frozen credits
    let batchId: string
    let taskId: string
    try {
    const _batchTask = await db.transaction().execute(async (trx: any) => {
      const paramsForDb: Record<string, unknown> = {
        aspect_ratio: aspect_ratio ?? null,
      }

      if (model === 'veo3.1-components') {
        paramsForDb.has_reference_components = true
        paramsForDb.reference_count = images?.length ?? 0
      } else if (isSeedance) {
        paramsForDb.duration = videoDuration
        paramsForDb.generate_audio = generate_audio ?? true
        paramsForDb.camera_fixed = camera_fixed ?? false
        if (isSeedance2 && reference_images && reference_images.length > 0) {
          paramsForDb.has_reference_images = true
          paramsForDb.reference_count = reference_images.length
        }
        if (images && images.length > 0) {
          paramsForDb.has_first_frame = true
          paramsForDb.has_last_frame = images.length > 1
        }
      } else {
        paramsForDb.has_first_frame = (images?.length ?? 0) > 0
        paramsForDb.has_last_frame = (images?.length ?? 0) > 1
      }

      const provider = isSeedance ? 'volcengine' : 'nano-banana'

      const batchResult = await trx
        .insertInto('task_batches')
        .values({
          idempotency_key: crypto.randomUUID(),
          user_id: userId,
          team_id: teamId,
          workspace_id: workspaceId,
          credit_account_id: creditAccountId,
          module: 'video',
          provider,
          model,
          prompt,
          params: JSON.stringify(paramsForDb),
          quantity: 1,
          status: 'processing',
          estimated_credits: VIDEO_CREDITS,
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      const taskResult = await trx
        .insertInto('tasks')
        .values({
          batch_id: batchResult.id,
          user_id: userId,
          version_index: 0,
          estimated_credits: VIDEO_CREDITS,
          status: 'processing',
          processing_started_at: new Date().toISOString(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      return { batchId: batchResult.id, taskId: taskResult.id }
    })
    batchId = _batchTask.batchId
    taskId = _batchTask.taskId
    } catch (err) {
      // DB error after freeze — refund to prevent orphan frozen credits
      app.log.error({ err }, 'Failed to create video batch/task after freeze, refunding credits')
      try {
        await refundCredits(teamId, creditAccountId, userId, VIDEO_CREDITS)
      } catch (refundErr) {
        app.log.error({ refundErr }, 'CRITICAL: Failed to refund credits after video batch creation failure')
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回，请重试' },
      })
    }

    // Call API (Veo for nano-banana, Volcengine for seedance)
    let externalTaskId: string
    let lastError: string = ''
    const maxRetries = 1

    if (isSeedance) {
      // Volcengine Seedance API
      const volcengineApiUrl = 'https://ark.cn-beijing.volces.com/api/v3'
      const volcengineApiKey = process.env.VOLCENGINE_API_KEY ?? ''

      const volcengineBody: Record<string, unknown> = {
        model: VOLCENGINE_MODEL_ID[model] ?? model,
        content: [{ type: 'text', text: prompt }],
        resolution: resolution ?? '720p',
        duration: videoDuration,
        generate_audio: generate_audio ?? true,
        camera_fixed: camera_fixed ?? false,
      }

      // 首尾帧图片（frames Tab）：images 字段，role=first_frame/last_frame
      if (images && images.length > 0) {
        images.forEach((img, idx) => {
          const role = idx === 0 ? 'first_frame' : 'last_frame'
          ;(volcengineBody.content as any[]).push({
            type: 'image_url',
            image_url: { url: img },
            role,
          })
        })
      }

      // 参考图（components Tab，Seedance 2.0 专用）：reference_images 字段，role=reference
      if (isSeedance2 && reference_images && reference_images.length > 0) {
        reference_images.forEach((img) => {
          ;(volcengineBody.content as any[]).push({
            type: 'image_url',
            image_url: { url: img },
            role: 'reference',
          })
        })
      }

      if (aspect_ratio) volcengineBody.ratio = aspect_ratio

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 30_000)
          let res: Response
          try {
            res = await fetch(`${volcengineApiUrl}/contents/generations/tasks`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${volcengineApiKey}` },
              body: JSON.stringify(volcengineBody),
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timer)
          }

          if (!res.ok) {
            const errText = await res.text()
            throw new Error(`Volcengine API ${res.status}: ${errText}`)
          }

          const json = (await res.json()) as { id: string }
          if (!json.id) throw new Error('Volcengine API did not return task id')
          externalTaskId = json.id
          break
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          lastError = errMsg
          const isTimeout = errMsg.includes('aborted') || errMsg.includes('timeout')
          const isHttpError = errMsg.startsWith('Volcengine API ')
          const isNetworkError = errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') ||
                                errMsg.includes('ENOTFOUND') || errMsg.includes('ETIMEDOUT') ||
                                errMsg.includes('ECONNRESET')
          const shouldRetry = !isTimeout && !isHttpError && isNetworkError && attempt < maxRetries
          if (shouldRetry) {
            app.log.warn({ taskId, batchId, attempt: attempt + 1, err: errMsg }, 'Volcengine API call failed, retrying')
            await new Promise(r => setTimeout(r, 2000))
            continue
          }
          app.log.error({ taskId, batchId, err: errMsg }, 'Volcengine API submission failed')
          break
        }
      }
    } else {
      // Nano Banana Veo API (existing logic)
      const veoApiUrl = process.env.NANO_BANANA_API_URL ?? ''
      const veoApiKey = process.env.NANO_BANANA_API_KEY ?? ''

      const veoBody: Record<string, unknown> = {
        prompt,
        model,
        enhance_prompt: true,
      }
      if (images && images.length > 0) veoBody.images = images
      if (aspect_ratio) veoBody.aspect_ratio = aspect_ratio
      if (enable_upsample !== undefined) veoBody.enable_upsample = enable_upsample

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 30_000)
          let veoRes: Response
          try {
            veoRes = await fetch(`${veoApiUrl}/v2/videos/generations`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${veoApiKey}` },
              body: JSON.stringify(veoBody),
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timer)
          }

          if (!veoRes.ok) {
            const errText = await veoRes.text()
            throw new Error(`Veo API ${veoRes.status}: ${errText}`)
          }

          const veoJson = (await veoRes.json()) as { task_id: string }
          if (!veoJson.task_id) throw new Error('Veo API did not return task_id')
          externalTaskId = veoJson.task_id
          break
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          lastError = errMsg
          const isTimeout = errMsg.includes('aborted') || errMsg.includes('timeout')
          const isHttpError = errMsg.startsWith('Veo API ')
          const isNetworkError = errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') ||
                                errMsg.includes('ENOTFOUND') || errMsg.includes('ETIMEDOUT') ||
                                errMsg.includes('ECONNRESET')
          const shouldRetry = !isTimeout && !isHttpError && isNetworkError && attempt < maxRetries
          if (shouldRetry) {
            app.log.warn({ taskId, batchId, attempt: attempt + 1, err: errMsg }, 'Veo API call failed, retrying')
            await new Promise(r => setTimeout(r, 2000))
            continue
          }
          app.log.error({ taskId, batchId, err: errMsg }, 'Veo API submission failed')
          break
        }
      }
    }

    // If no externalTaskId, fail the task and refund credits
    if (!externalTaskId!) {
      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('tasks')
          .set({ status: 'failed', error_message: lastError.slice(0, 1000), completed_at: new Date().toISOString() })
          .where('id', '=', taskId).execute()

        await trx.updateTable('task_batches')
          .set({ status: 'failed', failed_count: sql`failed_count + 1` })
          .where('id', '=', batchId).execute()

        await trx.updateTable('credit_accounts')
          .set({ frozen_credits: sql`frozen_credits - ${VIDEO_CREDITS}` })
          .where('id', '=', creditAccountId).execute()

        await trx.updateTable('team_members')
          .set({ credit_used: sql`GREATEST(credit_used - ${VIDEO_CREDITS}, 0)` })
          .where('team_id', '=', teamId).where('user_id', '=', userId).execute()

        await trx.insertInto('credits_ledger').values({
          credit_account_id: creditAccountId,
          user_id: userId,
          amount: VIDEO_CREDITS,
          type: 'refund',
          task_id: taskId,
          batch_id: batchId,
          description: `Video generation failed to submit: ${lastError.slice(0, 200)}`,
        }).execute()
      })

      try {
        await (request.server as any).redis.publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
      } catch { /* ignore SSE errors */ }

      return reply.status(502).send({
        success: false,
        error: { code: 'VIDEO_API_ERROR', message: `视频生成服务暂时不可用：${lastError.slice(0, 300)}` },
      })
    }

    // Update task with external_task_id
    await db.updateTable('tasks')
      .set({ external_task_id: externalTaskId })
      .where('id', '=', taskId)
      .execute()

    return reply.status(201).send({
      id: batchId,
      module: 'video',
      provider: isSeedance ? 'volcengine' : 'nano-banana',
      model,
      prompt,
      params: {},
      quantity: 1,
      completed_count: 0,
      failed_count: 0,
      status: 'processing',
      estimated_credits: VIDEO_CREDITS,
      actual_credits: 0,
      created_at: new Date().toISOString(),
      tasks: [{
        id: taskId,
        version_index: 0,
        status: 'processing',
        estimated_credits: VIDEO_CREDITS,
        credits_cost: null,
        error_message: null,
        processing_started_at: new Date().toISOString(),
        completed_at: null,
        asset: null,
      }],
    })
  })
}
