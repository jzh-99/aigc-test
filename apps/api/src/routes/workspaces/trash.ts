import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /teams/:id/trash — 列出软删除的工作区（7 天内）
  app.get<{ Params: { id: string } }>('/teams/:id/trash', {
    preHandler: teamRoleGuard('owner'),
  }, async (request) => {
    const db = getDb()
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'deleted_at'])
      .where('team_id', '=', request.params.id)
      .where('is_deleted', '=', true)
      .where('deleted_at', '>=', cutoff as any)
      .orderBy('deleted_at', 'desc')
      .execute()

    return { data: workspaces }
  })

  // POST /teams/:id/trash/:wsId/restore — 恢复软删除的工作区
  app.post<{ Params: { id: string; wsId: string } }>('/teams/:id/trash/:wsId/restore', {
    preHandler: teamRoleGuard('owner'),
  }, async (request, reply) => {
    const db = getDb()
    const { id: teamId, wsId } = request.params

    const workspace = await db
      .selectFrom('workspaces')
      .select(['id', 'name'])
      .where('id', '=', wsId)
      .where('team_id', '=', teamId)
      .where('is_deleted', '=', true)
      .executeTakeFirst()
    if (!workspace) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '已删除的工作区不存在或已过期' } })

    // 恢复前检查名称唯一性
    const nameConflict = await db
      .selectFrom('workspaces')
      .select('id')
      .where('team_id', '=', teamId)
      .where('name', '=', workspace.name)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (nameConflict) {
      return reply.status(409).send({
        success: false,
        error: { code: 'WORKSPACE_NAME_TAKEN', message: `已有同名工作区"${workspace.name}"，恢复前请先重命名现有工作区` },
      })
    }

    await db
      .updateTable('workspaces')
      .set({ is_deleted: false, deleted_at: null })
      .where('id', '=', wsId)
      .execute()

    // 同步恢复 task_batches
    await db
      .updateTable('task_batches')
      .set({ is_deleted: false, deleted_at: null })
      .where('workspace_id', '=', wsId)
      .where('is_deleted', '=', true)
      .execute()

    return { success: true }
  })

  // DELETE /teams/:id/trash/:wsId — 永久删除工作区
  app.delete<{ Params: { id: string; wsId: string } }>('/teams/:id/trash/:wsId', {
    preHandler: teamRoleGuard('owner'),
  }, async (request, reply) => {
    const db = getDb()
    const { id: teamId, wsId } = request.params

    const workspace = await db
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', wsId)
      .where('team_id', '=', teamId)
      .where('is_deleted', '=', true)
      .executeTakeFirst()
    if (!workspace) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '工作区不存在或未被删除' } })

    // 获取所有 batch ID
    const batchIds = (await db.selectFrom('task_batches').select('id').where('workspace_id', '=', wsId).execute()).map(b => b.id)

    if (batchIds.length > 0) {
      await db.deleteFrom('assets').where('batch_id', 'in', batchIds).execute()
      await db.deleteFrom('tasks').where('batch_id', 'in', batchIds).execute()
      await db.deleteFrom('task_batches').where('id', 'in', batchIds).execute()
    }

    await db.deleteFrom('workspace_members').where('workspace_id', '=', wsId).execute()
    await db.deleteFrom('workspaces').where('id', '=', wsId).execute()

    return { success: true }
  })
}

export default route
