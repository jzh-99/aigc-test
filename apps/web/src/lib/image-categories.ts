import {
  ACTIVE_IMAGE_CATEGORY,
  parseImageCategories,
  validateImageReferenceLimits,
  type ImageCategories,
  type ModelItem,
} from '@aigc/types'

const FALLBACK_IMAGE_CATEGORIES: ImageCategories = {
  text_to_image: {
    label: '文生图',
    limits: {
      image: { min: 0, max: 0 },
    },
  },
  image_to_image: {
    label: '图生图',
    limits: {
      image: { min: 0, max: 10 },
    },
  },
}

export function getImageCategoriesForModel(model?: ModelItem): ImageCategories {
  const parsed = parseImageCategories(model?.image_categories)
  return Object.keys(parsed).length > 0 ? parsed : FALLBACK_IMAGE_CATEGORIES
}

export function getMaxImageReferenceCount(model?: ModelItem): number {
  return getImageCategoriesForModel(model).image_to_image?.limits.image.max ?? 0
}

export function validateImageReferencesForModel(model: ModelItem | undefined, imageCount: number) {
  const categories = getImageCategoriesForModel(model)
  return validateImageReferenceLimits(categories, ACTIVE_IMAGE_CATEGORY, imageCount)
}
