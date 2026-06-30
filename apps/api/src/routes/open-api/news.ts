// 开放接口资讯生成路由（Phase 6）。
//
// 对齐源项目 app/api/routes_news.py:submit_news_generation 的链路：
//   1. 校验 schema（task_id/bussiness_id/prompt/date/callback_url 必填，
//      date 格式 YYYY-MM-DD，对齐源 schemas/news.py:field_validator）
//   2. createOpenApiBatch 事务内建 task_batches + tasks（source=open_api，幂等防重复）
//   3. getNewsQueue().add 投递 news-queue，jobData 字段对齐 NewsJobData
//   4. 返回 successResponse(task_id)
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 请求体 bussiness_id（多一个 s）—— 路由映射到内部 businessId
//
// 与 aigc-test 现有 worker 完全隔离：
//   - 独立 queue（news-queue）、独立 worker、module='news'、serviceType='news'
import type { FastifyPluginAsync } from 'fastify'

import { getNewsQueue } from '../../lib/queue.js'
import { successResponse } from '../../lib/open-api-errors.js'
import { OPENAPI_COMMON_RESPONSES } from './_docs.js'
import { createOpenApiBatch, openApiPreHandler } from './_shared.js'

// 请求体 schema（对齐源 schemas/news.py:NewsGenerateRequest）
// date 格式 YYYY-MM-DD（对齐源 field_validator 的 strptime 校验）
// bussiness_id 拼写为对外契约，不得修正
const NEWS_BODY = {
  type: 'object',
  required: ['task_id', 'bussiness_id', 'prompt', 'date', 'callback_url'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', maxLength: 50, description: '调用方生成的唯一任务 ID。同一个 API Key 下重复提交相同 task_id 会返回重复任务错误。' },
    bussiness_id: { type: 'string', maxLength: 50, description: '调用方业务流水号。字段名按历史契约保留为 bussiness_id，回调时会原样带回。' },
    prompt: { type: 'string', minLength: 1, description: '资讯生成主题或检索/写作要求，例如行业、地区、重点事件和输出风格。' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '资讯日期，格式 YYYY-MM-DD。用于限定生成内容对应的日期范围。' },
    callback_url: { type: 'string', format: 'uri', description: '异步结果回调地址。任务完成或失败后，worker 会向该地址投递结果。' },
  },
}

// 资讯生成模型（对齐源 config.py:ark_news_model，worker 侧也从 env 读，此处仅用于 params 快照）
const DOUBAO_NEWS_MODEL = process.env.DOUBAO_NEWS_MODEL ?? 'doubao-seed-2-0-code-preview-260215'

const route: FastifyPluginAsync = async (app) => {
  app.post(
    '/news/generations',
    {
      schema: {
        tags: ['OpenApi'],
        summary: '提交资讯生成任务',
        description: '创建一个异步资讯生成任务。接口受理后由 worker 调用文本模型生成资讯内容，并通过 callback_url 回调结果。',
        body: NEWS_BODY,
        response: OPENAPI_COMMON_RESPONSES,
      },
      preHandler: [openApiPreHandler],
    },
    async (request, reply) => {
      const b = request.body as {
        task_id: string
        bussiness_id: string
        prompt: string
        date: string
        callback_url: string
      }
      // preHandler 已挂载 request.apiClient（非空断言：openApiPreHandler 失败会抛 AUTH_FAILED）
      const apiClient = request.apiClient!

      // 步骤①：建 task_batches + tasks（事务内，幂等防重复）
      // module='news'（对齐迁移 071 的 chk_tb_module 枚举）
      // serviceType='news'（对齐 callbacks.py 的 news 分支）
      // provider='ark' / model=资讯模型 / params 快照 date（worker 消费用）
      const { batchId, internalTaskId } = await createOpenApiBatch({
        apiClient,
        serviceType: 'news',
        taskId: b.task_id,
        bussinessId: b.bussiness_id,
        callbackUrl: b.callback_url,
        module: 'news',
        provider: 'ark',
        model: DOUBAO_NEWS_MODEL,
        prompt: b.prompt,
        params: { date: b.date },
      })

      // 步骤②：投递资讯生成队列
      // jobData 字段对齐 NewsJobData（packages/types）：
      //   - taskId/batchId/userId/teamId/workspaceId/estimatedCredits 必填
      //   - prompt/date 业务字段（worker 消费）
      //   - 回调字段（callbackUrl/businessId/serviceType/openApiTaskId）
      await getNewsQueue().add('generate', {
        taskId: internalTaskId,
        batchId,
        userId: apiClient.systemUserId!,
        teamId: apiClient.teamId!,
        workspaceId: apiClient.workspaceId!,
        estimatedCredits: 0,
        prompt: b.prompt,
        date: b.date,
        callbackUrl: b.callback_url,
        businessId: b.bussiness_id,
        serviceType: 'news',
        openApiTaskId: b.task_id,
      })

      // 步骤③：立即返回成功信封（异步链路由 worker 处理）
      return reply.send(successResponse(b.task_id))
    },
  )
}

export default route
