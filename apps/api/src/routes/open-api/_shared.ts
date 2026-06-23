// 开放接口共享：错误处理 + 认证 preHandler
// HTTP 状态码对齐源项目 app/api 两段式语义（HTTP 表达框架层结果，body result.code 表达业务结果）：
//   - Fastify schema 校验失败（err.validation）：HTTP 422 + PARAM_ERROR
//     （对齐源项目 app/main.py:39 RequestValidationError 全局 handler）
//   - OpenApiError(AUTH_FAILED)：HTTP 401 + body code/publicMessage
//     （对齐源项目 app/api/deps.py:22,39 认证 HTTPException）
//   - OpenApiError(其他 code)：HTTP 200 + body code/publicMessage
//     （对齐源项目各 routes_*.py 路由内 return error_response()，业务错误走 200，
//      由 body code 表达业务结果，客户端按 result.code 判定）
//   - 未知异常：HTTP 500 + SYSTEM_FAILED，不泄漏内部堆栈
// body 结构对齐源项目 error_response 的 result 子结构：{ result: { code, message } }
import type { FastifyReply, FastifyRequest } from 'fastify'

import { getDb } from '@aigc/db'

import { ErrorCode, errorMessage, OpenApiError } from '../../lib/open-api-errors.js'
import { authenticateApiKey, type ApiClientPrincipal } from '../../plugins/api-key-auth.js'

// 业务错误响应体（对齐源项目 error_response 的 result 子结构）
function buildBusinessBody(code: string, message?: string): { result: { code: string; message: string } } {
  return { result: { code, message: message ?? errorMessage(code) } }
}

// 开放接口统一错误响应（scoped 到 /api/v3 实例，不影响 /api/v1 的默认错误格式）
// 四档判断：schema 校验 422 / AUTH 401 / 业务 200 / 未知 500
export function sendOpenApiError(reply: FastifyReply, err: unknown): void {
  // 1. Fastify schema 校验失败：错误对象带 validation 字段（优先判断，对齐源项目 422）
  if (err != null && typeof err === 'object' && Array.isArray((err as { validation?: unknown }).validation)) {
    reply.status(422).send(buildBusinessBody(ErrorCode.PARAM_ERROR))
    return
  }

  // 2. 业务错误：AUTH 特判 401，其余统一 200（body code 表达业务结果）
  if (err instanceof OpenApiError) {
    const httpStatus = err.code === ErrorCode.AUTH_FAILED ? 401 : 200
    reply.status(httpStatus).send(buildBusinessBody(err.code, err.publicMessage))
    return
  }

  // 3. 兜底：未知异常转 SYSTEM_FAILED + HTTP 500（避免泄漏内部堆栈）
  reply.status(500).send(buildBusinessBody(ErrorCode.SYSTEM_FAILED))
}

// 开放接口路由的认证 preHandler：失败抛 OpenApiError(AUTH_FAILED)，
// 由 setErrorHandler 转为 401 + code 响应。
// 包装为 Fastify preHandler 签名（request, reply），调用底层 authenticateApiKey。
export async function openApiPreHandler(request: FastifyRequest): Promise<void> {
  await authenticateApiKey(request)
}

// ─── createOpenApiBatch：7 种开放接口业务路由共用的提交骨架 ──────────────────────
//
// 职责：在单个事务内写 task_batches(1) + tasks(1)，统一填齐开放接口契约字段
// （source=open_api / estimated_credits=0 零积分副作用 / business_id / callback_url /
//   task_id 对外契约 / service_type）。
// 幂等：idempotency_key = `openapi:<apiClientId>:<对外taskId>`，命中 task_batches
// 的列级 UNIQUE 约束（迁移 006 创建）→ PG 23505 → 转 OpenApiError(DUPLICATE_TASK)。
//
// 对齐源项目 app/services/request_records.py:build_initial_record_values 的字段意图，
// TS 侧字段以 packages/db schema 为准（无 as any）。
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 对外请求体字段 bussiness_id（少一个 i）、task_id → 路由层做映射，
//     内部 DB 列 business_id（规范拼写）。本函数接收的 bussinessId 即对外字段值。

// task_batches.module 枚举字面量（对齐迁移 071 的 chk_tb_module CHECK 约束）
export type TaskBatchModule =
  | 'image'
  | 'video'
  | 'tts'
  | 'lipsync'
  | 'agent'
  | 'avatar'
  | 'action_imitation'
  | 'storyboard'
  | 'upload'
  | 'music'
  | 'music_voice_clone'
  | 'picture_book'
  | 'short_drama'
  | 'text'
  | 'podcast'
  | 'news'
  | 'storybook'

