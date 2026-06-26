// 必须在 import @aigc/db 之前加载 .env（ESM 按源码顺序实例化 side-effect import）
import './test-env.js'

import { describe, test, after } from 'node:test'
import assert from 'node:assert/strict'

import { getDb, closeDb } from '@aigc/db'
import { hashApiKey } from './api-client.js'
import { provisionCaller } from './provision-caller.js'

// 本文件覆盖：provisionCaller 在单个事务内联动创建归属容器（方案 B'）。
//
// DB 策略说明：
// - 现有 apps/api/src 下的测试全部为纯函数、零真实库依赖（getDb 是模块级单例无法注入），
//   但 provisionCaller 的核心价值正是「多表事务原子性 + 表字段完整性」，纯 mock 无法验证。
//   属于「无事务测试先例 + mock 事务太复杂」情形，故走真实库 + 测试后清理。
// - 每个用例用唯一 name（test:<label>:<ts><rand>），provisionCaller 内部会生成
//   account=openapi:<name>、teams.name=openapi:<name>。after 钩子按 teams.name
//   反查 team_id，级联删除 api_clients/credit_accounts/team_members/workspaces/teams/users，
//   绝不让测试数据残留开发库。
// - 前置：.env 的 DATABASE_URL 可用、pnpm db:migrate 已落库全部表。

// 收集本次 run 成功创建的归属容器 name（即 api_clients.name / teams.name 去掉 openapi: 前缀）
// 注意：重复 name 失败用例因事务回滚不会创建任何行，故只收集成功用例的 name。
const createdNames: string[] = []

function uniqueName(label: string): string {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  // name 不带 openapi: 前缀（前缀由 provisionCaller 内部加），保证全局唯一
  return `test:${label}:${tag}`
}

// 清理本测试创建的全部行。按外键依赖反序删除。
// 注意：api_clients.team_id/workspace_id/system_user_id 是裸 uuid（无 FK），
//       credit_accounts.team_id 也是裸 uuid，故需先查 team_id 再按 id 删关联表。
async function cleanup(): Promise<void> {
  const db = getDb()
  if (createdNames.length === 0) return

  // provisionCaller 内部 teams.name = openapi:<name>，据此反查 team_id
  const teamNames = createdNames.map((n) => `openapi:${n}`)
  const teams = await db
    .selectFrom('teams')
    .select(['id', 'owner_id'])
    .where('name', 'in', teamNames)
    .execute()
  const teamIds = teams.map((t) => t.id)
  const userIds = teams.map((t) => t.owner_id)

  // 按 FK 反序级联删除（api_clients/credit_accounts/team_members/workspaces 无强 FK，手动删）
  await db.transaction().execute(async (trx) => {
    if (teamIds.length > 0) {
      await trx.deleteFrom('api_clients').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('team_members').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('workspaces').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('teams').where('id', 'in', teamIds).execute()
    }
    if (userIds.length > 0) {
      await trx.deleteFrom('users').where('id', 'in', userIds).execute()
    }
  })
}

describe('provisionCaller', () => {
  after(async () => {
    await cleanup()
    await closeDb()
  })

  test('单事务联动创建 system_user + team + workspace + team_members + api_client', async () => {
    const name = uniqueName('full')
    createdNames.push(name)

    const { apiKey, clientId } = await provisionCaller(name)

    // 明文 key 格式：aigc_ 前缀 + 随机串
    assert.ok(apiKey.startsWith('aigc_'), 'apiKey 应以 aigc_ 开头')
    assert.ok(apiKey.length > 'aigc_'.length + 16, 'apiKey 应含足够熵的随机串')

    const db = getDb()

    // api_client 存在且 api_key_hash = sha256(明文)
    const client = await db
      .selectFrom('api_clients')
      .selectAll()
      .where('id', '=', clientId)
      .executeTakeFirstOrThrow()
    assert.equal(client.api_key_hash, hashApiKey(apiKey))
    assert.equal(client.status, 'active')

    // team.name = openapi:<name>，归属正确
    const team = await db
      .selectFrom('teams')
      .selectAll()
      .where('id', '=', client.team_id!)
      .executeTakeFirstOrThrow()
    assert.equal(team.name, `openapi:${name}`)
    assert.equal(team.team_type, 'standard')

    // workspace 存在且归属该 team
    const ws = await db
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', client.workspace_id!)
      .executeTakeFirstOrThrow()
    assert.equal(ws.team_id, team.id)
    assert.equal(ws.name, '默认工作区')
    assert.equal(ws.created_by, client.system_user_id)

    // credit_account 归属该 team —— 本地积分系统已退役，provisionCaller 不再创建占位
    // credit_account，故此处不再断言余额账户（团队 A 豆余额由业管平台管理）。

    // team_members 有 owner 行（system_user 加入 team）
    const member = await db
      .selectFrom('team_members')
      .selectAll()
      .where('team_id', '=', team.id)
      .where('user_id', '=', client.system_user_id!)
      .executeTakeFirstOrThrow()
    assert.equal(member.role, 'owner')

    // system_user 字段：account/username = openapi:<name>，role=member，plan_tier=enterprise
    const sysUser = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', client.system_user_id!)
      .executeTakeFirstOrThrow()
    assert.equal(sysUser.account, `openapi:${name}`)
    assert.equal(sysUser.username, `openapi:${name}`)
    assert.equal(sysUser.role, 'member')
    assert.equal(sysUser.status, 'active')
    assert.equal(sysUser.plan_tier, 'enterprise')
    assert.equal(sysUser.password_change_required, false)
  })

  test('明文 apiKey 可经 resolveApiClient 路径校验（hashApiKey 一致）', async () => {
    const name = uniqueName('auth')
    createdNames.push(name)

    const { apiKey, clientId } = await provisionCaller(name)

    const db = getDb()
    // 用明文重新算摘要，应能命中库里这一行（与 api-client.ts 的 resolveApiClient 同一算法）
    const found = await db
      .selectFrom('api_clients')
      .select('id')
      .where('api_key_hash', '=', hashApiKey(apiKey))
      .where('status', '=', 'active')
      .executeTakeFirst()
    assert.ok(found, '明文 key 的 sha256 摘要应能命中 api_clients 行')
    assert.equal(found!.id, clientId)
  })

  test('重复 name 应失败（account 唯一约束 → 整个事务回滚，不留半成品）', async () => {
    const name = uniqueName('dup')
    createdNames.push(name)

    const first = await provisionCaller(name)
    assert.ok(first.clientId)

    // 同名二次签发：account 唯一约束应在 system_user 插入时报错，事务回滚
    await assert.rejects(
      () => provisionCaller(name),
      (err: unknown) => {
        // PG unique_violation 或 Kysely 包装错误，message 含 duplicate/unique 字样
        const msg = String((err as Error)?.message ?? '').toLowerCase()
        return msg.includes('duplicate') || msg.includes('unique') || msg.includes('冲突')
      },
    )

    // 关键：事务回滚后不应残留半成品行（team/user 等都不应存在第二个）
    const db = getDb()
    const teamCount = await db
      .selectFrom('teams')
      .where('name', '=', `openapi:${name}`)
      .execute()
    assert.equal(teamCount.length, 1, '重复签发失败后 team 仍应只有 1 行（首次成功的）')
  })
})
