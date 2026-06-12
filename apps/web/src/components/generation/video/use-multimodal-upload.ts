'use client'

import { useRef, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'
import { generateUUID } from '@/lib/utils'
import { fetchRawWithAuth } from '@/lib/fetch-with-auth'
import type { FrameImage } from '../shared/types'
import { readFrameFile, fetchAssetFile, getDraggedAsset } from '../shared/file-utils'
import { getAcceptedReferenceFiles, getReferenceFileKind } from './video-reference-upload'
import { SEEDANCE_MAX_TOTAL_VIDEO_DURATION } from '../shared/constants'
import type { VideoReferenceCounts } from '@aigc/types'
import type { MultimodalVideo, MultimodalAudio } from './video-multimodal-zone'

interface UseMultimodalUploadOptions {
  /** 当前图片列表 */
  images: FrameImage[]
  /** 当前视频列表 */
  videos: MultimodalVideo[]
  /** 当前音频列表 */
  audios: MultimodalAudio[]
  /** 是否为 Seedance 模型（有总时长限制） */
  isSeedance: boolean
  /** 各类型限制 */
  referenceLimits: VideoReferenceCounts
  /** 图片列表更新 */
  onImagesChange: Dispatch<SetStateAction<FrameImage[]>>
  /** 视频列表更新 */
  onVideosChange: Dispatch<SetStateAction<MultimodalVideo[]>>
  /** 音频列表更新 */
  onAudiosChange: Dispatch<SetStateAction<MultimodalAudio[]>>
}

/**
 * 多模态素材上传/验证/删除逻辑 Hook
 * 从 VideoMultimodalZone 中提取，供 ImmersiveEditor 使用
 */
export function useMultimodalUpload({
  images,
  videos,
  audios,
  isSeedance,
  referenceLimits,
  onImagesChange,
  onVideosChange,
  onAudiosChange,
}: UseMultimodalUploadOptions) {
  const allInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const imageLimit = referenceLimits.image || 0
  const videoLimit = referenceLimits.video || 0
  const audioLimit = referenceLimits.audio || 0

  /** 验证并添加视频文件 */
  const validateAndAddVideo = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.src = url
    el.onloadedmetadata = () => {
      const dur = el.duration
      URL.revokeObjectURL(url)
      const pixels = (el.videoWidth || 1280) * (el.videoHeight || 720)
      if (pixels > 927408) {
        toast.error('视频分辨率过高，请上传 720p 及以下的视频')
        return
      }
      onVideosChange((prev) => {
        if (isSeedance) {
          const totalDur = prev.reduce((s, v) => s + v.duration, 0)
          if (totalDur + dur > SEEDANCE_MAX_TOTAL_VIDEO_DURATION) {
            toast.error(`所有参考视频总时长不能超过 ${SEEDANCE_MAX_TOTAL_VIDEO_DURATION} 秒`)
            return prev
          }
        }
        if (prev.length >= videoLimit) {
          toast.error(`最多添加 ${videoLimit} 个参考视频`)
          return prev
        }
        const previewUrl = URL.createObjectURL(file)
        return [...prev, { id: generateUUID(), name: file.name, previewUrl, file, duration: dur }]
      })
    }
  }, [isSeedance, onVideosChange, videoLimit])

  /** 验证并添加音频文件 */
  const validateAndAddAudio = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('audio')
    el.src = url
    el.onloadedmetadata = () => {
      const dur = el.duration
      URL.revokeObjectURL(url)
      const previewUrl = URL.createObjectURL(file)
      onAudiosChange((prev) => {
        if (prev.length >= audioLimit) {
          toast.error(`最多添加 ${audioLimit} 个参考音频`)
          return prev
        }
        return [...prev, { id: generateUUID(), name: file.name, previewUrl, file, duration: dur }]
      })
    }
  }, [audioLimit, onAudiosChange])

  /** 处理文件选择 */
  const handleAllFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    const { accepted, rejected } = getAcceptedReferenceFiles(
      Array.from(files),
      { image: images.length, video: videos.length, audio: audios.length, text: 0 },
      referenceLimits,
    )

    if (rejected.length > 0) {
      for (const item of rejected) toast.error(item.message)
      if (allInputRef.current) allInputRef.current.value = ''
      return
    }

    const newImages: FrameImage[] = []
    for (const { file, kind } of accepted) {
      if (kind === 'image') {
        const img = await readFrameFile(file)
        if (img) newImages.push(img)
        continue
      }
      if (kind === 'video') validateAndAddVideo(file)
      if (kind === 'audio') validateAndAddAudio(file)
    }
    if (newImages.length > 0) onImagesChange((prev) => [...prev, ...newImages])
    if (allInputRef.current) allInputRef.current.value = ''
  }, [audios.length, images.length, onImagesChange, referenceLimits, validateAndAddAudio, validateAndAddVideo, videos.length])

  /** 处理拖拽放下 */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) {
      await handleAllFiles(e.dataTransfer.files)
      return
    }
    const asset = getDraggedAsset(e.dataTransfer)
    if (!asset.url) return
    try {
      const file = await fetchAssetFile(asset.url, asset.type, 'asset', fetchRawWithAuth)
      if (getReferenceFileKind(file) === 'video') {
        if (videos.length >= videoLimit) { toast.error(`最多添加 ${videoLimit} 个参考视频`); return }
        validateAndAddVideo(file)
      } else if (getReferenceFileKind(file) === 'image') {
        if (images.length >= imageLimit) { toast.error(`最多添加 ${imageLimit} 张参考图`); return }
        const img = await readFrameFile(file, true)
        if (img) {
          onImagesChange((prev) => {
            if (prev.length >= imageLimit) {
              toast.error(`最多添加 ${imageLimit} 张参考图`)
              return prev
            }
            return [...prev, img]
          })
        }
      }
    } catch {
      toast.error('素材加载失败，请确认网络可访问素材服务器')
    }
  }, [handleAllFiles, videos.length, images.length, onImagesChange, validateAndAddVideo, videoLimit, imageLimit])

  /** 删除指定 ID 的素材（在所有类型中查找） */
  const handleRemoveItem = useCallback((id: string) => {
    // 先在图片中查找
    const imgIdx = images.findIndex((img) => img.id === id)
    if (imgIdx >= 0) {
      onImagesChange((prev) => prev.filter((_, i) => i !== imgIdx))
      return
    }
    // 在视频中查找
    const vidIdx = videos.findIndex((v) => v.id === id)
    if (vidIdx >= 0) {
      onVideosChange((prev) => prev.filter((_, i) => i !== vidIdx))
      return
    }
    // 在音频中查找
    const audIdx = audios.findIndex((a) => a.id === id)
    if (audIdx >= 0) {
      onAudiosChange((prev) => prev.filter((_, i) => i !== audIdx))
    }
  }, [images, videos, audios, onImagesChange, onVideosChange, onAudiosChange])

  /** 清空所有素材 */
  const handleClearAll = useCallback(() => {
    onImagesChange([])
    onVideosChange([])
    onAudiosChange([])
  }, [onImagesChange, onVideosChange, onAudiosChange])

  return {
    allInputRef,
    imageInputRef,
    videoInputRef,
    audioInputRef,
    handleAllFiles,
    handleDrop,
    handleRemoveItem,
    handleClearAll,
  }
}
