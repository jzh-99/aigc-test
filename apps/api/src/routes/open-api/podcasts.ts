// 开放接口播客生成路由（Phase 5）。
//
// 对齐源项目 app/api/routes_podcast.py:submit_podcast_generation 的链路：
//   1. 校验 schema（task_id/bussiness_id/content_type/content/speakers/callback_url 必填，
//      speakers 恰好 2 个，content_type ∈ text|file|url）
//   2. content_type=file 且 content 为 PDF base64 → 脱敏落 TOS（content 改写为 TOS URL，
//      原始 base64 绝不入库不入日志），sourceFileUrl 记 TOS URL
//   3. createOpenApiBatch 事务内建 task_batches + tasks（source=open_api，幂等防重复）
//   4. getPodcastQueue().add 投递 podcast-queue，jobData 字段对齐 PodcastJobData
//   5. 返回 successResponse(task_id)
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 请求体 bussiness_id（多一个 s）—— 路由映射到内部 businessId
//   - speakers 为字符串数组（源 schemas/podcast.py: list[str]，恰好 2 个，非复杂对象）
//
// 与 aigc-test 现有 music worker 完全隔离：
//   - 独立 queue（podcast-queue）、独立 worker、module='podcast'、serviceType='podcast'
import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'

import { getPodcastQueue } from '../../lib/queue.js'
import { successResponse } from '../../lib/open-api-errors.js'
import { uploadToTos } from '../../lib/storage.js'
import { OPENAPI_COMMON_RESPONSES } from './_docs.js'
import { createOpenApiBatch, openApiPreHandler } from './_shared.js'

// 请求体 schema（对齐源 schemas/podcast.py:PodcastGenerateRequest）
// speakers 为 string[]（源 list[str]），minItems/maxItems=2 强制恰好 2 个
// bussiness_id 拼写为对外契约，不得修正
const PODCAST_BODY = {
  type: 'object',
  required: ['task_id', 'bussiness_id', 'content_type', 'content', 'speakers', 'callback_url'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', maxLength: 50, description: '调用方生成的唯一任务 ID。同一个 API Key 下重复提交相同 task_id 会返回重复任务错误。' },
    bussiness_id: { type: 'string', maxLength: 50, description: '调用方业务流水号。字段名按历史契约保留为 bussiness_id，回调时会原样带回。' },
    content_type: { type: 'string', enum: ['text', 'file', 'url'], description: '内容来源类型：text 直接文本；file 文件内容或文件 URL；url 网页/文档 URL。' },
    content: { type: 'string', description: '播客生成素材。content_type=text 时为正文；file 时可为 PDF base64/data URI 或 PDF URL；url 时为可访问链接。PDF base64 会先转存对象存储。' },
    speakers: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      description: '播客双人对话角色名称，必须恰好 2 个字符串，例如 ["主持人", "嘉宾"]。',
      items: { type: 'string', description: '角色名称或音色角色名。' },
    },
    callback_url: { type: 'string', format: 'uri', description: '异步结果回调地址。任务完成或失败后，worker 会向该地址投递结果。' },
  },
}

// 判定 content 是否为 PDF base64（需脱敏落 TOS）
// 对齐源 routes_podcast.py:36 _is_file_base64_request：
//   content_type='file' 且 content 不以 http(s) 开头 → 视为 base64
function isPdfBase64Content(contentType: string, content: string): boolean {
  return contentType === 'file' && !content.startsWith('http://') && !content.startsWith('https://')
}

