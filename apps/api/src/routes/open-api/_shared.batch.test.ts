// 必须在 import @aigc/db 之前加载 .env（ESM 按源码顺序实例化 side-effect import）
import '../../lib/test-env.js'

import { describe, test, after } from 'node:test'
import assert from 'node:assert/strict'

import { closeDb, getDb } from '@aigc/db'

import { ErrorCode, OpenApiError } from '../../lib/open-api-errors.js'
import { provisionCaller } from '../../lib/provision-caller.js'
import {
  createOpenApiBatch,
  isPgUniqueViolation,
  type CreateBatchInput,
} from './_shared.js'

// 本文件覆盖：createOpenApiBatch 共用提交骨架（7 种开放接口业务路由复用）。
//
// DB 策略说明（对齐 provision-caller.test.ts 的真实库 + 清理模式）：
// - createOpenApiBatch 的核心价值是「事务内 task_batches + tasks 字段完整性 + 幂等 UNIQUE」，
//   纯 mock 无法验证 PG 列级 UNIQUE 与 jsonb 序列化，故走真实库 + 测试后清理。
// - 每个用例 provisionCaller 创建独立归属容器，用例内建的 batch/task 记入 createdBatchIds，
//   after 钩子级联清理 tasks + task_batches + provisionCaller 的 6 表归属容器。
// - 前置：.env 的 DATABASE_URL 可用、pnpm db:migrate 已落库全部表。

// 本测试创建的 task_batches.id（after 清理 tasks + task_batches）
const createdBatchIds: string[] = []
// provisionCaller 创建的归属容器 name（after 清理 6 表）
const createdNames: string[] = []

function uniqueName(label: string): string {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `test:${label}:${tag}`
}

// 从 api_clients.id 查行构造 ApiClientPrincipal（对齐 plugins/api-key-auth.ts authenticateApiKey 的映射）
async function principalFromClientId(clientId: string): Promise<CreateBatchInput['apiClient']> {
  const db = getDb()
  const row = await db
    .selectFrom('api_clients')
    .selectAll()
    .where('id', '=', clientId)
    .executeTakeFirstOrThrow()
  return {
    id: row.id,
    name: row.name,
    teamId: row.team_id,
    workspaceId: row.workspace_id,
    systemUserId: row.system_user_id,
  }
}

// 收集 + 清理：先删本测试建的 tasks/task_batches，再删 provisionCaller 的归属容器 6 表。
async function cleanup(): Promise<void> {
  const db = getDb()

  // ① 清理本测试建的 tasks + task_batches（按 batch_id 反查 tasks）
  if (createdBatchIds.length > 0) {
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('tasks').where('batch_id', 'in', createdBatchIds).execute()
      await trx.deleteFrom('task_batches').where('id', 'in', createdBatchIds).execute()
    })
  }

  // ② 清理 provisionCaller 归属容器（对齐 provision-caller.test.ts 的级联清理）
  if (createdNames.length === 0) return
  const teamNames = createdNames.map((n) => `openapi:${n}`)
  const teams = await db
    .selectFrom('teams')
    .select(['id', 'owner_id'])
    .where('name', 'in', teamNames)
    .execute()
  const teamIds = teams.map((t) => t.id)
  const userIds = teams.map((t) => t.owner_id)

  await db.transaction().execute(async (trx) => {
    if (teamIds.length > 0) {
      await trx.deleteFrom('api_clients').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('credit_accounts').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('team_members').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('workspaces').where('team_id', 'in', teamIds).execute()
      await trx.deleteFrom('teams').where('id', 'in', teamIds).execute()
    }
    if (userIds.length > 0) {
      await trx.deleteFrom('users').where('id', 'in', userIds).execute()
    }
  })
}

