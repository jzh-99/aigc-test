import { randomUUID } from 'node:crypto'

import { getDb } from '@aigc/db'

import { hashApiKey } from './api-client.js'

// 开放接口调用方「归属容器」联动创建（方案 B'）。
//
// 背景：开放接口流量需归属真实租户，而非平台级幽灵账号。每个 api_client 1:1 对应一个
// 归属容器（system_user + team + 默认 workspace + team_members）。
// 本地积分系统已退役，不再创建占位 credit_account；开放接口任务零积分，生成路由已传
// creditAccountId=null，余额校验由业管或零积分旁路处理。
//
// 在单个事务内联动建表，任一步失败则整体回滚，杜绝半成品行。明文 api_key 仅在此处返回一次，
// 库内只存 sha256 摘要（对齐 api-client.ts 的 hashApiKey，与源项目 passlib 方案不互通）。

export interface ProvisionResult {
  // 明文 api_key（仅此一次返回，调用方需妥善保存）
  apiKey: string
  // api_clients.id
  clientId: string
}

// 签发一个开放接口调用方及其归属容器。
// name 全局唯一（system_user.account / api_clients.name 均有 unique 约束），
// 重复 name 会因事务回滚抛错。
export async function provisionCaller(name: string): Promise<ProvisionResult> {
  const db = getDb()
  // 明文 key：aigc_ 前缀 + 去横线的 uuid（对齐源 create_api_key.py 的 aigc_ 格式）
  const apiKey = 'aigc_' + randomUUID().replace(/-/g, '')
  const apiKeyHash = hashApiKey(apiKey)

  const clientId = await db.transaction().execute(async (trx) => {
    // ① system_user：account/username = openapi:<name>，role=member，plan_tier=enterprise
    //    password_hash 用占位符（系统用户永不可登录，仅用于 task_batches.user_id 归属）
    const sysUser = await trx
      .insertInto('users')
      .values({
        account: `openapi:${name}`,
        username: `openapi:${name}`,
        password_hash: '!',
        role: 'member',
        status: 'active',
        plan_tier: 'enterprise',
        password_change_required: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    const sysUserId = sysUser.id

    // ② team：归属该 system_user，team_type=standard
    const team = await trx
      .insertInto('teams')
      .values({
        name: `openapi:${name}`,
        owner_id: sysUserId,
        plan_tier: 'enterprise',
        team_type: 'standard',
        allow_member_topup: false,
        is_deleted: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    // ③ 默认 workspace
    const workspace = await trx
      .insertInto('workspaces')
      .values({
        team_id: team.id,
        name: '默认工作区',
        created_by: sysUserId,
        is_deleted: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    // ④ team_members：system_user 以 owner 身份加入 team
    //    （本地积分系统已退役，不再创建占位 credit_account；开放接口任务零积分，
    //     生成路由已传 creditAccountId=null，余额校验由业管或零积分旁路处理）
    await trx
      .insertInto('team_members')
      .values({
        team_id: team.id,
        user_id: sysUserId,
        role: 'owner',
      })
      .execute()

    // ⑥ api_clients：绑定归属 team/workspace/system_user + api_key_hash
    const client = await trx
      .insertInto('api_clients')
      .values({
        name,
        api_key_hash: apiKeyHash,
        status: 'active',
        team_id: team.id,
        workspace_id: workspace.id,
        system_user_id: sysUserId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return client.id
  })

  return { apiKey, clientId }
}