// PDF base64 脱敏落 TOS（对齐源 routes_podcast.py:_build_stored_podcast_payload 的 MinIO 落库）
// 红线：原始 base64 绝不入库不入日志，只返回 TOS URL
async function maskPdfBase64ToTos(
  base64Content: string,
  taskId: string,
): Promise<{ storageUrl: string }> {
  // 兼容 data:application/pdf;base64, 前缀与纯 base64 两种输入
  const commaIdx = base64Content.indexOf(',')
  const rawBase64 =
    commaIdx >= 0 && base64Content.slice(0, commaIdx).includes('base64')
      ? base64Content.slice(commaIdx + 1)
      : base64Content
  const buffer = Buffer.from(rawBase64, 'base64')
  if (buffer.length === 0) {
    throw new Error('PDF base64 内容为空，无法转存')
  }
  const key = `assets/podcast/${taskId}/${randomUUID()}.pdf`
  const storageUrl = await uploadToTos(key, buffer, 'application/pdf')
  return { storageUrl }
}

const route: FastifyPluginAsync = async (app) => {
  app.post(
    '/podcasts/generations',
    {
      schema: {
        tags: ['OpenApi'],
        summary: '提交播客生成任务',
        description: '创建一个异步双人播客生成任务。支持文本、文件和 URL 素材；PDF base64 会脱敏转存，生成音频结果通过 callback_url 回调。',
        body: PODCAST_BODY,
        response: OPENAPI_COMMON_RESPONSES,
      },
      preHandler: [openApiPreHandler],
    },
    async (request, reply) => {
      const b = request.body as {
        task_id: string
        bussiness_id: string
        content_type: 'text' | 'file' | 'url'
        content: string
        speakers: string[]
        callback_url: string
      }
      // preHandler 已挂载 request.apiClient（非空断言：openApiPreHandler 失败会抛 AUTH_FAILED）
      const apiClient = request.apiClient!

      // 步骤①：content_type=file 且 content 为 PDF base64 → 脱敏落 TOS
      // 红线：原始 base64 不入库不入日志，content 字段改写为 TOS URL，sourceFileUrl 记 URL
      let resolvedContent = b.content
      let sourceFileUrl: string | null = null
      if (isPdfBase64Content(b.content_type, b.content)) {
        const { storageUrl } = await maskPdfBase64ToTos(b.content, b.task_id)
        sourceFileUrl = storageUrl
        resolvedContent = storageUrl
      }

      // 步骤②：建 task_batches + tasks（事务内，幂等防重复）
      // module='podcast'（对齐迁移 071 的 chk_tb_module 枚举）
      // serviceType='podcast'（对齐 callbacks.py 的 podcast 默认分支）
      // params 快照写入 worker 所需业务字段（content_type/speakers/content 脱敏后的值）
      const { batchId, internalTaskId } = await createOpenApiBatch({
        apiClient,
        serviceType: 'podcast',
        taskId: b.task_id,
        bussinessId: b.bussiness_id,
        callbackUrl: b.callback_url,
        module: 'podcast',
        provider: 'sami',
        model: 'podcast-tts',
        prompt: '',
        params: {
          content_type: b.content_type,
          content: resolvedContent,
          speakers: b.speakers,
          source_file_url: sourceFileUrl,
        },
      })

      // 步骤③：投递播客生成队列
      // jobData 字段对齐 PodcastJobData（packages/types）：
      //   - taskId/batchId/userId/teamId/workspaceId/estimatedCredits 必填
      //   - contentType/content/speakers 业务字段（worker 消费）
      //   - sourceFileUrl：路由层 PDF base64 转 TOS 后的 URL（worker 优先用此）
      await getPodcastQueue().add('generate', {
        taskId: internalTaskId,
        batchId,
        userId: apiClient.systemUserId!,
        teamId: apiClient.teamId!,
        workspaceId: apiClient.workspaceId!,
        estimatedCredits: 0,
        contentType: b.content_type,
        content: resolvedContent,
        sourceFileUrl,
        speakers: b.speakers,
        callbackUrl: b.callback_url,
        businessId: b.bussiness_id,
        serviceType: 'podcast',
        openApiTaskId: b.task_id,
      })

      // 步骤④：立即返回成功信封（异步链路由 worker 处理）
      return reply.send(successResponse(b.task_id))
    },
  )
}

export default route
