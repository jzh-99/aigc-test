import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// POST /admin/trash/teams/:id/restore — 恢复软删除的团队（含工作区和批次）
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>('/admin/trash/teams/:id/restore', async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const team = await db
      .selectFrom('teams')
      .select(['id', 'name', 'owner_id'])
      .where('id', '=', id)
      .where('is_deleted', '=', true)
      .executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '已删除的团队不存在或已过期' } })

    const ownerConflict = await db
      .selectFrom('teams').select('id')
      .where('owner_id', '=', team.owner_id).where('is_deleted', '=', false).executeTakeFirst()
    if (ownerConflict) {
      return reply.status(409).send({
        success: false,
        error: { code: 'USER_ALREADY_OWNER', message: '该团队组长已成为其他团队的组长，无法恢复' },
      })
    }

    const nameConflict = await db
      .selectFrom('teams').select('id')
      .where('name', '=', team.name).where('is_deleted', '=', false).executeTakeFirst()
    if (nameConflict) {
      return reply.status(409).send({
        success: false,
        error: { code: 'TEAM_NAME_TAKEN', message: `已有同名团队"${team.name}"，恢复前请先重命名现有团队` },
      })
    }

    await db.updateTable('teams').set({ is_deleted: false, deleted_at: null }).where('id', '=', id).execute()

    const wsIds = await db.selectFrom('workspaces').select('id').where('team_id', '=', id).where('is_deleted', '=', true).execute()
    if (wsIds.length > 0) {
      const wsIdList = wsIds.map(w => w.id)
      await db.updateTable('workspaces').set({ is_deleted: false, deleted_at: null }).where('id', 'in', wsIdList).execute()
      await db.updateTable('task_batches').set({ is_deleted: false, deleted_at: null })
        .where('workspace_id', 'in', wsIdList).where('is_deleted', '=', true).execute()
    }

    const memberIds = (await db.selectFrom('team_members').select('user_id').where('team_id', '=', id).execute())
      .map(m => m.user_id)

    if (memberIds.length > 0) {
      const activeCounts = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.user_id', db.fn.count('team_members.team_id').as('count')])
        .where('team_members.user_id', 'in', memberIds)
        .where('teams.is_deleted', '=', false)
        .where('team_members.team_id', '!=', id)
        .groupBy('team_members.user_id')
        .execute()

      const countMap = new Map(activeCounts.map(r => [r.user_id, Number(r.count)]))
      const toReactivate = memberIds.filter(uid => (countMap.get(uid) ?? 0) === 0)

      if (toReactivate.length > 0) {
        await db.updateTable('users').set({ status: 'active' })
          .where('id', 'in', toReactivate).where('status', '=', 'suspended').execute()
      }
    }

    return { success: true }
  })
}

export default route
