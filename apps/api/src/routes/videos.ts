import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { freezeCredits } from '../services/credit.js'

const VIDEO_CREDITS = 10

interface VideoGenerateBody {
  prompt: string
  workspace_id: string
  model?: string
  images?: string[]
  aspect_ratio?: '16:9' | '9:16'
  enable_upsample?: boolean
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
          model: { type: 'string', default: 'veo3.1-fast' },
          images: { type: 'array', items: { type: 'string' }, maxItems: 2 },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16'] },
          enable_upsample: { type: 'boolean' },
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
      aspect_ratio,
      enable_upsample,
    } = request.body

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
    const { batchId, taskId } = await db.transaction().execute(async (trx: any) => {
      const paramsForDb = { aspect_ratio: aspect_ratio ?? null, has_first_frame: (images?.length ?? 0) > 0, has_last_frame: (images?.length ?? 0) > 1 }

      const batchResult = await trx
        .insertInto('task_batches')
        .values({
          idempotency_key: crypto.randomUUID(),
          user_id: userId,
          team_id: teamId,
          workspace_id: workspaceId,
          credit_account_id: creditAccountId,
          module: 'video',
          provider: 'nano-banana',
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

    // Call Veo API
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

    let externalTaskId: string
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
    } catch (err) {
      // Veo API call failed — fail the task immediately and refund credits
      const errMsg = err instanceof Error ? err.message : String(err)
      app.log.error({ taskId, batchId, err: errMsg }, 'Veo API submission failed')

      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('tasks')
          .set({ status: 'failed', error_message: errMsg.slice(0, 1000), completed_at: new Date().toISOString() })
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
          description: `Video generation failed to submit: ${errMsg.slice(0, 200)}`,
        }).execute()
      })

      try {
        await (request.server as any).redis.publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
      } catch { /* ignore SSE errors */ }

      return reply.status(502).send({
        success: false,
        error: { code: 'VIDEO_API_ERROR', message: '视频生成服务暂时不可用，请稍后重试' },
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
      provider: 'nano-banana',
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
