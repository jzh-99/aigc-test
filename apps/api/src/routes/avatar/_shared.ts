// avatar 模块共享常量
// autoload 会忽略以 _ 开头的文件，此文件仅供同目录路由 import

export const UPLOAD_DIR = '/tmp/avatar-uploads'
export const MAX_FILE_AGE_MS = 20 * 60 * 1000 // 20 分钟
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB
export const MAX_AUDIO_SIZE = 20 * 1024 * 1024 // 20 MB

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp']
export const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac']

export const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}
export const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
}

// 安全文件名正则：只允许 UUID + 合法图片/音频扩展名
export const SAFE_ID = /^[\w-]+\.(jpg|jpeg|png|webp|mp3|wav|m4a|aac)$/

export const OMNI_API_VERSION = '2022-08-31'
