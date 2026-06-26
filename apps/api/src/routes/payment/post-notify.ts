import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import { enqueueBizMgmtOutboxEvent } from '../../services/biz-mgmt-outbox.js'

/**
 * POST /payment/notify — 支付平台异步回调（无需 JWT，通过签名验证）。
 *
 * 硬切换后本地积分系统已退役：支付成功不再给 credit_accounts 加余额、不再写
 * credits_ledger。改为在本地标记订单 paid 后，写一条 subscribe_sync outbox 事件，
 * 由 biz-mgmt-notify-queue 调用业管订购同步接口（SUBSCRIBE_SERVICE_CODE_1001），
 * 由业管负责给对应会员增加 A 豆。余额权威在业管，本地不维护。
 *
 * outbox 写入与订单状态更新在同一个事务内完成，保证「订单已支付」与「待通知业管」
 * 状态一致；outbox 失败由队列指数退避重试，最终失败保留 failed 记录供人工补偿。
 */
const route: FastifyPluginAsync = async (app) => {
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

    // 读取支付用户手机号（业管订购同步必填）与套餐信息
    const user = await db
      .selectFrom('users')
      .select(['phone'])
      .where('id', '=', order.user_id)
      .executeTakeFirst()
    const phone = user?.phone ?? null

    // 标记订单 paid，并写入 subscribe_sync outbox 事件（同事务）
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('payment_orders')
        .set({ status: 'paid', paid_at: sql`NOW()`, callback_payload: body as any })
        .where('id', '=', order.id)
        .execute()

      // 仅在拿到手机号时入队订购同步；缺手机号无法通知业管，订单仍记 paid，
      // 由运营核对（业管订购同步接口要求 phone 必填）。
      if (phone) {
        const requestNo = `subscribe-${order.id}`
        const orderType = order.order_type === 'subscription' ? 2 : 1
        const payAmountYuan = (order.amount_fen / 100).toFixed(2)
        await trx.insertInto('biz_mgmt_outbox_events')
          .values({
            event_type: 'subscribe_sync',
            dedupe_key: requestNo,
            local_user_id: order.user_id,
            phone,
            team_id: order.team_id,
            points_num: String(order.credits_to_grant),
            payload: sql`${JSON.stringify({
              requestNo,
              exOrderNo: order.life_order_id,
              phone,
              channel: 1,
              source: 'aihub',
              goodsId: order.order_type,
              orderType,
              payAmount: payAmountYuan,
              status: 1,
              orderTime: new Date().toISOString(),
            })}::jsonb`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute()
      }
    })

    return { success: true }
  })
}

export default route
