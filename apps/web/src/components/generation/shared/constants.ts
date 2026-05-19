import { Sparkles, Zap, Target } from 'lucide-react'
import { IMAGE_MODEL_CREDITS } from '@/lib/credits'

export const MAX_REF_IMAGES = 10
export const MAX_FILE_MB = 20
export const MAX_MULTIMODAL_IMAGES = 9
export const MAX_MULTIMODAL_VIDEOS = 3
export const MAX_MULTIMODAL_AUDIOS = 3
export const SEEDANCE_MAX_TOTAL_VIDEO_DURATION = 15.2

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
export const ALLOWED_VIDEO_EXTS = ['mp4', 'mov', 'webm']
export const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a']
export const ALLOWED_AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac']

export type ModelResolution = '1k' | '2k' | '3k' | '4k'

export const MODEL_OPTIONS: Array<{
  value: 'gemini' | 'gpt-image-2' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
  label: string
  icon: React.ElementType
  desc: string
  credits: number
  resolutions: ModelResolution[]
  supportsWatermark: boolean
}> = [
  { value: 'gemini', label: '全能图片2', icon: Zap, desc: '快速生成，适合日常使用', credits: IMAGE_MODEL_CREDITS['gemini'], resolutions: ['1k', '2k', '4k'], supportsWatermark: false },
  { value: 'gpt-image-2', label: '超能图片2', icon: Zap, desc: '文字渲染准确，UI截图逼真，照片级真实感', credits: IMAGE_MODEL_CREDITS['gpt-image-2'], resolutions: ['2k'], supportsWatermark: false },
  { value: 'nano-banana-pro', label: '全能图片Pro', icon: Target, desc: '高质量输出，细节丰富', credits: IMAGE_MODEL_CREDITS['nano-banana-pro'], resolutions: ['1k', '2k', '4k'], supportsWatermark: false },
  { value: 'seedream-5.0-lite', label: 'Seedream 5.0', icon: Sparkles, desc: '最新火山引擎模型，联网搜索增强', credits: IMAGE_MODEL_CREDITS['seedream-5.0-lite'], resolutions: ['2k', '3k'], supportsWatermark: true },
  { value: 'seedream-4.5', label: 'Seedream 4.5', icon: Sparkles, desc: '高分辨率图像生成', credits: IMAGE_MODEL_CREDITS['seedream-4.5'], resolutions: ['2k', '4k'], supportsWatermark: true },
  { value: 'seedream-4.0', label: 'Seedream 4.0', icon: Sparkles, desc: '多分辨率图像生成', credits: IMAGE_MODEL_CREDITS['seedream-4.0'], resolutions: ['1k', '2k', '4k'], supportsWatermark: true },
]

export const ALL_RESOLUTION_OPTIONS: Array<{ value: ModelResolution; label: string }> = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '3k', label: '3K' },
  { value: '4k', label: '4K' },
]

export const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const

export const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

