// 开放接口文本润色路由（Phase 7，同步链路 —— 唯一不走队列的业务）。
//
// 移植源项目 app/api/routes_text.py:polish_text：
//   ① 校验 schema（task_id 1-50 / create_mode 枚举 0-4 / input_text 非空）
//   ② 校验 ARK_API_KEY 配置 → 空则 MODEL_CONFIG_ERROR（HTTP 400，对齐源 HTTPException(400)）
//   ③ createOpenApiBatch 事务建 task_batches + tasks（source=open_api，幂等防重复 task_id）
//   ④ 同步调 polishText（Ark /chat/completions）→ 失败转 EXTERNAL_SERVICE_FAILED
//   ⑤ 输出安全检测：aigc-test 暂无对应能力，跳过（与图片/视频等各 phase 一致，Phase 8 统一接入）
//   ⑥ 同步状态流转（task pending → completed/failed，零积分不建 ledger）
//   ⑦ HTTP 同步返回 {result:{task_id, code, message}, meta:{output_text}}
//
// 与异步链路的差异（重要）：
//   - 不走 BullMQ 队列，api 进程同步完成全流程
//   - 不调用 dispatchBatchResult（无回调，直接 HTTP 返回）
//   - 响应体必须带 meta（对齐源 success_response/error_response 总带 meta），
//     故业务错误在路由内直接构造响应，不走 sendOpenApiError（后者不带 meta）
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 对外请求体字段 input_text / create_mode（snake_case，源项目原样）
//
// HTTP 状态码（对齐源项目两段式 + MODEL_CONFIG_ERROR 特例）：
//   - schema 校验失败 → 422（sendOpenApiError）
//   - AUTH_FAILED → 401（sendOpenApiError）
//   - MODEL_CONFIG_ERROR → 400（源 HTTPException(400)，路由内直接构造）
//   - DUPLICATE_TASK / EXTERNAL_SERVICE_FAILED → 200（源 error_response，路由内直接构造带 meta）
//   - 成功 → 200（带 meta.output_text）
import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'

import { getDb } from '@aigc/db'

import { ErrorCode, errorMessage, OpenApiError } from '../../lib/open-api-errors.js'
import { polishText } from '../../lib/ark-text.js'
import { createOpenApiBatch, openApiPreHandler } from './_shared.js'

// 请求体 schema（对齐源 schemas/text.py:TextPolishRequest）
// create_mode 枚举 0-4（对齐源 field_validator：0-3 润色场景，4 行业分类）
// bussiness_id 不参与（文本润色源项目不带 bussiness_id）
const TEXT_BODY = {
  type: 'object',
  required: ['task_id', 'create_mode', 'input_text'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', minLength: 1, maxLength: 50 },
    create_mode: { type: 'string', enum: ['0', '1', '2', '3', '4'] },
    input_text: { type: 'string', minLength: 1 },
  },
}

// 文本润色模型（对齐源 config.py:ark_text_model；与 ark-text.ts 同源，此处仅 params 快照用）
const ARK_TEXT_MODEL = process.env.ARK_TEXT_MODEL ?? 'doubao-seed-2-0-lite-260215'

// ─── 同步状态流转：task pending → completed/failed（零积分，不建 ledger）────────
// 文本润色 estimated_credits=0，不涉及冻结/扣减/退还，故跳过 credit_accounts 与 ledger 变动，
// 仅更新 tasks.status + task_batches 计数与终态（对齐源 AigcRequest 直接 success/failure）。
async function markTextSucceeded(taskId: string, batchId: string): Promise<void> {
  const db = getDb()
  await db.transaction().execute(async (trx: any) => {
    const taskUpdate = await trx
      .updateTable('tasks')
      .set({
        status: 'completed',
        credits_cost: 0,
        completed_at: new Date().toISOString(),
      })
      .where('id', '=', taskId)
      .where('status', '!=', 'completed')
      .where('status', '!=', 'failed')
      .execute()
    // 幂等保护：任务已处理则跳过（对齐 complete.ts 的 numUpdatedRows 判定）
    if (Number((taskUpdate as any)[0]?.numUpdatedRows ?? (taskUpdate as any).numUpdatedRows ?? 0) === 0) {
      return
    }
    await trx
      .updateTable('task_batches')
      .set({
        completed_count: sql`completed_count + 1`,
        status: 'completed',
      })
      .where('id', '=', batchId)
      .execute()
  })
}

