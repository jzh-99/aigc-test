import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrls } from '../../lib/storage.js'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// GET /canvases/:id/all-node-outputs — 一次性批量加载画布所有节点的输出（减少请求次数）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/canvases/:id/all-node-outputs', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const canvas = await db
      .selectFrom('canvases')
      .select('workspace_id')
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    try {
      await assertCanvasEnabledForWorkspace(db, canvas.workspace_id)
    } catch {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    const outputs = await db
      .selectFrom('canvas_node_outputs')
      .leftJoin('assets', 'assets.batch_id', 'canvas_node_outputs.batch_id')
      .select([
        'canvas_node_outputs.id',
        'canvas_node_outputs.node_id',
        'canvas_node_outputs.output_urls',
        'canvas_node_outputs.is_selected',
        'canvas_node_outputs.created_at',
        'assets.type as asset_type',
      ])
      .where('canvas_node_outputs.canvas_id', '=', id)
      .orderBy('canvas_node_outputs.created_at', 'desc')
      .execute()

    // 按 node_id 分组
    const grouped: Record<string, any[]> = {}
    for (const row of outputs) {
      const nodeId = row.node_id as string
      if (!grouped[nodeId]) grouped[nodeId] = []
      grouped[nodeId].push(row)
    }

    // 对每个节点的输出 URL 签名
    for (const nodeId of Object.keys(grouped)) {
      grouped[nodeId] = await Promise.all(
        grouped[nodeId].map(async (row) => ({
          ...row,
          output_urls: await signAssetUrls(row.output_urls ?? []),
        }))
      )
    }

    return reply.send(grouped)
  })
}

export default route
