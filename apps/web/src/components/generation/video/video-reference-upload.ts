import type { VideoReferenceCounts } from '@aigc/types'

import {
  ALLOWED_AUDIO_EXTS,
  ALLOWED_AUDIO_TYPES,
  ALLOWED_IMAGE_EXTS,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_EXTS,
  ALLOWED_VIDEO_TYPES,
} from '../shared/constants'

export type ReferenceFileKind = 'image' | 'video' | 'audio'

export interface PendingReferenceFile {
  name: string
  type: string
}

export interface AcceptedReferenceFile<TFile extends PendingReferenceFile> {
  file: TFile
  kind: ReferenceFileKind
}

export interface RejectedReferenceFile<TFile extends PendingReferenceFile> {
  file: TFile
  message: string
}

export interface ReferenceFileSelection<TFile extends PendingReferenceFile> {
  accepted: AcceptedReferenceFile<TFile>[]
  rejected: RejectedReferenceFile<TFile>[]
}

const getFileExt = (file: PendingReferenceFile): string => file.name.split('.').pop()?.toLowerCase() ?? ''

const includesValue = (values: readonly string[], value: string): boolean => values.includes(value)

export function getReferenceFileKind(file: PendingReferenceFile): ReferenceFileKind | null {
  const ext = getFileExt(file)
  if (includesValue(ALLOWED_IMAGE_TYPES, file.type) || includesValue(ALLOWED_IMAGE_EXTS, ext)) return 'image'
  if (includesValue(ALLOWED_VIDEO_TYPES, file.type) || includesValue(ALLOWED_VIDEO_EXTS, ext)) return 'video'
  if (includesValue(ALLOWED_AUDIO_TYPES, file.type) || includesValue(ALLOWED_AUDIO_EXTS, ext)) return 'audio'
  return null
}

function getLimitMessage(kind: ReferenceFileKind, limit: number): string {
  if (kind === 'image') return `最多添加 ${limit} 张参考图`
  if (kind === 'video') return `最多添加 ${limit} 个参考视频`
  return `最多添加 ${limit} 个参考音频`
}

export function getAcceptedReferenceFiles<TFile extends PendingReferenceFile>(
  files: Iterable<TFile>,
  currentCounts: VideoReferenceCounts,
  limits: VideoReferenceCounts,
): ReferenceFileSelection<TFile> {
  const nextCounts: VideoReferenceCounts = { ...currentCounts }
  const accepted: AcceptedReferenceFile<TFile>[] = []
  const rejected: RejectedReferenceFile<TFile>[] = []

  for (const file of files) {
    const kind = getReferenceFileKind(file)
    if (!kind) {
      rejected.push({ file, message: `文件「${file.name}」格式不支持` })
      continue
    }

    const limit = limits[kind] || 0
    if ((nextCounts[kind] || 0) >= limit) {
      rejected.push({ file, message: getLimitMessage(kind, limit) })
      continue
    }

    nextCounts[kind] = (nextCounts[kind] || 0) + 1
    accepted.push({ file, kind })
  }

  return { accepted, rejected }
}
