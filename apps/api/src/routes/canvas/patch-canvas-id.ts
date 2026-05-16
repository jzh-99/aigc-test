import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// PATCH /canvases/:id — 保存 structure_data（带乐观锁）
const route: FastifyPluginAsync = async (app) => {
  app.patch<{
    Params: { id: string }
    Body: { name?: string; structure_data?: any; version: number; thumbnail_url?: string }
  }>('/canvases/:id', async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const { name, structure_data, version, thumbnail_url } = request.body

    // 拒绝超大 structure_data（2 MB 上限）
    if (structure_data !== undefined) {
      const size = JSON.stringify(structure_data).length
      if (size > 2 * 1024 * 1024) {
        return reply.status(413).send({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'structure_data 超过 2MB 限制' } })
      }
    }

    const canvas = await db
      .selectFrom('canvases')
      .select(['workspace_id', 'version'])
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权修改该画布' } })

    try {
      await assertCanvasEnabledForWorkspace(db, canvas.workspace_id)
    } catch {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    // 乐观锁：version 不匹配则返回 409
    const query = db.updateTable('canvases')
      .set({
        version: sql`version + 1`,
        updated_at: sql`now()`,
        ...(name !== undefined ? { name } : {}),
        ...(structure_data !== undefined ? { structure_data: JSON.stringify(structure_data) } : {}),
        ...(thumbnail_url !== undefined ? { thumbnail_url } : {}),
      })
      .where('id', '=', id)
      .where('version', '=', version)
      .returning(['id', 'version'])

    const updated = await query.executeTakeFirst()
    if (!updated) {
      return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: '画布已被其他设备修改，请刷新后重试' } })
    }

    return reply.send({ id: updated.id, version: updated.version })
  })
}

export default route
