import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'

const ALLOWED_COST_CONFIG_KEYS = new Set(['music_voice_clone'])

// PATCH /admin/cost-configs/:key — 更新大模型之外的费用配置
const route: FastifyPluginAsync = async (app) => {
  app.patch<{
    Params: { key: string }
    Body: { credit_cost?: number }
  }>('/admin/cost-configs/:key', async (req, reply) => {
    const db = getDb()
    const key = req.params.key
    const creditCost = req.body.credit_cost

    if (!ALLOWED_COST_CONFIG_KEYS.has(key)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '费用配置不存在' } })
    }
    if (typeof creditCost !== 'number' || !Number.isInteger(creditCost) || creditCost < 0) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: '积分费用必须是非负整数' } })
    }

    const updated = await db
      .updateTable('system_cost_configs')
      .set({ credit_cost: creditCost, updated_at: sql`now()` })
      .where('key', '=', key)
      .returning(['key', 'label', 'description', 'credit_cost', 'updated_at'])
      .executeTakeFirst()

    if (!updated) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '费用配置不存在' } })
    return updated
  })
}

export default route
