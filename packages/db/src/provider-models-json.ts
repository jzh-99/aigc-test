import type { ProviderModelsTable } from './schema.js'
import { resolveProviderModelCategoryReferences } from './provider-model-category-references.js'

export type ProviderModelModule = ProviderModelsTable['module']

export interface TobyModelPricingParam {
  resolutionRatio: string
  singleConsumeCount: number
  inputConsumeCount?: number
  ouputConsumeCount?: number
}

export interface TobyProviderModelInput {
  modelCode: string
  modelType: string
  modelName: string
  modelDesc: string
  modelProvider: string
  useChannel?: string
  singleUnit?: string
  materialRatio?: string
  paramsSchema?: Record<string, unknown>
  paramsPricing?: Array<Record<string, unknown>>
  params?: TobyModelPricingParam[]
}

export interface ProviderModelsSeedGroup {
  modelParams?: TobyProviderModelInput[]
}

export interface NormalizedProviderModel {
  provider_code: string
  code: string
  name: string
  description: string | null
  module: ProviderModelModule
  category_references: Record<string, unknown>
  params_pricing: Array<Record<string, unknown>>
  params_schema: Record<string, unknown>
  resolution: string | null
  avatar: string | null
  is_active: boolean
}

const MODEL_TYPE_TO_MODULE: Record<string, ProviderModelModule> = {
  '1': 'image',
  '2': 'video',
  '3': 'agent',
  '4': 'music',
  '5': 'tts',
}

const PROVIDER_CODE_ALIASES: Record<string, string> = {
  ctyun: 'ctyun-edge',
  天翼云: 'ctyun-edge',
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`模型规格字段 ${field} 不能为空`)
  }
  return value.trim()
}

function normalizeProviderCode(value: unknown): string {
  const provider = requiredText(value, 'modelProvider')
  return PROVIDER_CODE_ALIASES[provider] ?? provider
}

function normalizeModelType(modelType: string): ProviderModelModule {
  const module = MODEL_TYPE_TO_MODULE[modelType]
  if (!module) throw new Error(`不支持的模型类型：${modelType}`)
  return module
}

function normalizeResolution(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim())
    return typeof first === 'string' ? first : null
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildParamsSchema(input: TobyProviderModelInput): Record<string, unknown> {
  if (input.paramsSchema && typeof input.paramsSchema === 'object') return input.paramsSchema

  const schema: Record<string, unknown> = {}
  const params = input.params ?? []
  const resolutions = params.map((item) => item.resolutionRatio).filter(Boolean)
  if (resolutions.length > 0) schema.resolution = resolutions

  const aspectRatios = splitCsv(input.materialRatio)
  if (aspectRatios.length > 0) schema.aspect_ratio = aspectRatios

  return schema
}

function buildParamsPricing(input: TobyProviderModelInput): Array<Record<string, unknown>> {
  if (Array.isArray(input.paramsPricing)) return input.paramsPricing

  return (input.params ?? []).map((item) => ({
    model: input.modelCode,
    resolution: item.resolutionRatio,
    unit_price: item.singleConsumeCount,
  }))
}

export function normalizeTobyProviderModel(input: TobyProviderModelInput): NormalizedProviderModel {
  const paramsSchema = buildParamsSchema(input)
  const code = requiredText(input.modelCode, 'modelCode')
  const module = normalizeModelType(requiredText(input.modelType, 'modelType'))

  return {
    provider_code: normalizeProviderCode(input.modelProvider),
    code,
    name: requiredText(input.modelName, 'modelName'),
    description: typeof input.modelDesc === 'string' ? input.modelDesc : null,
    module,
    category_references: resolveProviderModelCategoryReferences({ code, module, paramsSchema }),
    params_schema: paramsSchema,
    params_pricing: buildParamsPricing(input),
    resolution: normalizeResolution(paramsSchema.resolution),
    avatar: null,
    is_active: true,
  }
}

export function flattenProviderModelsSeed(groups: ProviderModelsSeedGroup[]): NormalizedProviderModel[] {
  return groups.flatMap((group) => (group.modelParams ?? []).map((model) => normalizeTobyProviderModel(model)))
}
