import type { CategoryReferenceKey, CategoryReferences, ReferenceKind } from '@aigc/types'

interface ValidateReferenceKindLimitInput {
  categoryReferences: CategoryReferences
  categoryKey: CategoryReferenceKey
  referenceKind: ReferenceKind
  existingCount: number
}

const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
}

export function validateReferenceKindLimit(input: ValidateReferenceKindLimitInput): string | null {
  const config = input.categoryReferences[input.categoryKey]
  const limit = config?.limits[input.referenceKind]
  if (!config || !limit) return '当前模型不支持该生成模式'

  if (input.existingCount >= limit.max) {
    const label = REFERENCE_KIND_LABELS[input.referenceKind]
    return `${config.label}最多允许 ${limit.max} 个${label}参考素材`
  }

  return null
}
