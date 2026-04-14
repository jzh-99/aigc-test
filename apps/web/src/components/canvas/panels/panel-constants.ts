import type { ElementType } from 'react'
import { Sparkles, Target, Zap } from 'lucide-react'
import type { ImageModelType, ImageResolution } from '@/lib/canvas/types'

export type ModelType = ImageModelType
export type Resolution = ImageResolution

export interface ImageModelOption {
  value: ModelType
  label: string
  icon: ElementType
  resolutions: Resolution[]
  supportsWatermark: boolean
}

export const IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
  { value: 'gemini', label: '全能图片2', icon: Zap, resolutions: ['1k', '2k', '4k'], supportsWatermark: false },
  { value: 'nano-banana-pro', label: '全能图片Pro', icon: Target, resolutions: ['1k', '2k', '4k'], supportsWatermark: false },
  { value: 'seedream-5.0-lite', label: 'Seedream 5.0', icon: Sparkles, resolutions: ['2k', '3k'], supportsWatermark: true },
  { value: 'seedream-4.5', label: 'Seedream 4.5', icon: Sparkles, resolutions: ['2k', '4k'], supportsWatermark: true },
  { value: 'seedream-4.0', label: 'Seedream 4.0', icon: Sparkles, resolutions: ['1k', '2k', '4k'], supportsWatermark: true },
]

export const MODEL_CODE_MAP: Record<ModelType, Partial<Record<Resolution, string>>> = {
  gemini: {
    '1k': 'gemini-3.1-flash-image-preview',
    '2k': 'gemini-3.1-flash-image-preview-2k',
    '4k': 'gemini-3.1-flash-image-preview-4k',
  },
  'nano-banana-pro': {
    '1k': 'nano-banana-2',
    '2k': 'nano-banana-2-2k',
    '4k': 'nano-banana-2-4k',
  },
  'seedream-5.0-lite': {
    '2k': 'seedream-5.0-lite',
    '3k': 'seedream-5.0-lite',
  },
  'seedream-4.5': {
    '2k': 'seedream-4.5',
    '4k': 'seedream-4.5',
  },
  'seedream-4.0': {
    '1k': 'seedream-4.0',
    '2k': 'seedream-4.0',
    '4k': 'seedream-4.0',
  },
}

export const ASPECT_RATIOS_IMAGE = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
export const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

export interface VideoModelOption {
  value: string
  label: string
  isSeedance: boolean
  isSeedance2: boolean
  supportsMultiref: boolean
  supportsKeyframe: boolean
}

export const VIDEO_MODEL_OPTIONS: VideoModelOption[] = [
  { value: 'seedance-2.0', label: 'Seedance 2.0', isSeedance: true, isSeedance2: true, supportsMultiref: true, supportsKeyframe: true },
  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', isSeedance: true, isSeedance2: true, supportsMultiref: true, supportsKeyframe: true },
  { value: 'seedance-1.5-pro', label: 'Seedance 1.5 Pro', isSeedance: true, isSeedance2: false, supportsMultiref: false, supportsKeyframe: true },
  { value: 'veo3.1-fast', label: 'Veo 3.1 Fast', isSeedance: false, isSeedance2: false, supportsMultiref: false, supportsKeyframe: true },
]

export const VIDEO_ASPECT_RATIOS_SEEDANCE = [
  { value: 'adaptive', label: '自适应' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9' },
] as const

export const VIDEO_ASPECT_RATIOS_VEO = [
  { value: '', label: '自动' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const

export const SEEDANCE_DURATION_OPTIONS = [
  { value: -1, label: '自动' },
  { value: 4, label: '4秒' },
  { value: 5, label: '5秒' },
  { value: 6, label: '6秒' },
  { value: 8, label: '8秒' },
  { value: 10, label: '10秒' },
  { value: 12, label: '12秒' },
  { value: 15, label: '15秒' },
] as const

export const VIDEO_CREDITS_PER_SEC: Record<string, number> = {
  'seedance-2.0': 5,
  'seedance-2.0-fast': 3,
  'seedance-1.5-pro': 4,
  'veo3.1-fast': 10,
}
