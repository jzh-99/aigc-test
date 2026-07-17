import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { getStoryboardQueue } from '../../lib/queue.js'

// POST /canvas-agent/storyboard-split — 分镜拆分任务入队（BullMQ 异步）
const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: { script: string; shotCount: number; canvasId: string; canvasNodeId: string }
  }>(
    '/canvas-agent/storyboard-split',
    {
      schema: {
        body: {
          type: 'object',
          required: ['script', 'shotCount', 'canvasId', 'canvasNodeId'],
          properties: {
            script: { type: 'string', maxLength: 10000 },
            shotCount: { type: 'number', minimum: 0, maximum: 50 },
            canvasId: { type: 'string', format: 'uuid' },
            canvasNodeId: { type: 'string', maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const { script, shotCount, canvasId, canvasNodeId } = request.body
      const userId = request.user.id
      const db = getDb()

      // 验证用户对该画布有访问权限
      const canvas = await db
        .selectFrom('canvases')
        .select('workspace_id')
        .where('id', '=', canvasId)
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!canvas) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })
      }

      const member = await db
        .selectFrom('workspace_members')
        .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
        .select(['workspaces.team_id'])
        .where('workspace_members.workspace_id', '=', canvas.workspace_id)
        .where('workspace_members.user_id', '=', userId)
        .executeTakeFirst()

      if (!member && request.user.role !== 'admin') {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })
      }

      const teamId = member?.team_id ?? ''

      // 查团队积分账户（不扣积分，但字段 NOT NULL）
      const creditAccount = await db
        .selectFrom('credit_accounts')
        .select('id')
        .where('team_id', '=', teamId)
        .where('owner_type', '=', 'team')
        .executeTakeFirst()

      if (!creditAccount) {
        return reply.status(402).send({ success: false, error: { code: 'NO_CREDIT_ACCOUNT', message: '未找到积分账户' } })
      }

      // 创建 task_batches + task 记录
      const batchId = crypto.randomUUID()
      const taskId = crypto.randomUUID()

      await db.transaction().execute(async (trx: any) => {
        await trx
          .insertInto('task_batches')
          .values({
            id: batchId,
            user_id: userId,
            team_id: teamId,
            workspace_id: canvas.workspace_id,
            credit_account_id: creditAccount.id,
            idempotency_key: crypto.randomUUID(),
            source: 'canvas',
            module: 'storyboard',
            provider: 'qwen',
            model: process.env.QWEN_MODEL ?? 'qwen3.6-plus',
            prompt: script.slice(0, 500),
            params: JSON.stringify({ shotCount }),
            quantity: 1,
            status: 'pending',
            estimated_credits: 0,
            canvas_id: canvasId,
            canvas_node_id: canvasNodeId,
          })
          .execute()

        await trx
          .insertInto('tasks')
          .values({
            id: taskId,
            batch_id: batchId,
            user_id: userId,
            version_index: 0,
            estimated_credits: 0,
            status: 'pending',
          })
          .execute()
      })

      // 入队
      await getStoryboardQueue().add('storyboard', {
        taskId,
        batchId,
        userId,
        teamId,
        creditAccountId: creditAccount.id,
        estimatedCredits: 0,
        canvasId,
        canvasNodeId,
        script,
        shotCount,
      })

      return reply.status(201).send({
        success: true,
        batchId,
        taskId,
        status: 'pending',
      })
    },
  )
}

export default route
