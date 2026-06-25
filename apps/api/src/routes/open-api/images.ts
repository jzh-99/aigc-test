// 开放接口图片生成路由（Task 1.2 + 1.3 合并实现）。
//
// 对齐源项目 app/api/routes_image.py:submit_image_generation 的链路：
//   1. 校验 schema（task_id/bussiness_id/model/promt/size/ratio/callback_url 必填）
//   2. 参考图 base64 脱敏落 TOS（persistReferenceImages）—— base64 明文不入库不入日志，
//      只把 TOS URL 写入 jobData.params.image，由 worker 下载转 base64 调供应商
//   3. createOpenApiBatch 事务内建 task_batches + tasks（source=open_api，幂等键防重复）
//   4. getImageQueue().add 投递图片生成队列，jobData 字段对齐现有 image worker 的 GenerationJobData
//   5. 返回 successResponse(task_id)（HTTP 200 + result.code=0000）
//
// 错误处理：路由不 try/catch。Task 0.6 的 scoped setErrorHandler 会把：
//   - schema 校验失败 → 422 + PARAM_ERROR
//   - OpenApiError(AUTH_FAILED) → 401
//   - OpenApiError(DUPLICATE_TASK 等) → 200 + body code（业务错误走 200）
//   - 未知异常 → 500 + SYSTEM_FAILED
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 请求体 promt（少一个 p）、bussiness_id（多一个 s）—— 路由做映射到内部规范字段
//   - 内部 jobData/DB 用 prompt/businessId
import type { FastifyPluginAsync } from 'fastify'

import { getImageQueue } from '../../lib/queue.js'
import { successResponse } from '../../lib/open-api-errors.js'
import { persistReferenceImages } from '../../lib/reference-images.js'
import { createOpenApiBatch, openApiPreHandler } from './_shared.js'

// 请求体 schema（对齐源 ImageGenerateRequest）
// promt/bussiness_id 拼写为对外契约，不得修正
const IMAGE_BODY = {
  type: 'object',
  required: ['task_id', 'bussiness_id', 'model', 'promt', 'size', 'ratio', 'callback_url'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', maxLength: 50 },
    bussiness_id: { type: 'string', maxLength: 50 },
    model: { type: 'string' },
    promt: { type: 'string' },
    // base64 data URI 或 URL，支持单值或数组（脱敏落 TOS）
    image: { type: ['string', 'array'] },
    size: { type: 'string', enum: ['1K', '2K', '3K', '4K', '1k', '2k', '3k', '4k'] },
    ratio: {
      type: 'string',
      enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    },
    callback_url: { type: 'string', format: 'uri' },
  },
}

const route: FastifyPluginAsync = async (app) => {
  app.post('/images/generations', {
    schema: { tags: ['OpenApi'], body: IMAGE_BODY },
    preHandler: [openApiPreHandler],
  }, async (request, reply) => {
    const b = request.body as {
      task_id: string
      bussiness_id: string
      model: string
      promt: string
      image?: string | string[]
      size: string
      ratio: string
      callback_url: string
    }
    // preHandler 已挂载 request.apiClient（非空断言：openApiPreHandler 失败会抛 AUTH_FAILED）
    const apiClient = request.apiClient!

    // ① 参考图 base64 脱敏落 TOS：返回公网 URL 数组（base64 明文不进入后续链路）
    //    注意：worker 的 volcengine-image adapter 读 params.image（URL 数组）下载转 base64 调供应商，
    //    故此处把 URL 数组写入 params.image，而非自定义 referenceUrls 字段，确保 worker 透明兼容。
    const referenceUrls = await persistReferenceImages(b.image)

    // ② 建 task_batches + tasks（事务内，幂等防重复），返回 creditAccountId 供 jobData
    const { batchId, internalTaskId, creditAccountId } = await createOpenApiBatch({
      apiClient,
      serviceType: 'image',
      taskId: b.task_id,
      bussinessId: b.bussiness_id,
      callbackUrl: b.callback_url,
      module: 'image',
      provider: 'volcengine',
      model: b.model,
      prompt: b.promt,
      params: {
        size: b.size,
        ratio: b.ratio,
        // 参考图 URL（已脱敏，无 base64 明文）。字段名 image 对齐 worker adapter 契约。
        image: referenceUrls,
      },
    })

    // ③ 投递图片生成队列
    //    jobData 字段对齐 GenerationJobData（packages/types）：
    //      - taskId/batchId/userId/teamId/creditAccountId/estimatedCredits/provider/model/prompt/params 必填
    //      - completePipeline/failPipeline 解构 creditAccountId 做积分确认/退还
    //      - callbackUrl/businessId/serviceType/openApiTaskId 为开放接口回调用可选字段
    await getImageQueue().add('generate', {
      taskId: internalTaskId,
      batchId,
      userId: apiClient.systemUserId!,
      teamId: apiClient.teamId!,
      creditAccountId,
      provider: 'volcengine',
      model: b.model,
      prompt: b.promt,
      params: {
        size: b.size,
        ratio: b.ratio,
        image: referenceUrls,
      },
      estimatedCredits: 0,
      callbackUrl: b.callback_url,
      businessId: b.bussiness_id,
      serviceType: 'image',
      openApiTaskId: b.task_id,
    })

    // ④ 立即返回成功信封（异步链路由 worker 处理）
    return reply.send(successResponse(b.task_id))
  })
}

export default route
