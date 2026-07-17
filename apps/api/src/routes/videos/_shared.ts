// autoload 忽略以 _ 开头的文件，此文件仅供同目录路由文件 import
import { encryptProxyUrl } from '../../lib/storage.js'
import type { ConcatJobStore } from '../../services/concat-export.js'

// ── 临时上传目录配置 ──────────────────────────────────────────────────────────
export const UPLOAD_DIR = '/tmp/video-uploads'
export const MAX_FILE_AGE_MS = 60 * 60 * 1000 // 60 分钟
export const MAX_IMAGE_SIZE = 30 * 1024 * 1024  // 30 MB
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024  // 50 MB
export const MAX_AUDIO_SIZE = 15 * 1024 * 1024  // 15 MB

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif']
export const VIDEO_EXTS = ['mp4', 'mov', 'webm']
export const AUDIO_EXTS = ['mp3', 'wav']
export const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS]

export const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  bmp: 'image/bmp', tiff: 'image/tiff', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav',
}
export const SAFE_ID = /^[\w-]+\.(jpg|jpeg|png|webp|bmp|tiff|gif|mp4|mov|webm|mp3|wav)$/

// 前端模型代码 → 火山引擎实际模型 ID 映射
export const VOLCENGINE_MODEL_ID: Record<string, string> = {
  'seedance-1.5-pro': 'doubao-seedance-1-5-pro-251215',
  'seedance-2.0':     'doubao-seedance-2-0-260128',
  'seedance-2.0-fast':'doubao-seedance-2-0-fast-260128',
}

// concat-export 内存任务存储（热路径），DB 作为持久化兜底
export const concatJobStore: ConcatJobStore = new Map()

// ── 公共 URL 转换工具 ─────────────────────────────────────────────────────────
const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

/**
 * 将内部存储 URL 转换为 AI API 可访问的公网 URL：
 * - http:// 开头 → 加密代理 URL
 * - / 开头（相对路径）→ 拼接 BASE_URL
 * - 已是 https:// → 原样返回
 */
export function toPublicUrl(url: string): string {
  if (url.startsWith('http://')) {
    return `${BASE_URL}/api/v1/assets/proxy?token=${encryptProxyUrl(url)}`
  }
  if (url.startsWith('/')) {
    return `${BASE_URL}${url}`
  }
  return url
}

export function toPublicUrls(urls: string[] | undefined): string[] | undefined {
  if (!urls || urls.length === 0) return urls
  return urls.map(toPublicUrl)
}
