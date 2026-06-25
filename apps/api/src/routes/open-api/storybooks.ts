// 开放接口绘本生成路由（Phase 4）。
//
// 对齐源项目 app/api/routes_storybook.py:submit_storybook_generation 的链路：
//   1. 校验 schema（task_id/bussiness_id/prompt/age/category/style/pages/callback_url 必填，
//      枚举对齐源 StorybookGenerateRequest）
//   2. createOpenApiBatch 事务内建 task_batches + tasks（source=open_api，幂等防重复）
//   3. getStorybookQueue().add 投递 storybook-queue，jobData 字段对齐 StorybookJobData
//   4. 返回 successResponse(task_id)
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 请求体 bussiness_id（多一个 s）—— 路由映射到内部 businessId
//   - age 为字符串枚举（源 pydantic field_validator 校验字符串值）
//   - category/style/pages 为整数（源 Field + field_validator）
//
// 与 aigc-test 现有 picture_book（SaaS 多步交互式）完全隔离：
//   - 独立 queue（storybook-queue）、独立 worker、module='storybook'、serviceType='storybook'
//   - 不复用 picture_book 的链路（语义差异大），绘本 worker 直接移植源项目两步流程
import type { FastifyPluginAsync } from 'fastify'

import { getStorybookQueue } from '../../lib/queue.js'
import { successResponse } from '../../lib/open-api-errors.js'
import { createOpenApiBatch, openApiPreHandler } from './_shared.js'

// 请求体 schema（对齐源 StorybookGenerateRequest）
// age 字符串枚举（'0-3'/'3-6'/'6+'，源 field_validator 校验）
// category 整数 0-4（故事类别）、style 整数 0-3（画风）、pages 整数 1-10（分镜页数）
// bussiness_id 拼写为对外契约，不得修正
const STORYBOOK_BODY = {
  type: 'object',
  required: ['task_id', 'bussiness_id', 'prompt', 'age', 'category', 'style', 'pages', 'callback_url'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', maxLength: 50 },
    bussiness_id: { type: 'string', maxLength: 50 },
    prompt: { type: 'string' },
    age: { type: 'string', enum: ['0-3', '3-6', '6+'] },
    category: { type: 'integer', minimum: 0, maximum: 4 },
    style: { type: 'integer', minimum: 0, maximum: 3 },
    pages: { type: 'integer', minimum: 1, maximum: 10 },
    callback_url: { type: 'string', format: 'uri' },
  },
}

// 默认绘本组图模型（seedream 系列，支持 sequential_image_generation 批量组图）
// 若调用方未指定 model，使用 seedream-4.5（2K 输出，稳定且成本可控）
const DEFAULT_STORYBOOK_IMAGE_MODEL = 'seedream-4.5'

const route: FastifyPluginAsync = async (app) => {
  app.post('/storybooks/generations', {
    schema: { tags: ['OpenApi'], body: STORYBOOK_BODY },
    preHandler: [openApiPreHandler],
  }, async (request, reply) => {
    const b = request.body as {
      task_id: string
      bussiness_id: string
      prompt: string
      age: string
      category: number
      style: number
      pages: number
      callback_url: string
    }
    // preHandler 已挂载 request.apiClient（非空断言：openApiPreHandler 失败会抛 AUTH_FAILED）
    const apiClient = request.apiClient!

    const model = DEFAULT_STORYBOOK_IMAGE_MODEL

    // ① 建 task_batches + tasks（事务内，幂等防重复），返回 creditAccountId 供 jobData
    //    module='storybook'（对齐迁移 071 的 chk_tb_module 枚举）
    //    serviceType='storybook'（对齐 callbacks.py 的 _storybook_meta）
    //    params 快照写入 worker 两步流程所需的业务字段（age/category/style/pages）
    const { batchId, internalTaskId, creditAccountId } = await createOpenApiBatch({
      apiClient,
      serviceType: 'storybook',
      taskId: b.task_id,
      bussinessId: b.bussiness_id,
      callbackUrl: b.callback_url,
      module: 'storybook',
      provider: 'volcengine',
      model,
      prompt: b.prompt,
      params: {
        age: b.age,
        category: b.category,
        style: b.style,
        pages: b.pages,
      },
    })

    // ② 投递绘本生成队列
    //    jobData 字段对齐 StorybookJobData（packages/types）：
    //      - taskId/batchId/userId/teamId/workspaceId/creditAccountId/estimatedCredits 必填
    //      - prompt/age/category/style/pages 业务字段（worker 两步流程消费）
    //    回调字段（callbackUrl/businessId/serviceType/openApiTaskId）由 worker 读取
    await getStorybookQueue().add('generate', {
      taskId: internalTaskId,
      batchId,
      userId: apiClient.systemUserId!,
      teamId: apiClient.teamId!,
      workspaceId: apiClient.workspaceId!,
      creditAccountId,
      estimatedCredits: 0,
      prompt: b.prompt,
      age: b.age,
      category: b.category,
      style: b.style,
      pages: b.pages,
      callbackUrl: b.callback_url,
      businessId: b.bussiness_id,
      serviceType: 'storybook',
      openApiTaskId: b.task_id,
    })

    // ③ 立即返回成功信封（异步链路由 worker 处理）
    return reply.send(successResponse(b.task_id))
  })
}

export default route
