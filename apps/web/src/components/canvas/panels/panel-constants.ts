import type { ImageModelType, ImageResolution } from '@/lib/canvas/types'

export type ModelType = ImageModelType
export type Resolution = ImageResolution

export const ASPECT_RATIOS_IMAGE = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
export const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

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

