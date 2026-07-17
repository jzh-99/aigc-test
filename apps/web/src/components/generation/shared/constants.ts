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

export const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const

export const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

