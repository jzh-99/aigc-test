import { generateUUID } from '@/lib/utils'
import { toast } from 'sonner'
import type { FrameImage } from './types'
import {
  ALLOWED_IMAGE_TYPES, ALLOWED_IMAGE_EXTS,
  ALLOWED_VIDEO_TYPES, ALLOWED_VIDEO_EXTS,
  ALLOWED_AUDIO_TYPES, ALLOWED_AUDIO_EXTS,
  MAX_FILE_MB,
} from './constants'

export function isValidImageFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ALLOWED_IMAGE_TYPES.includes(file.type) || ALLOWED_IMAGE_EXTS.includes(ext)
}

export function isValidVideoFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ALLOWED_VIDEO_TYPES.includes(file.type) || ALLOWED_VIDEO_EXTS.includes(ext)
}

export function isValidAudioFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ALLOWED_AUDIO_TYPES.includes(file.type) || ALLOWED_AUDIO_EXTS.includes(ext)
}

export async function readFrameFile(file: File, silent = false): Promise<FrameImage | null> {
  if (!isValidImageFile(file)) {
    if (!silent) toast.error(`文件「${file.name}」格式不支持，请上传 JPG / PNG / WEBP 格式的图片`)
    return null
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    if (!silent) toast.error(`图片「${file.name}」过大（${(file.size / 1024 / 1024).toFixed(1)} MB），不超过 ${MAX_FILE_MB} MB`)
    return null
  }
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve({
      id: generateUUID(),
      previewUrl: URL.createObjectURL(file),
      dataUrl: reader.result as string,
      file,
    })
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export function getDraggedAsset(dataTransfer: DataTransfer): { url: string; type: string } {
  return {
    url: dataTransfer.getData('application/x-aigc-asset-url') || dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain'),
    type: dataTransfer.getData('application/x-aigc-asset-type'),
  }
}

export async function fetchAssetFile(url: string, assetType: string, baseName: string): Promise<File> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error('fetch failed')
  const blob = await resp.blob()
  const fallbackExt = assetType === 'video' ? 'mp4' : assetType === 'audio' ? 'mp3' : 'jpg'
  const ext = blob.type.split('/')[1] || fallbackExt
  const mime = blob.type || (assetType === 'video' ? 'video/mp4' : assetType === 'audio' ? 'audio/mpeg' : 'image/jpeg')
  return new File([blob], `${baseName}.${ext}`, { type: mime })
}

export async function getActionImagePayload(image: FrameImage): Promise<{ base64: string; mime: 'image/jpeg' | 'image/png' }> {
  const dataUrl = image.dataUrl.startsWith('data:')
    ? image.dataUrl
    : await fetch(image.dataUrl).then(async (r) => {
      if (!r.ok) throw new Error('reference image fetch failed')
      const blob = await r.blob()
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    })
  const [header, base64] = dataUrl.split(',')
  const rawMime = header?.replace('data:', '').replace(';base64', '')
  const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime
  if ((mime !== 'image/jpeg' && mime !== 'image/png') || !base64) {
    throw new Error('ACTION_IMAGE_UNSUPPORTED_FORMAT')
  }
  return { base64, mime }
}
