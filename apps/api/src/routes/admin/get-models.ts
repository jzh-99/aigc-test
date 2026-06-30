import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { normalizeModelJsonFields } from '../../lib/model-json.js'

// GET /admin/models — 查询所有模型（支持按 module 过滤）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { module?: string } }>('/admin/models', async (req) => {
    const db = getDb()
    let query = db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.code', 'pm.provider_code')
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.description', 'pm.module',
        'pm.category_references',
        'pm.params_pricing', 'pm.params_schema', 'pm.resolution', 'pm.is_active',
        'pm.avatar',
        'pm.provider_code as provider_code',
      ])
      .orderBy('pm.module', 'asc')
      .orderBy('pm.name', 'asc')

    if (req.query.module) {
      query = query.where('pm.module', '=', req.query.module as any)
    }
    const rows = await query.execute()
    return rows.map((row) => normalizeModelJsonFields(row))
  })
}

export default route
