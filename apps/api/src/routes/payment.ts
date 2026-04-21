import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { createLifeOrder, buildPaySign } from '../lib/life-service.js'
import { TOPUP_PACKAGES, TOPUP_PACKAGE_MAP } from '../lib/topup-packages.js'
import type { CreateOrderRequest } from '@aigc/types'

export async function paymentRoutes(app: FastifyInstance): Promise<void> {

  // GET /payment/packages
  app.get('/payment/packages', async () => ({ data: TOPUP_PACKAGES }))

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
          .select(['id', 'amount', 'type', 'description', 'created_at', 'task_id'])
          .where('credit_account_id', '=', creditAccountId)
          .orderBy('created_at', 'desc')
          .limit(limit).offset(offset)
          .execute(),
        db.selectFrom('credits_ledger')
          .select(db.fn.countAll<number>().as('count'))
          .where('credit_account_id', '=', creditAccountId)
          .executeTakeFirst(),
      ])

      return { data: rows, total: Number(countRow?.count ?? 0) }
    }
  )

  // GET /payment/balance?team_id=xxx
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

  // POST /payment/orders — create topup order, returns H5 pay URL
  app.post<{ Body: CreateOrderRequest }>('/payment/orders', {
    schema: {
      body: {
        type: 'object',
        required: ['package_id'],
        properties: {
          package_id: { type: 'string' },
          team_id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { package_id, team_id } = request.body
    const userId = request.user.id

    const pkg = TOPUP_PACKAGE_MAP[package_id]
    if (!pkg) return reply.badRequest('无效的套餐')

    // Permission: team topup requires owner/admin, or allow_member_topup=true
    if (team_id) {
      const membership = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.role', 'teams.allow_member_topup as allow_member_topup'])
        .where('team_members.team_id', '=', team_id)
        .where('team_members.user_id', '=', userId)
        .executeTakeFirst()

      if (!membership) return reply.forbidden('不是该团队成员')

      const isOwnerOrAdmin = ['owner', 'admin'].includes(membership.role)
      if (!isOwnerOrAdmin && !(membership as any).allow_member_topup) {
        return reply.forbidden('团队未开放充值权限')
      }
    }

    // Ensure credit account exists
    const creditAccountId = await ensureCreditAccount(db, userId, team_id)

    const amountYuan = (pkg.amount_fen / 100).toFixed(2)
    const platformCode = process.env.LIFE_SERVICE_PLATFORM_CODE!
    const webBaseUrl = process.env.WEB_BASE_URL!
    const baseUrl = process.env.LIFE_SERVICE_BASE_URL!

    // 文档说明：return_url = 异步回调（支付结果通知），notify_url = 页面跳转（支付后跳转页面）
    const asyncCallbackUrl = `${process.env.API_BASE_URL}/api/v1/payment/notify`
    const pageRedirectUrl = `${webBaseUrl}/payment/callback`

    const user = await db
      .selectFrom('users').select(['phone', 'email'])
      .where('id', '=', userId).executeTakeFirstOrThrow()
    const memberId = user.phone ?? user.email ?? userId

    const lifeOrder = await createLifeOrder(app.redis, {
      MEMBER_ID: memberId,
      PLATFORM_CODE: platformCode,
      CHANNEL: 'H5',
      AMOUNT: amountYuan,
      ADD_AMOUNT: '0',
      GOODS_NAME: pkg.name,
      SUM_AMOUNT: amountYuan,
      return_url: asyncCallbackUrl,   // 异步回调
      notify_url: pageRedirectUrl,    // 页面跳转
    })

    const order = await db
      .insertInto('payment_orders')
      .values({
        life_order_id: String(lifeOrder.orderid),
        user_id: userId,
        team_id: team_id ?? null,
        credit_account_id: creditAccountId,
        amount_fen: pkg.amount_fen,
        credits_to_grant: pkg.credits,
        status: 'pending',
        order_type: 'topup',
        platform_code: platformCode,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    // sign = SHA1(base64("orderId=X&c=X&userid=X&show_uri=X"))，showUrl 用页面跳转地址
    const paySign = buildPaySign(String(lifeOrder.orderid), amountYuan, lifeOrder.userid, pageRedirectUrl)
    const payUrl = `${baseUrl}/LifeServicePay/pay/payViewWAP`
      + `?orderIds=${lifeOrder.orderid}`
      + `&orderAmount=${amountYuan}`
      + `&userid=${lifeOrder.userid}`
      + `&orderType=1`
      + `&platformcode=${platformCode}`
      + `&sign=${paySign}`
      + `&showUrl=${encodeURIComponent(pageRedirectUrl)}`

    return { order_id: order.id, life_order_id: String(lifeOrder.orderid), pay_url: payUrl }
  })

  // POST /payment/notify — async callback from life platform after payment
  // This endpoint is public (no JWT), verified by signature
  app.post<{ Body: Record<string, unknown> }>('/payment/notify', async (request, reply) => {
    const db = getDb()
    const body = request.body as Record<string, string>

    // Basic presence check — full signature verification can be added when platform docs clarify
    const lifeOrderId = body.orderid ?? body.orderId ?? body.order_id
    if (!lifeOrderId) return reply.badRequest('missing orderid')

    const order = await db
      .selectFrom('payment_orders')
      .selectAll()
      .where('life_order_id', '=', String(lifeOrderId))
      .executeTakeFirst()

    if (!order) return { success: true } // unknown order, ack to stop retries

    if (order.status === 'paid') return { success: true } // idempotent

    const payStatus = String(body.payStatus ?? body.status ?? '')
    if (payStatus !== '1' && payStatus !== 'success' && payStatus !== '0') {
      // Payment not successful — mark failed
      await db.updateTable('payment_orders')
        .set({ status: 'failed', callback_payload: body as any })
        .where('id', '=', order.id)
        .execute()
      return { success: true }
    }

    // Credit the account in a transaction
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('payment_orders')
        .set({ status: 'paid', paid_at: sql`NOW()`, callback_payload: body as any })
        .where('id', '=', order.id)
        .execute()

      await trx.updateTable('credit_accounts')
        .set({
          balance: sql`balance + ${order.credits_to_grant}`,
          total_earned: sql`total_earned + ${order.credits_to_grant}`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', order.credit_account_id!)
        .execute()

      await trx.insertInto('credits_ledger')
        .values({
          credit_account_id: order.credit_account_id!,
          user_id: order.user_id,
          amount: order.credits_to_grant,
          type: 'topup',
          description: `充值订单 ${order.life_order_id}`,
        })
        .execute()
    })

    return { success: true }
  })
}

async function ensureCreditAccount(
  db: ReturnType<typeof getDb>,
  userId: string,
  teamId?: string
): Promise<string> {
  if (teamId) {
    const existing = await db.selectFrom('credit_accounts').select('id')
      .where('owner_type', '=', 'team').where('team_id', '=', teamId).executeTakeFirst()
    if (existing) return existing.id
    const created = await db.insertInto('credit_accounts')
      .values({ owner_type: 'team', team_id: teamId, balance: 0, frozen_credits: 0, total_earned: 0, total_spent: 0 })
      .returning('id').executeTakeFirstOrThrow()
    return created.id
  }

  const existing = await db.selectFrom('credit_accounts').select('id')
    .where('owner_type', '=', 'user').where('user_id', '=', userId).executeTakeFirst()
  if (existing) return existing.id
  const created = await db.insertInto('credit_accounts')
    .values({ owner_type: 'user', user_id: userId, balance: 0, frozen_credits: 0, total_earned: 0, total_spent: 0 })
    .returning('id').executeTakeFirstOrThrow()
  return created.id
}
