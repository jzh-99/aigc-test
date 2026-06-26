export interface GenerationJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
  canvasId?: string
  canvasNodeId?: string
  // 开放接口（Open API）回调用字段，全部可选，对非开放接口任务零影响：
  // 仅当 task_batches.source === 'open_api' 时由 dispatchBatchResult 读取使用
  callbackUrl?: string | null
  businessId?: string | null
  // image|song|video|news|podcast|storybook|text
  serviceType?: string | null
  // 对外 task_id（源项目契约字段，内部拼写 task_id）
  openApiTaskId?: string | null
  // ─── 业务管理平台 A 豆计费上下文 ─────────────────────────────────────────
  // 仅当用户使用业管会员身份生成时携带，供 worker 终态写入创作结果 outbox。
  // 无业管身份的旧账号/内部账号不带这些字段，走本地积分流程。
  workspaceId?: string | null
  bizMgmtDeductRequestNo?: string
  bizMgmtUserId?: string
  bizMgmtWorkNo?: string
}

/**
 * 业务管理平台生成计费上下文（用于 worker 终态写创作结果 outbox）。
 * 透传到各类生成 job data，使 worker 完成/失败时能构造 creation_result_notify 事件。
 */
export interface BizMgmtGenerationBillingContext {
  bizMgmtDeductRequestNo?: string
  bizMgmtUserId?: string
  bizMgmtWorkNo?: string
}

export interface VideoSubmitJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  workspaceId?: string | null
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
  videoCategory?: 'multimodal' | 'frames'
  // 业管计费上下文（见 BizMgmtGenerationBillingContext），worker 终态写创作结果 outbox 用
  bizMgmtDeductRequestNo?: string
  bizMgmtUserId?: string
  bizMgmtWorkNo?: string
}

export interface CompletionJobData {
  taskId: string
  result: {
    success: boolean
    outputUrl?: string
    actualCredits?: number
    providerCostRaw?: Record<string, unknown>
    errorMessage?: string
  }
}

export interface TransferJobData {
  taskId: string
  batchId: string
  assetId: string
  originalUrl: string
  assetType?: 'image' | 'video'
}

export interface StoryboardJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  estimatedCredits: number
  canvasId: string
  canvasNodeId: string
  script: string
  shotCount: number
}

export interface MusicJobData {
  taskId: string
  batchId: string
  trackId: string
  userId: string
  teamId: string
  workspaceId: string
  estimatedCredits: number
  // 开放接口（Open API）回调用字段，全部可选，对非开放接口任务零影响：
  // music worker 完成后通过查 task_batches 表获取 source/callback_url 做分流，
  // 此处保留字段对齐 GenerationJobData，便于排查与未来直传使用
  callbackUrl?: string | null
  businessId?: string | null
  // image|song|video|news|podcast|storybook|text
  serviceType?: string | null
  // 对外 task_id（源项目契约字段，内部拼写 task_id）
  openApiTaskId?: string | null
  // 业管计费上下文（见 BizMgmtGenerationBillingContext），worker 终态写创作结果 outbox 用
  bizMgmtDeductRequestNo?: string
  bizMgmtUserId?: string
  bizMgmtWorkNo?: string
}

export interface MusicVoiceCloneJobData {
  taskId: string
  batchId: string
  voiceCloneId: string
  userId: string
  teamId: string
  workspaceId: string
  estimatedCredits: number
  // 业管计费上下文（见 BizMgmtGenerationBillingContext），worker 终态写创作结果 outbox 用
  bizMgmtDeductRequestNo?: string
  bizMgmtUserId?: string
  bizMgmtWorkNo?: string
}

/**
 * 开放接口绘本生成任务数据（Phase 4）。
 *
 * 对齐源项目 app/schemas/storybook.py 的 StorybookGenerateRequest：
 * - age：'0-3' | '3-6' | '6+'（字符串枚举，源 field_validator 校验）
 * - category：0-4（int，故事类别）
 * - style：0-3（int，画风）
 * - pages：1-10（int，分镜页数）
 *
 * worker 消费此数据执行两步流程：
 *   ① Ark chat/completions 润色分镜 → scenes_detail[N]
 *   ② seedream /images/generations 组图（sequential_image_generation）→ N 张临时 URL
 *   ③ 逐张转存 TOS → images_url[TOS URLs]
 *   ④ dispatchBatchResult({serviceType:'storybook', media:{images_url}})
 */
