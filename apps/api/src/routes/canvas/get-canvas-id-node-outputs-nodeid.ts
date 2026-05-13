import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrls } from '../../lib/storage.js'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// GET /canvases/:id/node-outputs/:nodeId — 加载单个节点的历史输出（含签名 URL）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string; nodeId: string } }>('/canvases/:id/node-outputs/:nodeId', {
    config: {
      rateLimit: {
        max: 480,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id, nodeId } = request.params

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
        'canvas_node_outputs.output_urls',
        'canvas_node_outputs.is_selected',
        'canvas_node_outputs.created_at',
        'assets.type as asset_type',
      ])
      .where('canvas_node_outputs.canvas_id', '=', id)
      .where('canvas_node_outputs.node_id', '=', nodeId)
      .orderBy('canvas_node_outputs.created_at', 'desc')
      .execute()

    // 对每条记录的 output_urls 数组签名
    const signed = await Promise.all(
      outputs.map(async (row) => ({
        ...row,
        output_urls: await signAssetUrls(row.output_urls ?? []),
      }))
    )

    return reply.send(signed)
  })
}

export default route
