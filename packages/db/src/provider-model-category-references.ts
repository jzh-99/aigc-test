import type { ProviderModelModule } from './provider-models-json.js'

export type CategoryReferencesValue = Record<string, {
  label: string
  limits: Record<'image' | 'video' | 'audio' | 'text', { min: number; max: number }>
}>

const ZERO_REFERENCE_LIMIT = { min: 0, max: 0 }

export const TEXT_TO_TEXT_CATEGORY_REFERENCES: CategoryReferencesValue = {
  text_to_text: {
    label: '文本生成',
    limits: {
      image: ZERO_REFERENCE_LIMIT,
      video: ZERO_REFERENCE_LIMIT,
      audio: ZERO_REFERENCE_LIMIT,
      text: ZERO_REFERENCE_LIMIT,
    },
  },
}

export const SIX_IMAGE_CATEGORY_REFERENCES: CategoryReferencesValue = {
  text_to_image: {
    label: '文生图',
    limits: {
      image: ZERO_REFERENCE_LIMIT,
      video: ZERO_REFERENCE_LIMIT,
      audio: ZERO_REFERENCE_LIMIT,
      text: ZERO_REFERENCE_LIMIT,
    },
  },
  image_to_image: {
    label: '图生图',
    limits: {
      image: { min: 0, max: 6 },
      video: ZERO_REFERENCE_LIMIT,
      audio: ZERO_REFERENCE_LIMIT,
      text: ZERO_REFERENCE_LIMIT,
    },
  },
}

export const SEEDREAM_IMAGE_CATEGORY_REFERENCES: CategoryReferencesValue = {
  text_to_image: SIX_IMAGE_CATEGORY_REFERENCES.text_to_image,
  image_to_image: {
    label: '图生图',
    limits: {
      image: { min: 0, max: 14 },
      video: ZERO_REFERENCE_LIMIT,
      audio: ZERO_REFERENCE_LIMIT,
      text: ZERO_REFERENCE_LIMIT,
    },
  },
}

export const FRAMES_CATEGORY_REFERENCES: CategoryReferencesValue = {
  frames: {
    label: '首尾帧',
    limits: {
      image: { min: 1, max: 2 },
      video: ZERO_REFERENCE_LIMIT,
      audio: ZERO_REFERENCE_LIMIT,
      text: ZERO_REFERENCE_LIMIT,
    },
  },
}

export const MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES: CategoryReferencesValue = {
  multimodal: {
    label: '全能参考',
    limits: {
      image: { min: 0, max: 9 },
      video: { min: 0, max: 3 },
      audio: { min: 0, max: 3 },
      text: ZERO_REFERENCE_LIMIT,
    },
  },
  frames: FRAMES_CATEGORY_REFERENCES.frames,
}

export const MUSIC_CATEGORY_REFERENCES: CategoryReferencesValue = {
  text_to_music: {
    label: '文本生成音乐',
    limits: {
      image: ZERO_REFERENCE_LIMIT,
      video: ZERO_REFERENCE_LIMIT,
      audio: ZERO_REFERENCE_LIMIT,
      text: ZERO_REFERENCE_LIMIT,
    },
  },
  voice_clone_music: {
    label: '克隆音色生成音乐',
    limits: {
      image: ZERO_REFERENCE_LIMIT,
      video: ZERO_REFERENCE_LIMIT,
      audio: { min: 0, max: 1 },
      text: ZERO_REFERENCE_LIMIT,
    },
  },
}

const SIX_IMAGE_MODEL_CODES = new Set([
  'gpt-image-2',
  'nano-banana-2',
  'gemini-3.1-flash-image-preview',
])

const SEEDREAM_IMAGE_MODEL_CODES = new Set([
  'seedream-5.0-lite',
  'seedream-4.5',
  'seedream-4.0',
  'ctyun-seedream-5.0-lite',
])

const VIDEO_MULTIMODAL_MODEL_CODES = new Set([
  'seedance-2.0',
  'seedance-2.0-fast',
  'ctyun-seedance-2.0',
  'ctyun-seedance-2.0-fast',
])

const VIDEO_FRAMES_MODEL_CODES = new Set([
  'seedance-1.5-pro',
])

export function resolveProviderModelCategoryReferences(input: {
  code: string
  module: ProviderModelModule
  paramsSchema: Record<string, unknown>
}): CategoryReferencesValue | Record<string, never> {
  if (SIX_IMAGE_MODEL_CODES.has(input.code)) return SIX_IMAGE_CATEGORY_REFERENCES
  if (SEEDREAM_IMAGE_MODEL_CODES.has(input.code)) return SEEDREAM_IMAGE_CATEGORY_REFERENCES
  if (VIDEO_MULTIMODAL_MODEL_CODES.has(input.code)) return MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES
  if (VIDEO_FRAMES_MODEL_CODES.has(input.code)) return FRAMES_CATEGORY_REFERENCES

  if (input.module === 'agent') return TEXT_TO_TEXT_CATEGORY_REFERENCES
  if (input.module === 'music') return MUSIC_CATEGORY_REFERENCES

  const imageRef = input.paramsSchema.image_ref
  if (input.module === 'image' && (imageRef === '14' || imageRef === 14)) return SEEDREAM_IMAGE_CATEGORY_REFERENCES
  if (input.module === 'image') return SIX_IMAGE_CATEGORY_REFERENCES

  const modes = input.paramsSchema.mode
  if (input.module === 'video' && Array.isArray(modes) && modes.includes('multimodal')) {
    return MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES
  }
  if (input.module === 'video') return FRAMES_CATEGORY_REFERENCES

  return {}
}
