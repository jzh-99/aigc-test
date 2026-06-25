import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { buildSignedRequest } from '../../lib/volcengine-visual-sign.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { ACTION_API_VERSION } from './_shared.js'
import { deductBizMgmtPointsForGeneration } from '../../services/biz-mgmt-a-bean.js'
import { enqueueBizMgmtOutboxEvent } from '../../services/biz-mgmt-outbox.js'

// POST /action-imitation/generate — 提交动作模仿视频生成任务
const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: {
      workspace_id: string
      image_base64: string   // base64，不含 data:xxx;base64, 前缀
      image_mime: string     // 'image/jpeg' | 'image/png'
      video_url: string      // 已上传视频的公开 URL
      video_duration: number // 秒，由客户端通过 HTML5 Video API 检测
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

    // 从 DB 动态查询当前激活的动作模仿模型 code 及计费配置
    const actionModel = await db
      .selectFrom('provider_models')
      .select(['code', 'params_pricing'])
      .where('module', '=', 'action_imitation')
      .where('is_active', '=', true)
      .executeTakeFirst()

    if (!actionModel) {
      return reply.status(503).send({ error: 'No active action imitation model configured' })
    }
    const ACTION_REQ_KEY = actionModel.code

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

    // 检查并发动作模仿任务（API 只支持 1 个并发）
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

    // 按视频时长计算积分（从 params_pricing 规则中匹配单价）
    const { unitPrice } = resolveUnitPrice(actionModel.params_pricing, undefined)
    const estimatedSeconds = Math.ceil(video_duration)
    const estimatedCredits = estimatedSeconds * unitPrice

    // 业管 A 豆扣减（同步生成：实时余额校验 → 扣减 → 提交）。扣减即终态。
    // 提交失败时写创作结果 outbox(success=false) 由 notify worker 通知业管退款。
    const actionIdempotencyKey = randomUUID()
    let bizMgmtBilling: { requestNo: string; bizMgmtUserId: string; workNo: string }
    try {
      const deduction = await deductBizMgmtPointsForGeneration({
        localUserId: userId,
        teamId,
        workspaceId,
        batchId: actionIdempotencyKey,
        pointsNum: estimatedCredits,
        source: 1,
        remark: `动作模仿生成`,
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
            idempotency_key: actionIdempotencyKey,
            user_id: userId,
            team_id: teamId,
            workspace_id: workspaceId,
            credit_account_id: null,
            source: 'generation',
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
      app.log.error({ err }, 'Failed to create action_imitation batch/task')
      // 业管扣减已完成，本地不退；写 outbox(success=false) 通知业管退款
      try {
        await enqueueBizMgmtOutboxEvent({
          eventType: 'creation_result_notify',
          dedupeKey: `creation-result:${bizMgmtBilling.requestNo}`,
          localUserId: userId, bizMgmtUserId: bizMgmtBilling.bizMgmtUserId, teamId, workspaceId,
          batchId: actionIdempotencyKey, taskId: actionIdempotencyKey, taskStatus: 'failed', pointsNum: estimatedCredits,
          payload: { userId: bizMgmtBilling.bizMgmtUserId, requestNo: bizMgmtBilling.requestNo, workNo: bizMgmtBilling.workNo, success: false, remark: '创作失败：action_imitation（batch 创建失败）' },
        })
      } catch (outboxErr) { app.log.error({ err: outboxErr }, 'Failed to enqueue action_imitation creation result outbox') }
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: '任务创建失败，A 豆退款将由业管处理' } })
    }

    // 提交到火山引擎 Action Imitation 2.0 API
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
          payload: { userId: bizMgmtBilling.bizMgmtUserId, requestNo: bizMgmtBilling.requestNo, workNo: bizMgmtBilling.workNo, success: false, remark: `创作失败：action_imitation，${lastError.slice(0, 200)}` },
        })
      } catch (outboxErr) { app.log.error({ err: outboxErr }, 'Failed to enqueue action_imitation creation result outbox') }
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

export default route
