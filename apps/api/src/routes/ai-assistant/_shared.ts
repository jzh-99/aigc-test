// ai-assistant 模块共享常量与工具函数
// autoload 会忽略以 _ 开头的文件，此文件仅供同目录路由 import

import { doubaoConfig, nanoBananaConfig } from '@aigc/nacos-config'

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

// ─── AI 对话配置（getter 门面，支持 Nacos 热更） ─────────────────────────────
// 通过 AI_CHAT_PROVIDER 切换：doubao（默认）| nano_banana
// 原实现用顶层 export const 一次性求值，Nacos 热更 env 后旧值不生效；
// 现改为 getter 门面，每次访问实时读 process.env，热更即时生效。
// 详见 @aigc/nacos-config。
export const aiAssistant = {
  get provider() {
    return doubaoConfig.chatProvider
  },
  get apiUrl() {
    return this.provider === 'nano_banana' ? nanoBananaConfig.apiUrl : doubaoConfig.apiUrl
  },
  get apiKey() {
    return this.provider === 'nano_banana' ? nanoBananaConfig.apiKey : doubaoConfig.apiKey
  },
  get model() {
    return this.provider === 'nano_banana' ? nanoBananaConfig.model : doubaoConfig.model
  },
  // nano_banana 的 endpoint 带 /v1 前缀，doubao 不带
  get chatEndpoint() {
    return this.provider === 'nano_banana'
      ? `${this.apiUrl}/v1/chat/completions`
      : `${this.apiUrl}/chat/completions`
  },
}

export const SYSTEM_PROMPT = process.env.AI_PROMPT_ASSISTANT ?? ''
export const BASE_URL = process.env.AI_UPLOAD_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''
