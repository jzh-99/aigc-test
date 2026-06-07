import type { ModelItem } from '@aigc/types'

/**
 * 从 params_schema 中提取指定字段的枚举选项列表
 * 支持扁平数组格式：{ resolution: ['1k', '2k', '4k'] }
 * 数组元素可以是字符串，也可以是 { label?, value } 对象
 */
export function extractSchemaEnums(schema: unknown, field: string): Array<{ label: string; value: string }> {
  if (!schema || typeof schema !== 'object') return []
  const raw = (schema as Record<string, unknown>)[field]
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return { label: item, value: item }
      if (item && typeof item === 'object' && 'value' in item) {
        const obj = item as { value: unknown; label?: unknown }
        const value = String(obj.value)
        const label = obj.label ? String(obj.label) : value
        return { label, value }
      }
      return null
    })
    .filter((v): v is { label: string; value: string } => v !== null && v.value !== '')
}

/**
 * 获取指定模型的可用分辨率列表（首项为默认值）。
 * 从 DB 模型的 params_schema 提取。
 */
export function getModelResolutions(modelCode: string, dbModels?: ModelItem[]): string[] {
  const dbModel = dbModels?.find((m) => m.code === modelCode)
  if (dbModel) {
    const enums = extractSchemaEnums(dbModel.params_schema, 'resolution')
    if (enums.length > 0) return enums.map((e) => e.value)
  }
  return []
}

export function isSeedanceModel(model: ModelItem): boolean {
  return model.code.startsWith('seedance-')
}

/**
 * 从 params_pricing 中查找指定分辨率的积分单价
 * 找不到匹配时取第一条规则作为默认值
 */
export function getPriceByResolution(model: ModelItem, resolution: string): number {
  const rule = model.params_pricing.find((r) => r.resolution === resolution)
  return rule ? rule.unit_price : (model.params_pricing[0]?.unit_price ?? 0)
}
