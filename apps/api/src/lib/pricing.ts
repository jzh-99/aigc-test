import type { ParamsPricingRule } from '@aigc/types'

export interface PricingResult {
  unitPrice: number
  /** 命中规则时返回底层模型 code，否则为 null */
  resolvedModel: string | null
}

/**
 * 根据 params_pricing 规则和请求分辨率解析积分单价。
 * 规则为空数组时回退到 fallbackCreditCost。
 */
export function resolveUnitPrice(
  paramsPricing: unknown,
  resolution: string | null | undefined,
  fallbackCreditCost: number,
): PricingResult {
  const rules = parseRules(paramsPricing)

  if (rules.length === 0) {
    return { unitPrice: fallbackCreditCost, resolvedModel: null }
  }

  // 有 resolution 时精确匹配，否则取第一条规则作为默认
  const matched = resolution
    ? (rules.find(r => r.resolution === resolution) ?? rules[0])
    : rules[0]

  return { unitPrice: matched.unit_price, resolvedModel: matched.model }
}

function parseRules(raw: unknown): ParamsPricingRule[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r): r is ParamsPricingRule =>
      typeof r === 'object' &&
      r !== null &&
      typeof r.model === 'string' &&
      typeof r.resolution === 'string' &&
      typeof r.unit_price === 'number',
  )
}
