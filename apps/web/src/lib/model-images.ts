// apps/web/src/lib/model-images.ts

/**
 * 模型图标工具
 * 使用 @lobehub/icons 渲染模型品牌图标
 *
 * 三级渲染优先级：
 * 1. 直接图标组件映射（MODEL_DIRECT_ICONS）—— ProviderIcon 未注册的品牌
 * 2. ProviderIcon 映射（MODEL_TO_ICON_PROVIDER）—— 按合法 provider key 匹配
 * 3. ModelIcon 自动匹配 —— 内置 modelConfig 关键词映射
 */

import type { IconType } from '@lobehub/icons'
import { Gemini } from '@lobehub/icons'

export { ModelIcon } from '@lobehub/icons'
export { ProviderIcon } from '@lobehub/icons'

/**
 * 模型 → 直接图标组件映射
 * 用于 ProviderIcon 的 providerConfig 中缺少 keywords 条目的品牌
 * （如 Gemini：providerEnum 有定义，但 providerConfig 漏了映射）
 */
const MODEL_DIRECT_ICONS: Record<string, IconType> = {
  // Gemini 图片模型 — 希望显示 Gemini 图标而非 NanoBanana 或 Google
  'gemini-3.1-flash-image-preview': Gemini.Color,
}

/**
 * 模型 → lobehub provider key 映射
 * ProviderIcon 的 provider 必须是 providerConfig 中已注册的合法 key
 */
const MODEL_TO_ICON_PROVIDER: Record<string, string> = {
  'gpt-image-2': 'openai',
  // nano-banana-2 不需要映射，ModelIcon 内置了 'nano-banana' 关键词，
  // 会自动匹配到 NanoBanana 图标组件
  // 火山图片模型（ModelIcon 会匹配到即梦，但实际供应商是火山）
  'seedream-5.0-lite': 'volcengine',
  'seedream-4.5': 'volcengine',
  'seedream-4.0': 'volcengine',
  // 火山视频模型（同上）
  'seedance-1.5-pro': 'volcengine',
  'seedance-2.0': 'volcengine',
  'seedance-2.0-fast': 'volcengine',
}

/** 获取模型的直接图标组件（优先级最高） */
export function getModelDirectIcon(modelCode: string): IconType | undefined {
  return MODEL_DIRECT_ICONS[modelCode]
}

/** 获取模型的 provider key（用于 ProviderIcon） */
export function getModelIconProvider(modelCode: string, providerCode?: string): string | undefined {
  return MODEL_TO_ICON_PROVIDER[modelCode] ?? providerCode
}
