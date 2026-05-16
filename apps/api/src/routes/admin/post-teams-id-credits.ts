import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { stripHtml } from '../../lib/sanitize.js'
import type { TopUpCreditsRequest } from '@aigc/types'

// POST /admin/teams/:id/credits — 调整A豆（正数充值，负数扣减）
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: TopUpCreditsRequest }>('/admin/teams/:id/credits', {
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: -1000000, maximum: 1000000 },
          description: { type: 'string', maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { amount, description: rawDesc } = request.body
    if (amount === 0) return reply.badRequest('amount must be a non-zero number')
    const description = rawDesc ? stripHtml(rawDesc).slice(0, 200) : undefined

    const db = getDb()
    const creditAccount = await db
      .selectFrom('credit_accounts')
      .select(['id', 'balance', 'frozen_credits'])
      .where('team_id', '=', request.params.id)
      .where('owner_type', '=', 'team')
      .executeTakeFirst()
    if (!creditAccount) return reply.notFound('Team credit account not found')

    if (amount > 0) {
      await db.updateTable('credit_accounts').set({
        balance: sql`balance + ${amount}`,
        total_earned: sql`total_earned + ${amount}`,
      }).where('id', '=', creditAccount.id).execute()

      await db.insertInto('credits_ledger').values({
        credit_account_id: creditAccount.id,
        user_id: request.user.id,
        amount,
        type: 'topup',
        description: description ?? 'Admin top-up',
      }).execute()
    } else {
      const deduction = Math.abs(amount)
      const available = Number(creditAccount.balance) - Number(creditAccount.frozen_credits)
      if (available < deduction) {
        return reply.badRequest('可扣减余额不足，请检查当前余额和冻结金额')
      }

      await db.updateTable('credit_accounts').set({
        balance: sql`balance - ${deduction}`,
        total_spent: sql`total_spent + ${deduction}`,
      }).where('id', '=', creditAccount.id).execute()

      await db.insertInto('credits_ledger').values({
        credit_account_id: creditAccount.id,
        user_id: request.user.id,
        amount,
        type: 'refund',
        description: description ?? 'Admin deduction',
      }).execute()
    }

    const updated = await db
      .selectFrom('credit_accounts')
      .select(['balance', 'frozen_credits', 'total_earned', 'total_spent'])
      .where('id', '=', creditAccount.id)
      .executeTakeFirstOrThrow()

    return updated
  })
}

export default route
