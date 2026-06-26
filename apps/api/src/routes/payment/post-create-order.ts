import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { createLifeOrder, createLifeSubscriptionOrder, buildPaySign } from '../../lib/life-service.js'
import { TOPUP_PACKAGE_MAP } from '../../lib/topup-packages.js'
import type { CreateOrderRequest } from '@aigc/types'

/**
 * POST /payment/orders — 创建充值订单，返回 H5 支付 URL。
 *
 * 硬切换后本地积分系统已退役：本路由只负责创建本地订单（payment_orders）用于生命周期
 * 追踪和支付回调匹配，不再创建/关联 credit_accounts。支付成功后的 A 豆入账由
 * post-notify.ts 写 subscribe_sync outbox 事件，经业管订购同步接口完成。
 */
const route: FastifyPluginAsync = async (app) => {
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
        credit_account_id: null,
        amount_fen: pkg.amount_fen,
        credits_to_grant: pkg.credits,
        status: 'pending',
        order_type: pkg.type === 'monthly' ? 'subscription' : 'topup',
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