export interface CreateBatchInput {
  // 认证后的调用方主体（含 teamId/workspaceId/systemUserId）
  apiClient: ApiClientPrincipal
  // 业务类型标识：image | song | video | news | podcast | storybook | text
  serviceType: string
  // 对外契约 task_id（区别于内部 batch id）
  taskId: string
  // 对外业务流水号（源项目 bussiness_id 拼写）
  bussinessId: string
  callbackUrl: string
  module: TaskBatchModule
  provider: string
  model: string
  prompt: string
  // 供应商参数快照；schema.params 是 jsonb（Insert 类型为 string），需 JSON.stringify
  params: Record<string, unknown>
}

export interface CreateBatchResult {
  // task_batches.id（内部 batch 标识）
  batchId: string
  // tasks.id（内部任务标识，version_index=0 的单任务）
  internalTaskId: string
}

// 判定 PG unique_violation（SQLSTATE 23505）。
// 兼容三种错误形状：node-postgres 的 DatabaseError（err.code）、Kysely 原生错误、
// 以及 message 含 duplicate/unique 字样的兜底（部分驱动/中间层包装）。
export function isPgUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === '23505') return true
  const msg = String(e.message ?? '').toLowerCase()
  return msg.includes('duplicate') || msg.includes('unique') || msg.includes('冲突')
}

// 查归属 team 的 credit_account（owner_type=team）。
// provisionCaller 为每个调用方建了唯一一个 team 级 credit_account，故 takeFirstOrThrow。
async function findTeamCreditAccountId(teamId: string): Promise<string> {
  const db = getDb()
  const acc = await db
    .selectFrom('credit_accounts')
    .select('id')
    .where('team_id', '=', teamId)
    .where('owner_type', '=', 'team')
    .executeTakeFirstOrThrow(
      () => new OpenApiError(ErrorCode.SYSTEM_FAILED, `调用方归属 team 缺少 credit_account: ${teamId}`),
    )
  return acc.id
}

// 7 种开放接口业务路由共用的提交骨架：事务内建 task_batches + tasks。
// estimated_credits 固定 0（开放接口零积分副作用，balance 占位由 provisionCaller 兜底）。
// 重复同 apiClient + taskId → 命中 idempotency_key UNIQUE → DUPLICATE_TASK。
export async function createOpenApiBatch(input: CreateBatchInput): Promise<CreateBatchResult> {
  const teamId = input.apiClient.teamId
  const systemUserId = input.apiClient.systemUserId
  if (!teamId || !systemUserId) {
    // 归属主体不完整：provisionCaller 保证三字段齐全，此处理论上不应触发
    throw new OpenApiError(ErrorCode.AUTH_FAILED, '调用方归属主体不完整')
  }

  const creditAccountId = await findTeamCreditAccountId(teamId)
  // 幂等键：同 apiClient + 同对外 taskId 视为重复提交（对齐源项目 DUPLICATE_TASK 语义）
  const idempotencyKey = `openapi:${input.apiClient.id}:${input.taskId}`
  const db = getDb()

  try {
    return await db.transaction().execute(async (trx) => {
      const batch = await trx
        .insertInto('task_batches')
        .values({
          user_id: systemUserId,
          team_id: teamId,
          workspace_id: input.apiClient.workspaceId,
          credit_account_id: creditAccountId,
          idempotency_key: idempotencyKey,
          source: 'open_api',
          module: input.module,
          provider: input.provider,
          model: input.model,
          prompt: input.prompt,
          // schema.params 是 jsonb（ColumnType<unknown, string, string>），Insert 需字符串
          params: JSON.stringify(input.params),
          quantity: 1,
          status: 'pending',
          estimated_credits: 0,
          business_id: input.bussinessId,
          callback_url: input.callbackUrl,
          service_type: input.serviceType,
          task_id: input.taskId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      const task = await trx
        .insertInto('tasks')
        .values({
          batch_id: batch.id,
          user_id: systemUserId,
          version_index: 0,
          status: 'pending',
          estimated_credits: 0,
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      return { batchId: batch.id, internalTaskId: task.id }
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new OpenApiError(ErrorCode.DUPLICATE_TASK)
    }
    throw err
  }
}

// 注：成功响应信封直接复用 ../../lib/open-api-errors.ts 的 successResponse(taskId)
// （返回 { result: { task_id, code: '0000', message: '正在加速生成中，请稍等' } }），
// 与计划描述的 accepted 完全一致，故此处不再重复定义 accepted。
