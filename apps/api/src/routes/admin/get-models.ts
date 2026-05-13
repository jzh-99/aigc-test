import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/models — 查询所有模型（支持按 module 过滤）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { module?: string } }>('/admin/models', async (req) => {
    const db = getDb()
    let query = db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.id', 'pm.provider_id')
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.description', 'pm.module',
        'pm.credit_cost', 'pm.params_pricing', 'pm.params_schema', 'pm.resolution', 'pm.is_active',
        'p.code as provider_code',
      ])
      .orderBy('pm.module', 'asc')
      .orderBy('pm.name', 'asc')

    if (req.query.module) {
      query = query.where('pm.module', '=', req.query.module as any)
    }
    return query.execute()
  })
}

export default route
