import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'

/**
 * 模型路由 — 返回当前团队可用的激活模型列表
 * 团队级别的 team_model_configs 覆盖全局 is_active 配置
 */
export async function modelRoutes(app: FastifyInstance): Promise<void> {
  // GET /models?module=image&workspace_id=xxx — 返回当前团队的激活模型
  app.get<{ Querystring: { module?: string; workspace_id?: string } }>('/models', async (req) => {
    const db = getDb()
    const userId = (req as any).user?.id as string | undefined
    const workspaceId = req.query.workspace_id

    // 通过 workspace_id 查出所属 team_id，确保团队模型配置生效
    let teamId: string | undefined
    if (workspaceId) {
      const ws = await db
        .selectFrom('workspaces')
        .select('team_id')
        .where('id', '=', workspaceId)
        .executeTakeFirst()
      teamId = ws?.team_id
    } else if (userId) {
      // 未传 workspace_id 时，取用户所在的第一个团队作为 fallback
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
        'pm.id',
        'pm.code',
        'pm.name',
        'pm.description',
        'pm.module',
        'pm.video_categories',
        'pm.credit_cost',
        'pm.params_pricing',
        'pm.params_schema',
        'pm.resolution',
        'p.code as provider_code',
        'pm.is_active as global_is_active',
        'tmc.is_active as team_is_active',
      ])
      .orderBy('pm.module', 'asc')
      .orderBy('pm.name', 'asc')

    if (req.query.module) {
      query = query.where('pm.module', '=', req.query.module as any)
    }

    const rows = await query.execute()

    // 团队配置优先：team_is_active 不为 null 时使用团队配置，否则使用全局配置
    return rows
      .filter((r) => {
        const effective = r.team_is_active !== null ? r.team_is_active : r.global_is_active
        return effective
      })
      .map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        module: r.module,
        video_categories: r.video_categories,
        credit_cost: r.credit_cost,
        params_pricing: r.params_pricing,
        params_schema: r.params_schema,
        resolution: r.resolution,
        is_active: true,
        provider_code: r.provider_code,
      }))
  })
}
