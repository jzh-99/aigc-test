import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // PATCH /teams/:id/members/:uid — 更新成员角色或优先特权
  // （成员配额已退役，credit_quota/quota_period 字段保留在 body 兼容旧前端但忽略）
  app.patch<{ Params: { id: string; uid: string }; Body: { role?: string; credit_quota?: number | null; quota_period?: string | null; priority_boost?: boolean } }>('/teams/:id/members/:uid', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request, reply) => {
    const { role, priority_boost } = request.body ?? {}
    // credit_quota / quota_period 已退役，忽略；仅 role / priority_boost 生效
    if (role === undefined && priority_boost === undefined) {
      return reply.badRequest('At least one field (role, priority_boost) is required')
    }

    // 只有全局管理员可以设置 priority_boost
    if (priority_boost !== undefined && request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '只有管理员可以设置优先特权' } })
    }

    const db = getDb()
    const updates: Record<string, unknown> = {}
    if (role !== undefined) updates.role = role
    if (priority_boost !== undefined) updates.priority_boost = priority_boost

    await db
      .updateTable('team_members')
      .set(updates)
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()

    return { success: true }
  })

  // POST /teams/:id/members/:uid/reset-credits — 【已退役】成员配额已移除，A 豆由业管统一管理
  app.post<{ Params: { id: string; uid: string } }>('/teams/:id/members/:uid/reset-credits', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (_request, reply) => {
    return reply.code(410).send({
      success: false,
      error: {
        code: 'LOCAL_CREDITS_RETIRED',
        message: '成员配额已移除，A 豆余额与消耗由业管平台统一管理，本地重置配额已退役。',
      },
    })
  })

  // DELETE /teams/:id/members/:uid — 移除成员
  app.delete<{ Params: { id: string; uid: string } }>('/teams/:id/members/:uid', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request, reply) => {
    const db = getDb()

    // 不允许移除 owner
    const member = await db
      .selectFrom('team_members')
      .select('role')
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .executeTakeFirst()

    if (!member) return reply.notFound('Member not found')
    if (member.role === 'owner') {
      return reply.status(403).send({
        success: false,
        error: { code: 'CANNOT_REMOVE_OWNER', message: '无法移除团队所有者' },
      })
    }
    if (member.role === 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: 'CANNOT_REMOVE_ADMIN', message: '管理员角色不允许直接移除，请先将其降级为普通成员' },
      })
    }

    // 检查是否有进行中的生成任务
    const pendingBatches = await db
      .selectFrom('task_batches')
      .select(db.fn.count('id').as('count'))
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirstOrThrow()

    if (Number(pendingBatches.count) > 0) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'HAS_PENDING_TASKS',
          message: '该成员有进行中的生成任务，请等待任务完成后再移除',
        },
      })
    }

    // 从该团队的所有工作区中移除
    const workspaceIds = await db
      .selectFrom('workspaces')
      .select('id')
      .where('team_id', '=', request.params.id)
      .execute()

    if (workspaceIds.length > 0) {
      await db
        .deleteFrom('workspace_members')
        .where('user_id', '=', request.params.uid)
        .where('workspace_id', 'in', workspaceIds.map(w => w.id))
        .execute()
    }

    await db
      .deleteFrom('team_members')
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()

    // 如果用户没有其他团队，暂停账号
    const remainingTeams = await db
      .selectFrom('team_members')
      .select(db.fn.count('team_id').as('count'))
      .where('user_id', '=', request.params.uid)
      .executeTakeFirstOrThrow()

    if (Number(remainingTeams.count) === 0) {
      await db
        .updateTable('users')
        .set({ status: 'suspended' })
        .where('id', '=', request.params.uid)
        .execute()

      // 撤销所有 refresh token，防止被暂停的用户继续使用
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('user_id', '=', request.params.uid)
        .where('revoked_at', 'is', null)
        .execute()
    }

    return { success: true }
  })
}

export default route
