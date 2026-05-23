import {
  ACTIVE_IMAGE_CATEGORY,
  parseCategoryReferences,
  validateImageReferenceLimits,
  type CategoryReferences,
  type ModelItem,
} from '@aigc/types'

const FALLBACK_CATEGORY_REFERENCES: CategoryReferences = {
  text_to_image: {
    label: '文生图',
    limits: {
      image: { min: 0, max: 0 },
      video: { min: 0, max: 0 },
      audio: { min: 0, max: 0 },
    },
  },
  image_to_image: {
    label: '图生图',
    limits: {
      image: { min: 0, max: 10 },
      video: { min: 0, max: 0 },
      audio: { min: 0, max: 0 },
    },
  },
}

export function getCategoryReferencesForModel(model?: ModelItem): CategoryReferences {
  const parsed = parseCategoryReferences(model?.category_references)
  return Object.keys(parsed).length > 0 ? parsed : FALLBACK_CATEGORY_REFERENCES
}

export function getMaxImageReferenceCount(model?: ModelItem): number {
  return getCategoryReferencesForModel(model).image_to_image?.limits.image.max ?? 0
}

export function validateImageReferencesForModel(model: ModelItem | undefined, imageCount: number) {
  const categoryReferences = getCategoryReferencesForModel(model)
  return validateImageReferenceLimits(categoryReferences, ACTIVE_IMAGE_CATEGORY, imageCount)
}
