import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// PATCH /admin/models/:id — 更新模型字段
const route: FastifyPluginAsync = async (app) => {
  app.patch<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string | null
      credit_cost?: number
      params_pricing?: unknown
      params_schema?: unknown
      resolution?: string | null
      is_active?: boolean
    }
  }>('/admin/models/:id', async (req, reply) => {
    const db = getDb()
    const { name, description, credit_cost, params_pricing, params_schema, resolution, is_active } = req.body
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (credit_cost !== undefined) updates.credit_cost = credit_cost
    if (params_pricing !== undefined) updates.params_pricing = JSON.stringify(params_pricing)
    if (params_schema !== undefined) updates.params_schema = JSON.stringify(params_schema)
    if (resolution !== undefined) updates.resolution = resolution
    if (is_active !== undefined) updates.is_active = is_active

    if (Object.keys(updates).length === 0) return reply.status(400).send({ error: 'No fields to update' })

    const updated = await db
      .updateTable('provider_models')
      .set(updates as any)
      .where('id', '=', req.params.id)
      .returningAll()
      .executeTakeFirst()

    if (!updated) return reply.status(404).send({ error: 'Model not found' })
    return updated
  })
}

export default route
