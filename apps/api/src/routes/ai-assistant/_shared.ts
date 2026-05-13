// ai-assistant 模块共享常量与工具函数
// autoload 会忽略以 _ 开头的文件，此文件仅供同目录路由 import

export const UPLOAD_DIR = '/tmp/ai-uploads'
export const MAX_VIDEO_AGE_MS = 15 * 60 * 1000 // 15 分钟
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024 // 100 MB

export const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'avi']
export const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
}
// 安全文件名正则：只允许 UUID + 合法视频扩展名
export const SAFE_ID = /^[\w-]+\.(mp4|mov|webm|avi)$/

// 通过 AI_CHAT_PROVIDER 切换：doubao（默认）| nano_banana
export const provider = process.env.AI_CHAT_PROVIDER ?? 'doubao'

export const AI_API_URL =
  provider === 'nano_banana'
    ? (process.env.NANO_BANANA_API_URL ?? '')
    : (process.env.DOUBAO_API_URL ?? 'https://ark.cn-beijing.volces.com/api/v3')

export const AI_API_KEY =
  provider === 'nano_banana'
    ? (process.env.NANO_BANANA_API_KEY ?? '')
    : (process.env.DOUBAO_API_KEY ?? '')

export const AI_MODEL =
  provider === 'nano_banana'
    ? (process.env.NANO_BANANA_MODEL ?? '')
    : (process.env.DOUBAO_MODEL ?? 'doubao-seed-2.0-lite')

// nano_banana 的 endpoint 带 /v1 前缀，doubao 不带
export const chatEndpoint =
  provider === 'nano_banana'
    ? `${AI_API_URL}/v1/chat/completions`
    : `${AI_API_URL}/chat/completions`

export const SYSTEM_PROMPT = process.env.AI_PROMPT_ASSISTANT ?? ''
export const BASE_URL = process.env.AI_UPLOAD_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''
