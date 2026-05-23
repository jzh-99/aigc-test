import type { AppNode } from './types'

export type UploadMediaKind = 'image' | 'video' | 'audio'

export type CanvasUploadTarget =
  | { kind: 'canvas' }
  | { kind: 'node'; nodeId: string; mediaKind: UploadMediaKind; uploadMode: 'output' | 'assetConfig' }

type FileLike = Pick<File, 'type'>

export function getCanvasUploadMediaKind(file: FileLike): UploadMediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

export function getNodeUploadRule(node: Pick<AppNode, 'id' | 'type' | 'data'>): CanvasUploadTarget | null {
  if (node.type === 'image_gen') {
    return { kind: 'node', nodeId: node.id, mediaKind: 'image', uploadMode: 'output' }
  }

  if (node.type === 'video_gen' || node.type === 'video_stitch') {
    return { kind: 'node', nodeId: node.id, mediaKind: 'video', uploadMode: 'output' }
  }

  if (node.type === 'audio_gen') {
    return { kind: 'node', nodeId: node.id, mediaKind: 'audio', uploadMode: 'output' }
  }

  if (node.type === 'asset') {
    const mimeType = (node.data.config as { mimeType?: string } | undefined)?.mimeType
    const mediaKind = mimeType ? getCanvasUploadMediaKind({ type: mimeType }) : null
    return mediaKind ? { kind: 'node', nodeId: node.id, mediaKind, uploadMode: 'assetConfig' } : null
  }

  return null
}

export function getUploadAccept(target: CanvasUploadTarget | null | undefined): string {
  if (!target || target.kind === 'canvas') return 'image/*,video/*,audio/*'
  if (target.mediaKind === 'image') return 'image/*'
  if (target.mediaKind === 'video') return 'video/*'
  return 'audio/*'
}

export function isFileAllowedForUploadTarget(file: FileLike, target: CanvasUploadTarget): boolean {
  const mediaKind = getCanvasUploadMediaKind(file)
  if (!mediaKind) return false
  if (target.kind === 'canvas') return true
  return mediaKind === target.mediaKind
}

export function getUploadTargetLabel(target: CanvasUploadTarget): string {
  if (target.kind === 'canvas') return '上传文件'
  if (target.mediaKind === 'image') return '上传图片资源'
  if (target.mediaKind === 'video') return '上传视频资源'
  return '上传音频资源'
}
