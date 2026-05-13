import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'

// DELETE /admin/teams/:id — 软删除团队，级联删除工作区和任务批次，暂停无其他团队的成员
const route: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { id: string } }>('/admin/teams/:id', async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const team = await db
      .selectFrom('teams')
      .select(['id', 'name'])
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '团队不存在' } })

    const now = new Date()

    const wsIds = await db
      .selectFrom('workspaces')
      .select('id')
      .where('team_id', '=', id)
      .where('is_deleted', '=', false)
      .execute()

    if (wsIds.length > 0) {
      const wsIdList = wsIds.map(w => w.id)
      await db.updateTable('workspaces').set({ is_deleted: true, deleted_at: now }).where('id', 'in', wsIdList).execute()
      await db.updateTable('task_batches').set({ is_deleted: true, deleted_at: now })
        .where('workspace_id', 'in', wsIdList).where('is_deleted', '=', false).execute()
    }

    await db.updateTable('teams').set({ is_deleted: true, deleted_at: now }).where('id', '=', id).execute()

    const memberIds = (await db.selectFrom('team_members').select('user_id').where('team_id', '=', id).execute())
      .map(m => m.user_id)

    if (memberIds.length > 0) {
      const activeCounts = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.user_id', db.fn.count('team_members.team_id').as('count')])
        .where('team_members.user_id', 'in', memberIds)
        .where('teams.is_deleted', '=', false)
        .groupBy('team_members.user_id')
        .execute()

      const countMap = new Map(activeCounts.map(r => [r.user_id, Number(r.count)]))
      const toSuspend = memberIds.filter(uid => (countMap.get(uid) ?? 0) === 0)

      if (toSuspend.length > 0) {
        await db.updateTable('users').set({ status: 'suspended' }).where('id', 'in', toSuspend).execute()
        await db.updateTable('refresh_tokens').set({ revoked_at: sql`NOW()` })
          .where('user_id', 'in', toSuspend).where('revoked_at', 'is', null).execute()
      }
    }

    return { success: true }
  })
}

export default route
