import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'

/**
 * 模型路由 — 返回当前团队可用的激活模型列表
 * 团队级别的 team_model_configs 覆盖全局 is_active 配置
 */
export async function modelRoutes(app: FastifyInstance): Promise<void> {
  // GET /models?module=image — 返回当前团队的激活模型
  app.get<{ Querystring: { module?: string } }>('/models', async (req) => {
    const db = getDb()
    // teamId 可能不存在（未登录请求），此时 leftJoin 匹配不到任何 team_model_configs 记录
    // 效果等同于只用全局 is_active，属于正确行为
    const teamId = (req as any).user?.teamId as string | undefined

    let query = db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.id', 'pm.provider_id')
      // leftJoin：有团队配置则取团队配置，否则 tmc.is_active 为 null
      .leftJoin('team_model_configs as tmc', (join) =>
        join
          .onRef('tmc.model_id', '=', 'pm.id')
          .on('tmc.team_id', '=', teamId ?? '')
      )
      .select([
        'pm.id',
        'pm.code',
        'pm.name',
        'pm.module',
        'pm.credit_cost',
        'pm.params_pricing',
        'pm.params_schema',
        'p.code as provider_code',
        'pm.is_active as global_is_active',
        'tmc.is_active as team_is_active',
      ])
      .orderBy('pm.module', 'asc')
      .orderBy('pm.name', 'asc')

    // 按模块过滤（可选）
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
        module: r.module,
        credit_cost: r.credit_cost,
        params_pricing: r.params_pricing,
        params_schema: r.params_schema,
        is_active: true,
        provider_code: r.provider_code,
      }))
  })
}
