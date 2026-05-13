import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'

const route: FastifyPluginAsync = async (app) => {
  // POST /payment/notify — 支付平台异步回调（无需 JWT，通过签名验证）
  app.post<{ Body: Record<string, unknown> }>('/payment/notify', async (request, reply) => {
    const db = getDb()
    const body = request.body as Record<string, string>

    // 基础字段校验（完整签名验证待平台文档明确后补充）
    const lifeOrderId = body.orderid ?? body.orderId ?? body.order_id
    if (!lifeOrderId) return reply.badRequest('missing orderid')

    const order = await db
      .selectFrom('payment_orders')
      .selectAll()
      .where('life_order_id', '=', String(lifeOrderId))
      .executeTakeFirst()

    if (!order) return { success: true } // 未知订单，ack 防止重试

    if (order.status === 'paid') return { success: true } // 幂等处理

    const payStatus = String(body.payStatus ?? body.status ?? '')
    if (payStatus !== '1' && payStatus !== 'success' && payStatus !== '0') {
      // 支付未成功，标记失败
      await db.updateTable('payment_orders')
        .set({ status: 'failed', callback_payload: body as any })
        .where('id', '=', order.id)
        .execute()
      return { success: true }
    }

    // 在事务中完成积分入账
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

export default route