export interface StorybookJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  workspaceId: string
  estimatedCredits: number
  // 源 StorybookGenerateRequest 业务字段
  prompt: string
  age: string
  category: number
  style: number
  pages: number
  // 开放接口回调用字段（对齐 GenerationJobData 语义）
  callbackUrl?: string | null
  businessId?: string | null
  // image|song|video|news|podcast|storybook|text
  serviceType?: string | null
  // 对外 task_id（源项目契约字段，内部拼写 task_id）
  openApiTaskId?: string | null
}

export interface ShortDramaExportEpisodeJobData {
  projectId: string
  episodeId: string
  exportId: string
  userId: string
  teamId: string
  workspaceId: string
  estimatedCredits: number
  // 业管计费上下文（见 BizMgmtGenerationBillingContext），worker 终态写创作结果 outbox 用
  bizMgmtDeductRequestNo?: string
  bizMgmtUserId?: string
  bizMgmtWorkNo?: string
}

/**
 * 开放接口播客生成任务数据（Phase 5）。
 *
 * 对齐源项目 app/schemas/podcast.py 的 PodcastGenerateRequest：
 * - contentType：'text' | 'file' | 'url'
 * - content：text 正文 / file 的 TOS URL（路由层已脱敏）/ url
 * - speakers：string[]（恰好 2 个，源 list[str]）
 *
 * worker 消费此数据执行 sami WebSocket TTS 流程：
 *   ① 内容预处理（text 直接用 / file/url 透传 TOS 或外部 URL）
 *   ② podcast-tts provider：WebSocket 连接 sami 生成音频（返回临时 audio_url）
 *   ③ 音频转存 TOS（复用 transferMusicUrl）→ 永久 audio_url
 *   ④ dispatchBatchResult({serviceType:'podcast', media:{audio_url: TOS URL}})
 */
export interface PodcastJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  workspaceId: string
  estimatedCredits: number
  // 源 PodcastGenerateRequest 业务字段
  contentType: 'text' | 'file' | 'url'
  // text 正文 / file 的 TOS URL（路由层脱敏后）/ url
  content: string
  // 路由层 PDF base64 转 TOS 后的 URL（content_type=file 时非空，worker 优先用此）
  sourceFileUrl?: string | null
  // 恰好 2 个说话人音色 ID（源 list[str]）
  speakers: string[]
  // 开放接口回调用字段（对齐 GenerationJobData 语义）
  callbackUrl?: string | null
  businessId?: string | null
  // image|song|video|news|podcast|storybook|text
  serviceType?: string | null
  // 对外 task_id（源项目契约字段，内部拼写 task_id）
  openApiTaskId?: string | null
}

/**
 * 开放接口（Open API）异步回调任务数据
 *
 * 对齐源项目 app/services/callbacks.py 的 build_async_callback_payload 输出结构：
 * - result：对调用方可见的结果信封（task_id / bussiness_id / code / message）
 * - meta：业务相关的媒体产物与状态元数据
 *
 * 投递方在生成完成后构造此 payload，回调 worker 负责 HMAC 签名后 POST 到 task_batches.callback_url。
 */
export interface OpenApiCallbackJobData {
  batchId: string
  payload: {
    result: Record<string, unknown>
    meta: Record<string, unknown>
  }
}

/**
 * 开放接口资讯生成任务数据（Phase 6）。
 *
 * 对齐源项目 app/schemas/news.py:NewsGenerateRequest：
 * - prompt：资讯生成要求
 * - date：YYYY-MM-DD 日期字符串（源 field_validator 校验格式）
 *
 * worker 消费此数据执行资讯生成流程：
 *   ① Ark /responses 生成完整 HTML（web_search + thinking）
 *   ② 正则解析 HTML 提取 news-title / news-abstract meta
 *   ③ 「安全不通过则重新生成」重试循环（最多 3 次）
 *   ④ HTML base64 转存 TOS（kind='html'）→ 永久 news_url
 *   ⑤ dispatchBatchResult({serviceType:'news', media:{news_url}, extraMeta:{title, abstract}})，
 *      buildMeta 内 abstract → news_abstract 映射（对齐源 _news_meta）
 */
export interface NewsJobData {
  taskId: string
  batchId: string
  userId: string
  teamId: string
  workspaceId: string
  estimatedCredits: number
  // 源 NewsGenerateRequest 业务字段
  prompt: string
  // YYYY-MM-DD 日期字符串（源 field_validator 校验格式）
  date: string
  // 开放接口回调用字段（对齐 GenerationJobData 语义）
  callbackUrl?: string | null
  businessId?: string | null
  // image|song|video|news|podcast|storybook|text
  serviceType?: string | null
  // 对外 task_id（源项目契约字段，内部拼写 task_id）
  openApiTaskId?: string | null
}
