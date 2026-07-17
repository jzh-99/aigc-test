import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// DELETE /admin/teams/:id/model-configs/:modelId — 删除团队对某模型的覆盖配置（恢复全局默认）
const route: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { id: string; modelId: string } }>(
    '/admin/teams/:id/model-configs/:modelId',
    async (req) => {
      const db = getDb()
      await db
        .deleteFrom('team_model_configs')
        .where('team_id', '=', req.params.id)
        .where('model_id', '=', req.params.modelId)
        .execute()
      return { ok: true }
    },
  )
}

export default route
