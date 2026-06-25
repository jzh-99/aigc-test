import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { buildSignedRequest } from '../../lib/volcengine-visual-sign.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { OMNI_API_VERSION } from './_shared.js'
import { deductBizMgmtPointsForGeneration } from '../../services/biz-mgmt-a-bean.js'
import { enqueueBizMgmtOutboxEvent } from '../../services/biz-mgmt-outbox.js'

// POST /avatar/generate — 提交数字人视频生成任务（同步提交到火山引擎，异步等待结果）
const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: {
      workspace_id: string
      image_url: string
      audio_url: string
      audio_duration: number   // 秒，由客户端通过 HTML5 Audio 检测
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

    // 从数据库动态查询当前激活的 avatar 模型 code 及计费配置
    const avatarModel = await db
      .selectFrom('provider_models')
      .select(['code', 'params_pricing'])
      .where('module', '=', 'avatar')
      .where('is_active', '=', true)
      .executeTakeFirst()
    app.log.info({ userId, workspaceId, avatarModel: avatarModel?.code }, '查询当前激活的 avatar 模型') 
    
    if (!avatarModel) {
      return reply.status(503).send({ error: 'No active avatar model configured' })
    }
    const OMNI_REQ_KEY = avatarModel.code

    // 校验工作区成员身份
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

    if (!team || (team.team_type !== 'standard' && team.team_type !== 'avatar_enabled')) {
      return reply.status(403).send({ success: false, error: { code: 'AVATAR_DISABLED', message: '当前团队未开通数字人能力' } })
    }

    // 检查并发数字人任务（API 只支持 1 个并发）
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

    // 按音频时长计算积分（从 params_pricing 规则中匹配单价）
    const { unitPrice } = resolveUnitPrice(avatarModel.params_pricing, undefined)
    const estimatedSeconds = Math.ceil(audio_duration)
    const estimatedCredits = estimatedSeconds * unitPrice

    // 业管 A 豆扣减（同步生成：实时余额校验 → 扣减 → 提交）。扣减即终态。
    // 提交失败时写创作结果 outbox(success=false) 由 notify worker 通知业管退款。
    const avatarIdempotencyKey = randomUUID()
    let bizMgmtBilling: { requestNo: string; bizMgmtUserId: string; workNo: string }
    try {
      const deduction = await deductBizMgmtPointsForGeneration({
        localUserId: userId,
        teamId,
        workspaceId,
        batchId: avatarIdempotencyKey,
        pointsNum: estimatedCredits,
        source: 1,
        remark: `数字人生成`,
      })
      bizMgmtBilling = deduction
    } catch (err) {
      const msg = err instanceof Error ? err.message : '业管 A 豆扣减失败'
      return reply.status(402).send({ success: false, error: { code: 'INSUFFICIENT_CREDITS', message: msg } })
    }

    // 创建 batch + task 记录
    let batchId: string
    let taskId: string
    try {
      const _bt = await db.transaction().execute(async (trx: any) => {
        const batchResult = await trx
          .insertInto('task_batches')
          .values({
            idempotency_key: avatarIdempotencyKey,
            user_id: userId,
            team_id: teamId,
            workspace_id: workspaceId,
            credit_account_id: null,
            source: 'generation',
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
      app.log.error({ err }, 'Failed to create avatar batch/task')
      // 业管扣减已完成，本地不退；写 outbox(success=false) 通知业管退款
      try {
        await enqueueBizMgmtOutboxEvent({
          eventType: 'creation_result_notify',
          dedupeKey: `creation-result:${bizMgmtBilling.requestNo}`,
          localUserId: userId, bizMgmtUserId: bizMgmtBilling.bizMgmtUserId, teamId, workspaceId,
          batchId: avatarIdempotencyKey, taskId: avatarIdempotencyKey, taskStatus: 'failed', pointsNum: estimatedCredits,
          payload: { userId: bizMgmtBilling.bizMgmtUserId, requestNo: bizMgmtBilling.requestNo, workNo: bizMgmtBilling.workNo, success: false, remark: '创作失败：avatar（batch 创建失败）' },
        })
      } catch (outboxErr) { app.log.error({ err: outboxErr }, 'Failed to enqueue avatar creation result outbox') }
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: '任务创建失败，A 豆退款将由业管处理' } })
    }

    // 提交到火山引擎 OmniHuman API
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
      app.log.info({ taskId, batchId, url, body: signedBody }, 'Submitting avatar generation task to Volcengine API')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers, body: signedBody, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }

      // 火山引擎视觉 API 返回 ResponseMetadata 结构，成功时有 data.task_id，失败时有 ResponseMetadata.Error
      const json = (await res.json()) as {
        ResponseMetadata?: { Error?: { Code?: string; CodeN?: number; Message?: string } }
        data?: { task_id?: string }
      }
      const apiError = json.ResponseMetadata?.Error
      if (apiError || !json.data?.task_id) {
        const errCode = apiError?.Code ?? 'UNKNOWN'
        const errMsg = apiError?.Message ?? 'unknown error'
        app.log.error({ taskId, batchId, response: json }, 'Volcengine API returned error')
        throw new Error(`Volcengine Avatar API error ${errCode}: ${errMsg}`)
      }
      externalTaskId = json.data.task_id
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      app.log.error({ taskId, batchId, err: lastError }, 'Avatar API submission failed')
    }

    if (!externalTaskId) {
      // 提交失败：标记任务失败，写创作结果 outbox(success=false) 通知业管退款（本地不碰积分）
      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('tasks').set({ status: 'failed', error_message: lastError.slice(0, 1000), completed_at: new Date().toISOString() }).where('id', '=', taskId).execute()
        await trx.updateTable('task_batches').set({ status: 'failed', failed_count: sql`failed_count + 1` }).where('id', '=', batchId).execute()
      })
      try {
        await enqueueBizMgmtOutboxEvent({
          eventType: 'creation_result_notify',
          dedupeKey: `creation-result:${bizMgmtBilling.requestNo}`,
          localUserId: userId, bizMgmtUserId: bizMgmtBilling.bizMgmtUserId, teamId, workspaceId,
          batchId, taskId, taskStatus: 'failed', pointsNum: estimatedCredits,
          payload: { userId: bizMgmtBilling.bizMgmtUserId, requestNo: bizMgmtBilling.requestNo, workNo: bizMgmtBilling.workNo, success: false, remark: `创作失败：avatar，${lastError.slice(0, 200)}` },
        })
      } catch (outboxErr) { app.log.error({ err: outboxErr }, 'Failed to enqueue avatar creation result outbox') }
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

export default route
