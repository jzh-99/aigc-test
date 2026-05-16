import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/models/:id — 查询单个模型详情
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/admin/models/:id', async (req, reply) => {
    const db = getDb()
    const model = await db
      .selectFrom('provider_models as pm')
      .innerJoin('providers as p', 'p.id', 'pm.provider_id')
      .select([
        'pm.id', 'pm.code', 'pm.name', 'pm.description', 'pm.module',
        'pm.credit_cost', 'pm.params_pricing', 'pm.params_schema', 'pm.resolution', 'pm.is_active',
        'p.code as provider_code',
      ])
      .where('pm.id', '=', req.params.id)
      .executeTakeFirst()

    if (!model) return reply.status(404).send({ error: 'Model not found' })
    return model
  })
}

export default route
