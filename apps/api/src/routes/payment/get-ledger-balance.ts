import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // GET /payment/ledger?account=personal|team&team_id=xxx&page=1&limit=20
  app.get<{ Querystring: { account?: string; team_id?: string; page?: string; limit?: string } }>(
    '/payment/ledger',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { account = 'personal', team_id, page = '1', limit: limitStr = '20' } = request.query
      const limit = Math.min(Number(limitStr) || 20, 100)
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit

      let creditAccountId: string | undefined

      if (account === 'team' && team_id) {
        const membership = await db.selectFrom('team_members').select('role')
          .where('team_id', '=', team_id).where('user_id', '=', userId).executeTakeFirst()
        if (!membership || !['owner', 'admin'].includes(membership.role)) {
          return reply.forbidden('仅团队 owner/admin 可查看团队流水')
        }
        const acc = await db.selectFrom('credit_accounts').select('id')
          .where('owner_type', '=', 'team').where('team_id', '=', team_id).executeTakeFirst()
        creditAccountId = acc?.id
      } else {
        const acc = await db.selectFrom('credit_accounts').select('id')
          .where('owner_type', '=', 'user').where('user_id', '=', userId).executeTakeFirst()
        creditAccountId = acc?.id
      }

      if (!creditAccountId) return { data: [], total: 0 }

      const [rows, countRow] = await Promise.all([
        db.selectFrom('credits_ledger')
          .leftJoin('task_batches', 'task_batches.id', 'credits_ledger.batch_id')
          .leftJoin('users', 'users.id', 'credits_ledger.user_id')
          .select([
            'credits_ledger.id',
            'credits_ledger.amount',
            'credits_ledger.type',
            'credits_ledger.description',
            'credits_ledger.created_at',
            'credits_ledger.task_id',
            'credits_ledger.batch_id',
            'credits_ledger.user_id',
            'task_batches.module',
            'task_batches.model',
            'task_batches.provider',
            'task_batches.prompt',
            'task_batches.canvas_id',
            'users.username',
          ])
          .where('credits_ledger.credit_account_id', '=', creditAccountId)
          .where('credits_ledger.type', '!=', 'freeze')
          .orderBy('credits_ledger.created_at', 'desc')
          .limit(limit).offset(offset)
          .execute(),
        db.selectFrom('credits_ledger')
          .select(db.fn.countAll<number>().as('count'))
          .where('credit_account_id', '=', creditAccountId)
          .where('type', '!=', 'freeze')
          .executeTakeFirst(),
      ])

      return { data: rows, total: Number(countRow?.count ?? 0) }
    }
  )

  // GET /payment/balance?team_id=xxx — 查询积分余额
  app.get<{ Querystring: { team_id?: string } }>('/payment/balance', async (request) => {
    const db = getDb()
    const { team_id } = request.query
    const userId = request.user.id

    const [teamAccount, personalAccount] = await Promise.all([
      team_id
        ? db.selectFrom('credit_accounts').select('balance')
            .where('owner_type', '=', 'team').where('team_id', '=', team_id).executeTakeFirst()
        : Promise.resolve(null),
      db.selectFrom('credit_accounts').select('balance')
        .where('owner_type', '=', 'user').where('user_id', '=', userId).executeTakeFirst(),
    ])

    return {
      team_balance: teamAccount?.balance ?? 0,
      personal_balance: personalAccount?.balance ?? 0,
    }
  })
}

export default route
