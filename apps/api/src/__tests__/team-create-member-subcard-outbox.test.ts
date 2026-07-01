import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 团队成员创建 → 业管副卡同步（同步语义，不再走 outbox 队列）。
 *
 * 2026-06-30 改造：团长创建成员时，必须先同步调用业管 MEMBER-1002 创建副卡，
 * 业管返回成功后才写本地 users/team_members/workspaces。
 * 业管失败（1000/9999/超时）一律 502 返回，本地不落任何数据，避免脏数据。
 *
 * 旧的 outbox 异步投递链路（enqueueBizMgmtOutboxEvent + member_sub_card_sync 事件）
 * 不再用于新建成员；事件类型与 worker 派发分支保留仅用于消费改造前的遗留 pending 事件。
 */
describe('team create-member synchronously calls Toby MEMBER-1002 before writing local data', () => {
  test('必须同步调用 syncTobyMemberSubCard，且不再写 outbox', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // 必须导入并调用 api 侧同步业管接口（不再经 outbox 队列）
    assert.match(source, /from '\.\.\/\.\.\/lib\/toby-open-api\.js'/, '必须从 lib/toby-open-api 导入同步业管接口')
    assert.match(source, /syncTobyMemberSubCard/, '必须同步调用 syncTobyMemberSubCard')
    // 不允许再出现 outbox 入队调用（保留 member_sub_card_sync 字符串仅供注释说明遗留消费，不算违规——见下方精确断言）
    assert.doesNotMatch(source, /enqueueBizMgmtOutboxEvent\(/, '不再调用 enqueueBizMgmtOutboxEvent 入队')
  })

  test('业管副卡创建必须发生在本地写库之前（先调业管，再 insert users/team_members）', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    const callIdx = source.indexOf('syncTobyMemberSubCard({')
    const insertIdx = source.indexOf("insertInto('users')")
    assert.notEqual(callIdx, -1, '必须存在 syncTobyMemberSubCard 同步调用')
    assert.notEqual(insertIdx, -1, '必须存在 insertInto users 本地写库')
    assert.ok(callIdx < insertIdx, '业管调用必须在本地写 users 之前（确保业管成功才落库）')
  })

  test('业管返回非 0000 或调用异常时必须 502 返回且不落库', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // 业管业务码非成功 → 502
    assert.match(source, /tobyRes\.code !== '0000'/, '必须判断业管返回码非成功')
    assert.match(source, /status\(502\)/, '业管失败必须 502 返回')
    assert.match(source, /BIZ_MGMT_SUBCARD_FAILED/, '业务失败错误码 BIZ_MGMT_SUBCARD_FAILED')
    // 调用异常（超时/网络/解密）→ 502
    assert.match(source, /BIZ_MGMT_SUBCARD_UNREACHABLE/, '调用异常错误码 BIZ_MGMT_SUBCARD_UNREACHABLE')
  })

  test('本地账号必须与业管副卡绑定：成功创建取响应 userId，已存在用 MEMBER-1001 补查', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // 业管「会员已存在」识别：必须按 message 文案判断（业管该错误无稳定业务码），命中不 502
    assert.match(source, /已存在\|已注册\|已经存在/, '必须按 message 文案识别「会员已存在」')
    assert.match(source, /memberAlreadyExists = true/, '命中「已存在」时置位标记位')
    // 业管 0000 成功时必须取响应回传的副卡 userId（否则账号与业管副卡对不上、A 豆查不到）
    assert.match(source, /tobyRes\.decryptedData\?\.userId/, '0000 成功必须取业管响应的副卡 userId')
    // 绑定写入是必做项（不能只在「已存在」分支写，成功创建同样要写，否则新成员 A 豆丢失）
    assert.match(source, /fetchBizMgmtMembersByPhone\(identifier\)/, '必须调 MEMBER-1001 补查副卡完整身份')
    assert.match(source, /insertInto\('biz_mgmt_member_bindings'\)/, '必须写副卡绑定')
    assert.match(source, /biz_mgmt_user_id: subMember\.bizMgmtUserId/, '绑定需写入补查到的副卡 userId')
    // 已知 userId 时精确匹配该副卡（避免一手机号多副卡取错）
    assert.match(source, /m\.bizMgmtUserId === subBizMgmtUserId/, '已知 userId 时必须精确匹配')
    // 无已知 userId 时按「公司副卡（userType=2 且 !isMaster 且 status=1）」筛选
    assert.match(source, /m\.userType === '2' && !m\.isMaster && m\.status === 1/, '无 userId 时按公司副卡筛选')
    // 同一 biz_mgmt_user_id 已有旧绑定（可能绑错）时必须覆盖更新，纠正错误绑定
    assert.match(source, /column\('biz_mgmt_user_id'\)\.doUpdateSet/, '绑定冲突时必须覆盖更新（纠正旧错绑定）')
  })

  test('调业管的 payload 仍包含现行 MEMBER-1002 契约字段（compName/channel/initialPointsNum 已移除）', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // payload 必须包含业管 MEMBER-1002 现行契约必填字段
    assert.match(source, /phone: identifier/)
    assert.match(source, /userName: username/)
    assert.match(source, /belongId: ownerBinding\.biz_mgmt_user_id/)
    // 契约演进：initialPointsNum 已从 MEMBER-1002 移除，源码不可再透传/计算该字段
    assert.doesNotMatch(source, /initialPointsNum/, 'initialPointsNum 已从 MEMBER-1002 payload 移除')
    assert.doesNotMatch(source, /initial_points_num/, 'initial_points_num 已从创建成员请求体移除')
    assert.doesNotMatch(source, /rawInitialPointsNum/, 'rawInitialPointsNum 已不再解析')
    // 2026-06-29 契约更新：compName / channel 已从 MEMBER-1002 移除，源码不可再构造这两个字段
    assert.doesNotMatch(source, /compName:/, 'compName 已从 MEMBER-1002 payload 移除')
    assert.doesNotMatch(source, /channel:\s*['"]?1['"]?/, 'channel 已从 MEMBER-1002 payload 移除')
  })

  test('只有公司主卡（user_type=2 且 is_master）才能创建成员，否则 403 拒绝', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-create-member.ts'),
      'utf8',
    )
    // 取 owner binding 时必须带上 user_type 和 is_master 用于门控判断
    assert.match(source, /select\(\['biz_mgmt_user_id', 'user_type', 'is_master'\]\)/, '必须 select user_type 与 is_master 用于主卡门控')
    // 非公司主卡必须硬拒绝 403（不能跳过业管调用）
    assert.match(source, /BIZ_MGMT_NOT_MASTER/, '非公司主卡必须返回 BIZ_MGMT_NOT_MASTER')
    assert.match(source, /status\(403\)/, '非公司主卡必须 403 拒绝')
    // 门控条件必须同时校验 user_type='2' 且 is_master
    assert.match(source, /ownerBinding\.user_type !== '2' \|\| !ownerBinding\.is_master/, '必须同时校验公司会员 + 主卡')
  })
})
