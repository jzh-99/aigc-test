import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// PUT /admin/teams/:id/model-configs/:modelId — 设置团队对某模型的启用状态（upsert）
const route: FastifyPluginAsync = async (app) => {
  app.put<{
    Params: { id: string; modelId: string }
    Body: { is_active: boolean }
  }>('/admin/teams/:id/model-configs/:modelId', async (req) => {
    const db = getDb()
    await db
      .insertInto('team_model_configs')
      .values({ team_id: req.params.id, model_id: req.params.modelId, is_active: req.body.is_active })
      .onConflict((oc: any) =>
        oc.columns(['team_id', 'model_id']).doUpdateSet({ is_active: req.body.is_active })
      )
      .execute()
    return { ok: true }
  })
}

export default route
