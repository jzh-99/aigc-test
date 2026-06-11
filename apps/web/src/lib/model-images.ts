// apps/web/src/lib/model-images.ts

/**
 * 模型图标工具
 * 使用 @lobehub/icons 渲染模型品牌图标
 *
 * ModelIcon 按 model code 匹配（覆盖最全：gemini-3.1-flash-image-preview → Google 图标、
 * nano-banana-2 → NanoBanana 图标、gpt-image-2 → OpenAI 图标）。
 * ProviderIcon 按 provider_code 匹配（覆盖 volcengine 等）。
 * ModelIcon 匹配不到时返回 null，需 ProviderIcon 兜底。
 */

export { ModelIcon } from '@lobehub/icons'
export { ProviderIcon } from '@lobehub/icons'

/**
 * 获取模型对应的 lobehub 图标 provider key
 * 用于 ModelIcon 未覆盖时的 ProviderIcon 兜底
 */
const MODEL_TO_ICON_PROVIDER: Record<string, string> = {
  // 图片模型（comfly 中转）
  'gemini-3.1-flash-image-preview': 'google',
  'gpt-image-2': 'openai',
  'nano-banana-2': 'google', // NanoBanana 图标在 providerConfig 中不存在，用 Google 兜底
}

export function getModelIconProvider(modelCode: string, providerCode?: string): string {
  return MODEL_TO_ICON_PROVIDER[modelCode] ?? providerCode ?? 'volcengine'
}
