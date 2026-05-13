import type { ModelItem } from '@aigc/types'

/**
 * 从 params_schema 中提取指定字段的字符串枚举值
 * 支持扁平数组格式：{ resolution: ['1k', '2k', '4k'] }
 * 数组元素可以是字符串，也可以是 { label, value } 对象（取 value 字段）
 */
export function extractSchemaEnums(schema: unknown, field: string): string[] {
  if (!schema || typeof schema !== 'object') return []
  const raw = (schema as Record<string, unknown>)[field]
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'value' in item) return String((item as { value: unknown }).value)
      return null
    })
    .filter((v): v is string => v !== null && v !== '')
}

/** 判断视频模型是否为 Seedance 系列（按秒计费，有音频/镜头控制） */
export function isSeedanceModel(model: ModelItem): boolean {
  return model.code.startsWith('seedance-')
}

/**
 * 从 params_pricing 中查找指定分辨率的积分单价
 * 找不到时返回 fallback 值
 */
export function getPriceByResolution(model: ModelItem, resolution: string, fallback: number): number {
  const pricing = Array.isArray(model.params_pricing) ? model.params_pricing : []
  const rule = pricing.find((r) => r.resolution === resolution)
  return rule ? rule.unit_price : fallback
}
