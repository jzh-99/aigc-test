import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// 模型列表路由：支持按模块过滤，并根据团队配置决定模型是否启用
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { module?: string; workspace_id?: string } }>('/models', async (req) => {
    const db = getDb()
    // 兼容未登录场景（healthz 等公开路由），user 可能不存在
    const userId = (req as unknown as { user?: { id: string } }).user?.id
    const workspaceId = req.query.workspace_id

    let teamId: string | undefined
    if (workspaceId) {
      // 通过工作空间 ID 查找所属团队
      const ws = await db
        .selectFrom('workspaces')
        .select('team_id')
        .where('id', '=', workspaceId)
        .executeTakeFirst()
      teamId = ws?.team_id
    } else if (userId) {
      // 通过用户 ID 查找所属团队（取第一个）
      const member = await db
        .selectFrom('team_members')
        .select('team_id')
        .where('user_id', '=', userId)
        .limit(1)
        .executeTakeFirst()
      teamId = member?.team_id
    }

    let query = db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.id', 'pm.provider_id')
      .leftJoin('team_model_configs as tmc', (join) =>
        teamId
          ? join.onRef('tmc.model_id', '=', 'pm.id').on('tmc.team_id', '=', teamId)
          : join.onRef('tmc.model_id', '=', 'pm.id').onRef('tmc.team_id', '=', 'pm.id')
      )
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.description', 'pm.module',
        'pm.video_categories', 'pm.credit_cost', 'pm.params_pricing',
        'pm.params_schema', 'pm.resolution', 'p.code as provider_code',
        'pm.is_active as global_is_active', 'tmc.is_active as team_is_active',
      ])
      .orderBy('pm.module', 'asc')
      .orderBy('pm.name', 'asc')

    if (req.query.module) {
      query = query.where('pm.module', '=', req.query.module as never)
    }

    const rows = await query.execute()

    // 团队配置优先于全局配置：team_is_active 不为 null 时以团队配置为准
    return rows
      .filter((r) => {
        const effective = r.team_is_active !== null ? r.team_is_active : r.global_is_active
        return effective
      })
      .map((r) => ({
        id: r.id, code: r.code, name: r.name, description: r.description,
        module: r.module, video_categories: r.video_categories,
        credit_cost: r.credit_cost, params_pricing: r.params_pricing,
        params_schema: r.params_schema, resolution: r.resolution,
        is_active: true, provider_code: r.provider_code,
      }))
  })
}

export default route
