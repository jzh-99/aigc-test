import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 19 业管 outbox 扩展 subscribe_sync 事件类型迁移测试。
 *
 * 背景：本地积分系统退役后，充值/包月订单支付成功不再给本地 credit_accounts 加余额，
 * 改为通过业管订购同步接口（SUBSCRIBE_SERVICE_CODE_1001）通知业管由其加 A 豆。
 * 订购同步必须经 outbox 异步投递（与创作结果、会员副卡一致的可靠性保证），
 * 因此需要在 biz_mgmt_outbox_events.event_type 的 CHECK 约束中追加 subscribe_sync。
 */
describe('077_biz_mgmt_outbox_subscribe_sync migration', () => {
  test('extends outbox event_type check constraint with subscribe_sync', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/077_biz_mgmt_outbox_subscribe_sync.ts'),
      'utf8',
    )

    // 必须先删除旧约束再重建包含三类事件的约束
    assert.match(source, /DROP CONSTRAINT chk_biz_mgmt_outbox_event_type/)
    assert.match(
      source,
      /ADD CONSTRAINT chk_biz_mgmt_outbox_event_type CHECK \(event_type IN \('creation_result_notify','member_sub_card_sync','subscribe_sync'\)\)/,
    )
  })

  test('documents subscribe_sync event_type and payload fields in comments', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/077_biz_mgmt_outbox_subscribe_sync.ts'),
      'utf8',
    )

    // event_type 注释必须新增 subscribe_sync 说明
    assert.match(source, /subscribe_sync=充值\/包月订单支付成功后同步订购到 SUBSCRIBE_SERVICE_CODE_1001/)
    // payload 注释必须新增 subscribe_sync 结构说明，逐字段说明
    assert.match(source, /subscribe_sync 结构：requestNo=幂等请求号/)
    assert.match(source, /exOrderNo=本地订单号或第三方支付订单号/)
    assert.match(source, /goodsId=套餐商品 ID/)
    assert.match(source, /orderType=订单类型/)
    assert.match(source, /payAmount=实付金额/)
    assert.match(source, /status=支付状态/)
  })
})