async function markTextFailed(taskId: string, batchId: string, errorMessageText: string): Promise<void> {
  const db = getDb()
  await db.transaction().execute(async (trx: any) => {
    const taskUpdate = await trx
      .updateTable('tasks')
      .set({
        status: 'failed',
        error_message: errorMessageText.slice(0, 1000),
        completed_at: new Date().toISOString(),
      })
      .where('id', '=', taskId)
      .where('status', '!=', 'completed')
      .where('status', '!=', 'failed')
      .execute()
    if (Number((taskUpdate as any)[0]?.numUpdatedRows ?? (taskUpdate as any).numUpdatedRows ?? 0) === 0) {
      return
    }
    await trx
      .updateTable('task_batches')
      .set({
        failed_count: sql`failed_count + 1`,
        status: 'failed',
      })
      .where('id', '=', batchId)
      .execute()
  })
}

const route: FastifyPluginAsync = async (app) => {
  app.post(
    '/chat/completions',
    {
      schema: { body: TEXT_BODY },
      preHandler: [openApiPreHandler],
    },
    async (request, reply) => {
      const b = request.body as {
        task_id: string
        create_mode: string
        input_text: string
      }
      // preHandler 已挂载 request.apiClient（非空断言：openApiPreHandler 失败会抛 AUTH_FAILED）
      const apiClient = request.apiClient!

      // 步骤①：校验 ARK_API_KEY 配置（对齐源 _provider_key 的 MODEL_CONFIG_ERROR）
      // 源项目通过 HTTPException(400) 抛出，此处对齐 HTTP 400 + body code + meta:{}
      const arkApiKey = process.env.ARK_API_KEY
      if (!arkApiKey) {
        return reply.status(400).send({
          result: {
            task_id: b.task_id,
            code: ErrorCode.MODEL_CONFIG_ERROR,
            message: errorMessage(ErrorCode.MODEL_CONFIG_ERROR),
          },
          meta: {},
        })
      }

      // 步骤②：建 task_batches + tasks（事务内，幂等防重复 task_id）
      // service_type='text' / module='text' / callback_url='' （同步链路无回调）
      // params 快照存 create_mode + input_text（用户文本，非 base64，无需脱敏）
      let batchId: string
      let internalTaskId: string
      try {
        const created = await createOpenApiBatch({
          apiClient,
          serviceType: 'text',
          taskId: b.task_id,
          bussinessId: '',
          callbackUrl: '',
          module: 'text',
          provider: 'ark',
          model: ARK_TEXT_MODEL,
          prompt: b.input_text,
          params: { create_mode: b.create_mode, input_text: b.input_text },
        })
        batchId = created.batchId
        internalTaskId = created.internalTaskId
      } catch (err) {
        // DUPLICATE_TASK：对齐源 IntegrityError 分支的 error_response（HTTP 200 + meta:{}）
        if (err instanceof OpenApiError && err.code === ErrorCode.DUPLICATE_TASK) {
          return reply.status(200).send({
            result: {
              task_id: b.task_id,
              code: ErrorCode.DUPLICATE_TASK,
              message: errorMessage(ErrorCode.DUPLICATE_TASK),
            },
            meta: {},
          })
        }
        throw err
      }

      // 步骤③：同步调 Ark /chat/completions 文本润色
      // 失败 → markTextFailed + EXTERNAL_SERVICE_FAILED（HTTP 200 + meta.output_text=""，对齐源 failure_payload）
      try {
        const outputText = await polishText({
          apiKey: arkApiKey,
          inputText: b.input_text,
          createMode: b.create_mode,
        })

        // 步骤④：输出安全检测 —— aigc-test 暂无对应能力，跳过
        // （对齐各 phase 一致策略；Phase 8 统一接入输出安全围栏后补 SECURITY_CHECK_FAILED 分支）

        // 步骤⑤：成功状态流转
        await markTextSucceeded(internalTaskId, batchId)

        // 步骤⑥：同步返回成功（对齐源 success_response(task_id, {output_text})）
        return reply.status(200).send({
          result: {
            task_id: b.task_id,
            code: ErrorCode.SUCCESS,
            message: errorMessage(ErrorCode.SUCCESS),
          },
          meta: { output_text: outputText },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        request.log.error({ err: msg, taskId: b.task_id }, '[text] 文本润色失败')

        await markTextFailed(internalTaskId, batchId, msg)

        return reply.status(200).send({
          result: {
            task_id: b.task_id,
            code: ErrorCode.EXTERNAL_SERVICE_FAILED,
            message: errorMessage(ErrorCode.EXTERNAL_SERVICE_FAILED),
          },
          meta: { output_text: '' },
        })
      }
    },
  )
}

export default route
