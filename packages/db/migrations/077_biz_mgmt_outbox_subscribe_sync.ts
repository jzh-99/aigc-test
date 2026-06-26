import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 077_biz_mgmt_outbox_subscribe_sync.ts
 *
 * 业务管理平台 outbox 表扩展 subscribe_sync 事件类型。
 *
 * 背景：本地积分系统退役（硬切换）后，充值/包月订单支付成功不再给本地
 * credit_accounts 加余额，也不再写 credits_ledger；改为通过业管订购同步接口
 * （SUBSCRIBE_SERVICE_CODE_1001）通知业管，由业管负责给对应会员增加 A 豆。
 * 订购同步必须经 outbox 异步投递，与创作结果同步、会员副卡同步保持一致的可靠性保证
 * （幂等、指数退避重试、成功与失败记录都保留），因此在 event_type CHECK 约束中追加
 * subscribe_sync 取值。
 *
 * 兼容策略：仅追加 CHECK 枚举取值并更新表/列注释，不改变既有事件结构，历史数据不受影响。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 先删除旧的两值约束，再重建包含三类事件的三值约束
  await sql`ALTER TABLE biz_mgmt_outbox_events DROP CONSTRAINT chk_biz_mgmt_outbox_event_type`.execute(db)
  await sql`ALTER TABLE biz_mgmt_outbox_events ADD CONSTRAINT chk_biz_mgmt_outbox_event_type CHECK (event_type IN ('creation_result_notify','member_sub_card_sync','subscribe_sync'))`.execute(db)

  // 更新 event_type 列注释，补充 subscribe_sync 说明
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.event_type IS '出站事件类型。creation_result_notify=创作结果同步到 AIHUB_CREATION_RESULT_NOTIFY；member_sub_card_sync=团队成员创建后同步会员副卡到 MEMBER-1002；subscribe_sync=充值/包月订单支付成功后同步订购到 SUBSCRIBE_SERVICE_CODE_1001，由业管负责给会员加 A 豆。'`.execute(db)

  // 更新 payload 列注释，补充 subscribe_sync 结构说明（逐字段说明业务含义）
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.payload IS '出站请求 JSON。creation_result_notify 结构：userId=业管会员 ID，requestNo=扣减幂等号，workNo=作品号，success=是否成功，remark=500 字内结果说明；member_sub_card_sync 结构：phone=新成员手机号，userName=新成员名称，compName=团队/公司名称，channel=来源渠道，belongId=所属主会员 ID，initialPointsNum=副卡初始 A 豆；subscribe_sync 结构：requestNo=幂等请求号（充值订单级幂等，重复同步复用同一值），exOrderNo=本地订单号或第三方支付订单号（对应 payment_orders.life_order_id 或 payment_orders.id），phone=支付会员手机号，channel=来源渠道编号，source=来源标识，goodsId=套餐商品 ID（对应 topup-packages 配置的 id），orderType=订单类型编号（1=单次充值，2=包月订阅，按业管约定），payAmount=实付金额（元，字符串或数字），status=支付状态编号（1=成功，按业管约定），orderTime=支付时间（可选）。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 回滚：恢复为两值约束并清空 subscribe_sync 相关历史事件（仅回滚期使用）
  await sql`DELETE FROM biz_mgmt_outbox_events WHERE event_type = 'subscribe_sync'`.execute(db)
  await sql`ALTER TABLE biz_mgmt_outbox_events DROP CONSTRAINT chk_biz_mgmt_outbox_event_type`.execute(db)
  await sql`ALTER TABLE biz_mgmt_outbox_events ADD CONSTRAINT chk_biz_mgmt_outbox_event_type CHECK (event_type IN ('creation_result_notify','member_sub_card_sync'))`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.event_type IS '出站事件类型。creation_result_notify=创作结果同步到 AIHUB_CREATION_RESULT_NOTIFY；member_sub_card_sync=团队成员创建后同步会员副卡到 MEMBER-1002。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.payload IS '出站请求 JSON。creation_result_notify 结构：userId=业管会员 ID，requestNo=扣减幂等号，workNo=作品号，success=是否成功，remark=500 字内结果说明；member_sub_card_sync 结构：phone=新成员手机号，userName=新成员名称，compName=团队/公司名称，channel=来源渠道，belongId=所属主会员 ID，initialPointsNum=副卡初始 A 豆。'`.execute(db)
}
