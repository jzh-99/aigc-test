import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 23（Phase D）团队成员创建后写会员副卡同步 outbox。
 *
 * 团长创建成员后，需通知业管为该成员创建会员副卡（MEMBER-1002），使新成员能在业管侧
 * 获得 A 豆账户。事件经 biz_mgmt_outbox_events（member_sub_card_sync）异步投递，保证可靠。
 */
describe('team create-member writes member_sub_card_sync outbox', () => {
  test('enqueues member sub-card sync event after creating member', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // 必须导入并调用 api 侧 outbox 入队服务
    assert.match(source, /from '\.\.\/\.\.\/services\/biz-mgmt-outbox\.js'/)
    assert.match(source, /enqueueBizMgmtOutboxEvent/)
    // 事件类型为会员副卡同步
    assert.match(source, /eventType: 'member_sub_card_sync'/)
    // dedupeKey 必须按 team+user+phone 幂等
    assert.match(source, /dedupe_key|dedupeKey.*team/i)
  })

  test('sub-card payload includes phone, userName, compName and belongId', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // payload 必须包含业管 MEMBER-1002 必填字段
    assert.match(source, /phone:/)
    assert.match(source, /userName:/)
    assert.match(source, /compName:/)
    assert.match(source, /belongId:/)
    assert.match(source, /initialPointsNum:/)
  })

  test('只有公司主卡（user_type=2 且 is_master）才能创建成员，否则 403 拒绝', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // 取 owner binding 时必须带上 user_type 和 is_master 用于门控判断
    assert.match(source, /select\(\['biz_mgmt_user_id', 'user_type', 'is_master'\]\)/, '必须 select user_type 与 is_master 用于主卡门控')
    // 非公司主卡必须硬拒绝 403（不能静默跳过 outbox）
    assert.match(source, /BIZ_MGMT_NOT_MASTER/, '非公司主卡必须返回 BIZ_MGMT_NOT_MASTER')
    assert.match(source, /status\(403\)/, '非公司主卡必须 403 拒绝')
    // 门控条件必须同时校验 user_type='2' 且 is_master
    assert.match(source, /ownerBinding\.user_type !== '2' \|\| !ownerBinding\.is_master/, '必须同时校验公司会员 + 主卡')
  })
})
