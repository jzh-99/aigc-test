import type { ModelItem } from '@aigc/types'
import { ALL_RESOLUTION_OPTIONS, MODEL_OPTIONS } from './constants'

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

/**
 * 获取指定模型的可用分辨率列表（首项为默认值）。
 * 优先从 DB 模型的 params_schema 提取，fallback 到静态常量。
 */
export function getModelResolutions(modelCode: string, dbModels?: ModelItem[]): string[] {
  const dbModel = dbModels?.find((m) => m.code === modelCode)
  if (dbModel) {
    const enums = extractSchemaEnums(dbModel.params_schema, 'resolution')
    if (enums.length > 0) {
      return ALL_RESOLUTION_OPTIONS.filter((r) => enums.includes(r.value)).map((r) => r.value)
    }
  }
  const staticModel = MODEL_OPTIONS.find((m) => m.value === modelCode)
  if (staticModel) {
    return ALL_RESOLUTION_OPTIONS.filter((r) => staticModel.resolutions.includes(r.value as never)).map((r) => r.value)
  }
  return ALL_RESOLUTION_OPTIONS.map((r) => r.value)
}

export function isSeedanceModel(model: ModelItem): boolean {
  return model.code.startsWith('seedance-')
}

/**
 * 从 params_pricing 中查找指定分辨率的积分单价
 * 找不到时返回 fallback 值
 */
export function getPriceByResolution(model: ModelItem, resolution: string, fallback: number): number {
  const rule = model.params_pricing.find((r) => r.resolution === resolution)
  return rule ? rule.unit_price : fallback
}