describe('createOpenApiBatch', () => {
  after(async () => {
    await cleanup()
    await closeDb()
  })

  test('单事务建 task_batches + tasks，字段完整性正确写入', async () => {
    const name = uniqueName('batch-ok')
    createdNames.push(name)
    const { clientId } = await provisionCaller(name)
    const apiClient = await principalFromClientId(clientId)

    const input: CreateBatchInput = {
      apiClient,
      serviceType: 'image',
      taskId: `task-${Date.now()}`,
      bussinessId: `biz-${Date.now()}`,
      callbackUrl: 'https://example.com/cb',
      module: 'image',
      provider: 'ark',
      model: 'seedream-4-0',
      prompt: '一只猫',
      params: { size: '1024x1024', ref: 'abc' },
    }

    const res = await createOpenApiBatch(input)
    createdBatchIds.push(res.batchId)

    assert.ok(res.batchId, '应返回 batchId')
    assert.ok(res.internalTaskId, '应返回 internalTaskId')
    assert.notEqual(res.batchId, res.internalTaskId)

    const db = getDb()

    // task_batches 字段完整性
    const batch = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('id', '=', res.batchId)
      .executeTakeFirstOrThrow()
    assert.equal(batch.source, 'open_api')
    assert.equal(batch.module, 'image')
    assert.equal(batch.provider, 'ark')
    assert.equal(batch.model, 'seedream-4-0')
    assert.equal(batch.prompt, '一只猫')
    assert.equal(batch.status, 'pending')
    assert.equal(batch.quantity, 1)
    assert.equal(batch.estimated_credits, 0, '开放接口零积分副作用')
    assert.equal(batch.user_id, apiClient.systemUserId)
    assert.equal(batch.team_id, apiClient.teamId)
    assert.equal(batch.workspace_id, apiClient.workspaceId)
    assert.equal(batch.business_id, input.bussinessId, '内部 business_id 列存对外 bussiness_id 值')
    assert.equal(batch.callback_url, input.callbackUrl)
    assert.equal(batch.service_type, 'image')
    assert.equal(batch.task_id, input.taskId, '对外契约 task_id 正确写入')
    assert.equal(
      batch.idempotency_key,
      `openapi:${apiClient.id}:${input.taskId}`,
      '幂等键格式正确',
    )
    // params jsonb 序列化后回读应与原对象等价
    assert.deepEqual(batch.params, input.params, 'params jsonb 往返一致')

    // credit_account_id 应指向归属 team 的 team 级账户
    const acc = await db
      .selectFrom('credit_accounts')
      .select(['id', 'owner_type'])
      .where('id', '=', batch.credit_account_id)
      .executeTakeFirstOrThrow()
    assert.equal(acc.owner_type, 'team')

    // tasks 行：version_index=0、status=pending、归属 batch + system_user
    const task = await db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', res.internalTaskId)
      .executeTakeFirstOrThrow()
    assert.equal(task.batch_id, res.batchId)
    assert.equal(task.user_id, apiClient.systemUserId)
    assert.equal(task.version_index, 0)
    assert.equal(task.status, 'pending')
    assert.equal(task.estimated_credits, 0)
  })

  test('重复同 apiClient + taskId → 抛 OpenApiError(DUPLICATE_TASK)', async () => {
    const name = uniqueName('batch-dup')
    createdNames.push(name)
    const { clientId } = await provisionCaller(name)
    const apiClient = await principalFromClientId(clientId)

    const taskId = `dup-${Date.now()}`
    const input: CreateBatchInput = {
      apiClient,
      serviceType: 'video',
      taskId,
      bussinessId: `biz-dup-${Date.now()}`,
      callbackUrl: 'https://example.com/cb',
      module: 'video',
      provider: 'ark',
      model: 'seedance-2-0',
      prompt: '一段视频',
      params: { duration: 5 },
    }

    const first = await createOpenApiBatch(input)
    createdBatchIds.push(first.batchId)

    // 同 apiClient + 同 taskId 二次提交应命中 idempotency_key UNIQUE
    await assert.rejects(
      () => createOpenApiBatch(input),
      (err: unknown) => err instanceof OpenApiError && err.code === ErrorCode.DUPLICATE_TASK,
    )

    // 验证：只建了 1 行 task_batches（首次的），无半成品残留
    const db = getDb()
    const rows = await db
      .selectFrom('task_batches')
      .select('id')
      .where('idempotency_key', '=', `openapi:${apiClient.id}:${taskId}`)
      .execute()
    assert.equal(rows.length, 1, '重复提交后 task_batches 应仍只有 1 行')
  })

  test('不同 apiClient 用相同 taskId 不冲突（idempotency_key 含 apiClient.id 维度）', async () => {
    const name1 = uniqueName('batch-a')
    const name2 = uniqueName('batch-b')
    createdNames.push(name1, name2)
    const c1 = await provisionCaller(name1)
    const c2 = await provisionCaller(name2)
    const a1 = await principalFromClientId(c1.clientId)
    const a2 = await principalFromClientId(c2.clientId)

    const taskId = `shared-${Date.now()}`
    const base = {
      taskId,
      bussinessId: `biz-shared-${Date.now()}`,
      callbackUrl: 'https://example.com/cb',
      module: 'news' as const,
      provider: 'ark',
      model: 'doubao-news',
      prompt: '资讯',
      params: {},
      serviceType: 'news',
    }

    const r1 = await createOpenApiBatch({ ...base, apiClient: a1 })
    const r2 = await createOpenApiBatch({ ...base, apiClient: a2 })
    createdBatchIds.push(r1.batchId, r2.batchId)

    assert.notEqual(r1.batchId, r2.batchId, '不同调用方相同 taskId 应各自成功建 batch')
  })
})

describe('isPgUniqueViolation', () => {
  test('err.code === 23505 → true', () => {
    assert.equal(isPgUniqueViolation({ code: '23505' }), true)
  })

  test('message 含 duplicate → true', () => {
    assert.equal(isPgUniqueViolation(new Error('duplicate key value')), true)
  })

  test('message 含 unique → true', () => {
    assert.equal(isPgUniqueViolation(new Error('violates unique constraint')), true)
  })

  test('无关错误 → false', () => {
    assert.equal(isPgUniqueViolation(new Error('connection timeout')), false)
    assert.equal(isPgUniqueViolation({ code: '42P01' }), false)
    assert.equal(isPgUniqueViolation(null), false)
    assert.equal(isPgUniqueViolation(undefined), false)
  })
})
