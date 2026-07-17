import crypto from 'node:crypto'

const VOLCENGINE_MODEL_ID: Record<string, string> = {
  'seedance-1.5-pro': 'doubao-seedance-1-5-pro-251215',
  'seedance-2.0': 'doubao-seedance-2-0-260128',
  'seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
}

const CTYUN_EDGE_MODEL_ID: Record<string, string> = {
  'ctyun-seedance-2.0': 'cdance2.0-0611',
  'ctyun-seedance-2.0-fast': 'cdance2.0-fast-0611',
}

// TokenHub 视频模型：provider_models 表的 params_pricing 里的 model 字段即为 API model ID
const TOKENHUB_MODEL_ID: Record<string, string> = {
  'tokenhub-seedance-2.0': 'doubao-seedance-2-0-260128',
  'tokenhub-seedance-2.0-mini': 'doubao-seedance-2-0-mini-260615',
  'tokenhub-seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
}

const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

type ReferenceRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'

interface TextContent {
  type: 'text'
  text: string
}

interface ImageContent {
  type: 'image_url'
  image_url: { url: string }
  role: Extract<ReferenceRole, 'first_frame' | 'last_frame' | 'reference_image'>
}

interface VideoContent {
  type: 'video_url'
  video_url: { url: string }
  role: 'reference_video'
}

interface AudioContent {
  type: 'audio_url'
  audio_url: { url: string }
  role: 'reference_audio'
}

export type VolcengineContentItem = TextContent | ImageContent | VideoContent | AudioContent

export interface VolcengineTaskBody {
  model: string
  content: VolcengineContentItem[]
  // 视频参数直接放在根级别
  ratio?: string
  duration?: number
  generate_audio?: boolean
  enable_upsample?: boolean
  watermark?: boolean
  resolution?: string
  [key: string]: unknown
}

// 与 api/lib/storage.ts 保持一致：用 JWT_SECRET 派生代理加密 key
function encryptProxyUrl(url: string): string {
  const secret = process.env.JWT_SECRET ?? ''
  const key = crypto.createHash('sha256').update(secret + '-proxy').digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

/**
 * 将内部 URL 转换为 AI API 可访问的公网 URL：
 * - http:// 开头（内网地址）→ 加密代理 URL，防止内网地址暴露
 * - / 开头（相对路径）→ 拼接 BASE_URL
 * - https:// 开头 → 原样返回
 */
function toPublicUrl(url: string): string {
  if (url.startsWith('http://')) {
    return `${BASE_URL}/api/v1/assets/proxy?token=${encryptProxyUrl(url)}`
  }
  if (url.startsWith('/')) return `${BASE_URL}${url}`
  return url
}

function toPublicUrls(urls: string[] | undefined): string[] | undefined {
  if (!urls?.length) return urls
  return urls.map(toPublicUrl)
}

/** 从 URL 扩展名推断媒体类型，用于防御性校验 */
function inferMediaType(url: string): 'image' | 'video' | 'audio' | undefined {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (/\.(mp4|mov|webm|avi|mkv)$/.test(pathname)) return 'video'
    if (/\.(mp3|wav|ogg|aac|flac|m4a)$/.test(pathname)) return 'audio'
    if (/\.(jpe?g|png|gif|webp|bmp|svg)$/.test(pathname)) return 'image'
  } catch { /* ignore */ }
  return undefined
}

/** 按 URL 扩展名重新校验并纠正素材分类 */
function reclassifyReferences(
  images: string[] | undefined,
  videos: string[] | undefined,
  audios: string[] | undefined,
): { images: string[]; videos: string[]; audios: string[] } {
  const result = { images: [] as string[], videos: [] as string[], audios: [] as string[] }
  const all = [
    ...(images ?? []).map((u) => ({ url: u, declared: 'image' as const })),
    ...(videos ?? []).map((u) => ({ url: u, declared: 'video' as const })),
    ...(audios ?? []).map((u) => ({ url: u, declared: 'audio' as const })),
  ]
  for (const { url, declared } of all) {
    const inferred = inferMediaType(url)
    const actual = inferred ?? declared
    if (actual === 'video') result.videos.push(url)
    else if (actual === 'audio') result.audios.push(url)
    else result.images.push(url)
  }
  return result
}

function getFrameRole(index: number): 'first_frame' | 'last_frame' {
  return index === 0 ? 'first_frame' : 'last_frame'
}

export function buildVolcengineTaskBody(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
): VolcengineTaskBody {
  const volcModel = VOLCENGINE_MODEL_ID[model]
  if (!volcModel) throw new Error(`未知的火山引擎视频模型: ${model}`)

  return buildTaskBody(volcModel, prompt, params)
}

export function buildCtyunEdgeTaskBody(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
): VolcengineTaskBody {
  const ctyunModel = CTYUN_EDGE_MODEL_ID[model]
  if (!ctyunModel) throw new Error(`未知的天翼云边缘视频模型: ${model}`)

  return buildTaskBody(ctyunModel, prompt, params)
}

export function buildTokenhubTaskBody(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
): VolcengineTaskBody {
  const tokenhubModel = TOKENHUB_MODEL_ID[model]
  if (!tokenhubModel) throw new Error(`未知的 TokenHub 视频模型: ${model}`)

  return buildTaskBody(tokenhubModel, prompt, params)
}

function buildTaskBody(
  providerModel: string,
  prompt: string,
  params: Record<string, unknown>,
): VolcengineTaskBody {
  const body: VolcengineTaskBody = {
    model: providerModel,
    content: [{ type: 'text', text: prompt }],
  }

  // 参数直接放在根级别，不使用 parameters 包装
  if (typeof params.aspect_ratio === 'string') body.ratio = params.aspect_ratio
  if (typeof params.duration === 'number' && params.duration > 0) body.duration = params.duration
  if (typeof params.generate_audio === 'boolean') body.generate_audio = params.generate_audio
  if (typeof params.enable_upsample === 'boolean') body.enable_upsample = params.enable_upsample
  if (typeof params.watermark === 'boolean') body.watermark = params.watermark
  if (typeof params.resolution === 'string') body.resolution = params.resolution

  // 首尾帧：显式标注角色，避免与多模态参考图语义混淆。
  const images = params.images as string[] | undefined
  if (images?.length) {
    body.content.push(...images.map((url, index): ImageContent => ({
      type: 'image_url',
      image_url: { url: toPublicUrl(url) },
      role: getFrameRole(index),
    })))
  }

  // 多模态参考素材：图片也必须带 reference_image 角色，否则火山会按首/尾帧类图片处理。
  const rawImages = toPublicUrls(params.reference_images as string[] | undefined)
  const rawVideos = toPublicUrls(params.reference_videos as string[] | undefined)
  const rawAudios = toPublicUrls(params.reference_audios as string[] | undefined)
  const classified = reclassifyReferences(rawImages, rawVideos, rawAudios)
  if (classified.images.length) {
    body.content.push(...classified.images.map((url): ImageContent => ({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    })))
  }
  if (classified.videos.length) {
    body.content.push(...classified.videos.map((url): VideoContent => ({
      type: 'video_url',
      video_url: { url },
      role: 'reference_video',
    })))
  }
  if (classified.audios.length) {
    body.content.push(...classified.audios.map((url): AudioContent => ({
      type: 'audio_url',
      audio_url: { url },
      role: 'reference_audio',
    })))
  }

  return body
}
