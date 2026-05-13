import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/teams/:id/model-configs — 查询团队所有模型的启用状态（含全局默认与团队覆盖）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/admin/teams/:id/model-configs', async (req) => {
    const db = getDb()
    const rows = await db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.id', 'pm.provider_id')
      .leftJoin('team_model_configs as tmc', (join) =>
        join.onRef('tmc.model_id', '=', 'pm.id').on('tmc.team_id', '=', req.params.id)
      )
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.module',
        'pm.credit_cost', 'pm.is_active as global_is_active',
        'p.code as provider_code',
        'tmc.is_active as team_is_active',
      ])
      .orderBy('pm.module', 'asc')
      .orderBy('pm.name', 'asc')
      .execute()

    // 团队有覆盖配置时取团队值，否则取全局值
    return rows.map((r) => ({
      ...r,
      effective_is_active: r.team_is_active !== null ? r.team_is_active : r.global_is_active,
      has_override: r.team_is_active !== null,
    }))
  })
}

export default route
