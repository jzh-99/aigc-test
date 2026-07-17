import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/cost-configs — 查询大模型之外的费用配置
const route: FastifyPluginAsync = async (app) => {
  app.get('/admin/cost-configs', async () => {
    const db = getDb()
    return db
      .selectFrom('system_cost_configs')
      .select(['key', 'label', 'description', 'credit_cost', 'updated_at'])
      .orderBy('key', 'asc')
      .execute()
  })
}

export default route
