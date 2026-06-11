// apps/web/src/lib/model-images.ts

/**
 * 模型供应商图标工具
 * 使用 @lobehub/icons 的 ProviderIcon 渲染供应商品牌图标
 *
 * 部分模型通过中转站（如 comfly）统一调用，数据库 provider_code 为中转站 code，
 * 但前端需要展示模型实际供应商的品牌图标。
 * 通过 MODEL_TO_ICON_PROVIDER 映射 model code → lobehub icon provider key。
 */

export { ProviderIcon } from '@lobehub/icons'

/**
 * 模型 code → lobehub 图标 provider key 的映射
 * 未映射的模型回退使用数据库的 provider_code
 */
const MODEL_TO_ICON_PROVIDER: Record<string, string> = {
  // 图片模型（comfly 中转）
  'gemini-3.1-flash-image-preview': 'gemini',
  'gpt-image-2': 'openai',
  'nano-banana-2': 'nano-banana',
}

/**
 * 获取模型对应的图标 provider key
 * 优先使用映射表，未映射时回退到 providerCode
 */
export function getModelIconProvider(modelCode: string, providerCode?: string): string {
  return MODEL_TO_ICON_PROVIDER[modelCode] ?? providerCode ?? 'volcengine'
}
