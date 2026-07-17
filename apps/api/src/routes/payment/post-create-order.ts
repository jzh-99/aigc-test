import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import { createLifeOrder, createLifeSubscriptionOrder, buildPaySign } from '../../lib/life-service.js'
import { TOPUP_PACKAGE_MAP } from '../../lib/topup-packages.js'
import type { CreateOrderRequest } from '@aigc/types'

// 确保积分账户存在，不存在则创建
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

const route: FastifyPluginAsync = async (app) => {
  // POST /payment/orders — 创建充值订单，返回 H5 支付 URL
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

    // 权限：团队充值需要 owner/admin，或 allow_member_topup=true
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

    // 确保积分账户存在
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
}

export default route
