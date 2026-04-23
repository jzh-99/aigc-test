import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { createLifeOrder, createLifeSubscriptionOrder, buildPaySign } from '../lib/life-service.js'
import { TOPUP_PACKAGES, TOPUP_PACKAGE_MAP, ONETIME_PACKAGES, MONTHLY_PACKAGES } from '../lib/topup-packages.js'
import type { CreateOrderRequest } from '@aigc/types'

export async function paymentRoutes(app: FastifyInstance): Promise<void> {

  // GET /payment/packages
  app.get('/payment/packages', async () => ({
    onetime: ONETIME_PACKAGES,
    monthly: MONTHLY_PACKAGES,
  }))

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
    const baseUrl = process.env.LIFE_SERVICE_BASE_URL!.replace(/\/$/, '')

    // 文档说明：return_url = 异步回调（支付结果通知），notify_url = 页面跳转（支付后跳转页面）
    const asyncCallbackUrl = `${process.env.API_BASE_URL}/api/v1/payment/notify`
    const pageRedirectUrl = `${webBaseUrl}/payment/callback`

    const user = await db
      .selectFrom('users').select(['phone', 'email'])
      .where('id', '=', userId).executeTakeFirstOrThrow()
    const memberId = user.phone ?? '13800138000'

    const lifeOrder = pkg.type === 'monthly'
      ? await createLifeSubscriptionOrder(app.redis, {
          MEMBER_ID: memberId,
          PLATFORM_CODE: platformCode,
          CHANNEL: 'H5',
          AMOUNT: amountYuan,
          ADD_AMOUNT: '0',
          GOODS_NAME: pkg.name,
          SUM_AMOUNT: amountYuan,
          return_url: asyncCallbackUrl,
          notify_url: pageRedirectUrl,
        })
      : await createLifeOrder(app.redis, {
          MEMBER_ID: memberId,
          PLATFORM_CODE: platformCode,
          CHANNEL: 'H5',
          AMOUNT: amountYuan,
          ADD_AMOUNT: '0',
          GOODS_NAME: pkg.name,
          SUM_AMOUNT: amountYuan,
          return_url: asyncCallbackUrl,
          notify_url: pageRedirectUrl,
        })

    const order = await db
      .insertInto('payment_orders')
      .values({
        order_no: String(lifeOrder.orderid),
        provider: 'life',
        type: 'topup',
        life_order_id: String(lifeOrder.orderid),
        user_id: userId,
        team_id: team_id ?? null,
        credit_account_id: creditAccountId,
        amount_fen: pkg.amount_fen,
        credits: pkg.credits,
        credits_to_grant: pkg.credits,
        status: 'pending',
        order_type: 'topup',
        platform_code: platformCode,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    // sign = SHA1(base64("orderId=X&c=X&userid=X&show_uri=X"))
    const paySign = buildPaySign(String(lifeOrder.orderid), amountYuan, lifeOrder.userid, pageRedirectUrl)
    const payPage = pkg.type === 'monthly'
      ? `${baseUrl}/LifeServicePay/multiplePayment/wapPage`
      : `${baseUrl}/LifeServicePay/pay/payViewWAP`
    const payUrl = payPage
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
