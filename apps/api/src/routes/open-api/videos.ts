// 开放接口视频生成路由（Phase 2）。
//
// 对齐源项目 app/api/routes_video.py:submit_video_generation 的链路：
//   1. 校验 schema（task_id/bussiness_id/model/create_mode/prompt/resolution/
//      duration/ratio/callback_url 必填，枚举对齐源 VideoGenerateRequest）
//   2. 参考图 images base64 脱敏落 TOS（persistReferenceImages）—— base64 明文
//      不入库不入日志，只把 TOS URL 写入 params.images（worker 首尾帧字段契约）
//   3. createOpenApiBatch 事务内建 task_batches + tasks（source=open_api，幂等防重复）
//   4. getVideoQueue().add 投递 video-queue，jobData 字段对齐现有 video-submit worker
//      的 VideoSubmitJobData
//   5. 返回 successResponse(task_id)
//
// 字段映射（源对外契约 → worker params 契约）：
//   - 源 ratio（"16:9" 等）→ params.aspect_ratio（worker buildTaskBody 读取的字段名）
//   - 源 duration（整数 5/10/15）→ params.duration（worker 期望 number）
//   - 源 resolution（"720p"/"1080p"）→ params.resolution
//   - 源 images（base64 或 URL，脱敏后 URL 数组）→ params.images（worker 首尾帧字段）
//   - 源 create_mode → params.create_mode（worker 当前未消费，但落库快照便于排查）
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 请求体 bussiness_id（多一个 s）—— 路由映射到内部 businessId
//   - 视频用 prompt（完整拼写，区别于图片的 promt）
import type { FastifyPluginAsync } from 'fastify'

import { getVideoQueue } from '../../lib/queue.js'
import { successResponse } from '../../lib/open-api-errors.js'
import { persistReferenceImages } from '../../lib/reference-images.js'
import { createOpenApiBatch, openApiPreHandler } from './_shared.js'

// 请求体 schema（对齐源 VideoGenerateRequest）
// duration 为 integer（源 VideoDuration = Literal[5, 10, 15]）
// ratio 含 adaptive 共 7 个枚举值（源 VideoRatio）
// bussiness_id 拼写为对外契约，不得修正
const VIDEO_BODY = {
  type: 'object',
  required: ['task_id', 'bussiness_id', 'model', 'create_mode', 'prompt', 'resolution', 'duration', 'ratio', 'callback_url'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', maxLength: 50 },
    bussiness_id: { type: 'string', maxLength: 50 },
    model: { type: 'string' },
    create_mode: { type: 'string', enum: ['general', 'start_end_frame', 'text_2_video'] },
    prompt: { type: 'string' },
    // 参考图：base64 data URI 或 URL，支持单值或数组（脱敏落 TOS 后写入 params.images）
    images: { type: ['string', 'array'] },
    resolution: { type: 'string', enum: ['720p', '1080p'] },
    duration: { type: 'integer', enum: [5, 10, 15] },
    ratio: {
      type: 'string',
      enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
    },
    callback_url: { type: 'string', format: 'uri' },
  },
}

const route: FastifyPluginAsync = async (app) => {
  app.post('/videos/generations', {
    schema: { tags: ['OpenApi'], body: VIDEO_BODY },
    preHandler: [openApiPreHandler],
  }, async (request, reply) => {
    const b = request.body as {
      task_id: string
      bussiness_id: string
      model: string
      create_mode: string
      prompt: string
      images?: string | string[]
      resolution: string
      duration: number
      ratio: string
      callback_url: string
    }
    // preHandler 已挂载 request.apiClient（非空断言：openApiPreHandler 失败会抛 AUTH_FAILED）
    const apiClient = request.apiClient!

    // ① 参考图 base64 脱敏落 TOS：返回公网 URL 数组（base64 明文不进入后续链路）
    //    worker buildTaskBody 读 params.images 作为首尾帧 URL 数组，故字段名用 images
    const referenceUrls = await persistReferenceImages(b.images)

    // ② 建 task_batches + tasks（事务内，幂等防重复），返回 creditAccountId 供 jobData
    const { batchId, internalTaskId, creditAccountId } = await createOpenApiBatch({
      apiClient,
      serviceType: 'video',
      taskId: b.task_id,
      bussinessId: b.bussiness_id,
      callbackUrl: b.callback_url,
      module: 'video',
      provider: 'volcengine',
      model: b.model,
      prompt: b.prompt,
      params: {
        create_mode: b.create_mode,
        // 参考图 URL（已脱敏，无 base64 明文）。字段名 images 对齐 worker 首尾帧契约
        images: referenceUrls,
        resolution: b.resolution,
        duration: b.duration,
        // 源 ratio 映射到 worker 的 aspect_ratio 字段名
        aspect_ratio: b.ratio,
      },
    })

    // ③ 投递视频生成队列
    //    jobData 字段对齐 VideoSubmitJobData（packages/types）：
    //      - taskId/batchId/userId/teamId/creditAccountId/provider/model/prompt/params/estimatedCredits 必填
    //      - video-submit worker 消费 params（aspect_ratio/images/duration/resolution）提交火山
    //    回调字段（callbackUrl/businessId/serviceType/openApiTaskId）非 VideoSubmitJobData
    //    契约字段，但与 GenerationJobData 对齐保留，video-poller/transfer 通过查 task_batches
    //    表获取 source/callback_url/business_id/task_id 做分流（不依赖 jobData 透传）
    await getVideoQueue().add('generate', {
      taskId: internalTaskId,
      batchId,
      userId: apiClient.systemUserId!,
      teamId: apiClient.teamId!,
      creditAccountId,
      provider: 'volcengine',
      model: b.model,
      prompt: b.prompt,
      params: {
        create_mode: b.create_mode,
        images: referenceUrls,
        resolution: b.resolution,
        duration: b.duration,
        aspect_ratio: b.ratio,
      },
      estimatedCredits: 0,
      callbackUrl: b.callback_url,
      businessId: b.bussiness_id,
      serviceType: 'video',
      openApiTaskId: b.task_id,
    })

    // ④ 立即返回成功信封（异步链路由 worker 处理）
    return reply.send(successResponse(b.task_id))
  })
}

export default route
