// action-imitation 模块共享常量
// autoload 会忽略以 _ 开头的文件，此文件仅供同目录路由 import

export const UPLOAD_DIR = '/tmp/action-imitation-uploads'
export const MAX_FILE_AGE_MS = 40 * 60 * 1000 // 40 分钟（覆盖上传 + 最长 35 分钟生成）
export const MAX_VIDEO_SIZE = 200 * 1024 * 1024 // 200 MB

export const VIDEO_EXTS = ['mp4', 'mov', 'webm']
export const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
}

// 安全文件名正则：只允许 UUID + 合法视频扩展名
export const SAFE_ID = /^[\w-]+\.(mp4|mov|webm)$/

export const ACTION_API_VERSION = '2022-08-31'
