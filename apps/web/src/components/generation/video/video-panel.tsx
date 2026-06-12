'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Film, Music, ImagePlus, Image as ImageIcon } from 'lucide-react'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useVideoGenerate } from '@/hooks/use-video-generate'
import { useConfirm } from '@/hooks/use-confirm'
import { useGenerationDefaults } from '@/hooks/use-generation-defaults'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'

const ModelBrandIcon = dynamic(
  () => import('../shared/model-brand-icon').then((m) => ({ default: m.ModelBrandIcon })),
  { ssr: false, loading: () => <span className="inline-block h-4 w-4" /> }
)

/** 模型图标渲染入口（异步加载，避免 @lobehub/icons 进入首屏 bundle） */
import {
  getVideoCategoryKeys,
  parseCategoryReferences,
  validateCategoryReferenceLimits,
  calculateReferenceVideoDurationSeconds,
  type VideoCategory,
  type VideoReferenceCounts,
  type ModelItem,
} from '@aigc/types'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import { resolveMentionPrompt, syncMentionResourceLabels } from '@/components/shared/mention-editor'
import type { MentionResource } from '@/components/shared/mention-editor'
import { fetchWithAuth, ApiError, getRequestErrorMessage, reportClientSubmissionError, classifyRequestError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { VideoParams } from '@/stores/generation-store'
import type { MultimodalVideo, MultimodalAudio } from './video-multimodal-zone'
import { useMultimodalUpload } from './use-multimodal-upload'
import { ImmersiveEditor } from '../shared/immersive-editor'
import type { MediaGridItem } from '../shared/media-grid-types'
import { VideoParams as VideoParamsPanel } from './video-params'
import type { FrameImage } from '../shared/types'
import { readFrameFile, isValidImageFile, fetchAssetFile, getDraggedAsset } from '../shared/file-utils'
import { useModels } from '@/hooks/use-models'

type VideoMode = VideoCategory

interface VideoPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
  initialParams?: VideoParams | null
}

function referenceToFrameImage(img: NonNullable<VideoParams['videoFrameImages']>[number] | undefined): FrameImage | null {
  if (!img) return null
  return {
    id: img.id,
    previewUrl: img.previewUrl,
    dataUrl: img.dataUrl ?? img.previewUrl,
    file: img.file,
  }
}

function referenceImagesToFrameImages(images: NonNullable<VideoParams['videoReferenceImages']> | undefined): FrameImage[] {
  return (images ?? [])
    .map((img) => referenceToFrameImage(img))
    .filter((img): img is FrameImage => !!img)
}

export function VideoPanel({ onBatchCreated, disabled, initialParams }: VideoPanelProps) {
  const { watermark, avatarDefaults, userDefaults, pendingVideoReferenceImages, clearPendingVideoReferenceImages, videoPrompt, setVideoPrompt } = useGenerationStore()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { save: saveDefaults } = useGenerationDefaults()
  const { generate: generateVideo, isGenerating: isVideoGenerating } = useVideoGenerate()
  const confirm = useConfirm()
  const { models: videoModels, isReady: videoModelsReady } = useModels('video', activeWorkspaceId)

  const [videoMode, setVideoMode] = useState<VideoMode>((initialParams?.videoMode as VideoMode) ?? 'multimodal')
  const [videoModel, setVideoModel] = useState(initialParams?.videoModel ?? 'seedance-2.0')
  const [videoAspectRatio, setVideoAspectRatio] = useState(initialParams?.videoAspectRatio ?? 'adaptive')
  const [videoResolution, setVideoResolution] = useState(initialParams?.videoResolution ?? '')
  const [videoDuration, setVideoDuration] = useState(initialParams?.videoDuration ?? -1)
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(initialParams?.videoGenerateAudio ?? true)
  const [videoCameraFixed, setVideoCameraFixed] = useState(initialParams?.videoCameraFixed ?? false)
  const [isVideoUploading, setIsVideoUploading] = useState(false)

  // 从历史记录恢复时，将 prompt 写入 store
  useEffect(() => {
    if (initialParams?.videoPrompt) setVideoPrompt(initialParams.videoPrompt)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [firstFrame, setFirstFrame] = useState<FrameImage | null>(() => referenceToFrameImage(initialParams?.videoFrameImages?.[0]))
  const [lastFrame, setLastFrame] = useState<FrameImage | null>(() => referenceToFrameImage(initialParams?.videoFrameImages?.[1]))

  const [multimodalImages, setMultimodalImages] = useState<FrameImage[]>(() => referenceImagesToFrameImages(initialParams?.videoReferenceImages))
  const [multimodalVideos, setMultimodalVideos] = useState<MultimodalVideo[]>([])
  const [multimodalAudios, setMultimodalAudios] = useState<MultimodalAudio[]>([])
  const previousMentionResourcesRef = useRef<MentionResource[] | null>(null)

  /** Frames 模式专用文件 input */
  const frameInputRef = useRef<HTMLInputElement>(null)

  /** 将已上传的参考资源映射为 @ 提及资源 */
  const mentionResources = useMemo<MentionResource[]>(() => {
    const items: MentionResource[] = []
    multimodalImages.forEach((img, i) => {
      const id = img.id ?? img.previewUrl
      items.push({ id, mentionLabel: `图片${i + 1}`, sourceLabel: '参考图', kind: 'image' })
    })
    multimodalVideos.forEach((vid, i) => {
      items.push({ id: vid.id, mentionLabel: `视频${i + 1}`, sourceLabel: vid.name, kind: 'video' })
    })
    multimodalAudios.forEach((aud, i) => {
      items.push({ id: aud.id, mentionLabel: `音频${i + 1}`, sourceLabel: aud.name, kind: 'audio' })
    })
    return items
  }, [multimodalImages, multimodalVideos, multimodalAudios])

  useEffect(() => {
    const previousResources = previousMentionResourcesRef.current
    previousMentionResourcesRef.current = mentionResources
    if (!previousResources) return
    const nextPrompt = syncMentionResourceLabels(videoPrompt, previousResources, mentionResources)
    if (nextPrompt !== videoPrompt) setVideoPrompt(nextPrompt)
  }, [mentionResources, videoPrompt, setVideoPrompt])

  /** multimodal 模式的网格条目 */
  const multimodalGridItems = useMemo<MediaGridItem[]>(() => [
    ...multimodalImages.map((img) => {
      const id = img.id ?? img.previewUrl
      const index = multimodalImages.findIndex((item) => (item.id ?? item.previewUrl) === id)
      return { id, kind: 'image' as const, previewUrl: img.previewUrl, label: `图片${index + 1}` }
    }),
    ...multimodalVideos.map((v, i) => ({ id: v.id, kind: 'video' as const, previewUrl: v.previewUrl, label: `视频${i + 1}`, name: v.name, duration: v.duration })),
    ...multimodalAudios.map((a, i) => ({ id: a.id, kind: 'audio' as const, previewUrl: '', label: `音频${i + 1}`, name: a.name, duration: a.duration })),
  ], [multimodalImages, multimodalVideos, multimodalAudios])

  /** frames 模式的网格条目 */
  const framesGridItems = useMemo<MediaGridItem[]>(() => {
    const items: MediaGridItem[] = []
    if (firstFrame) items.push({ id: firstFrame.id ?? 'first', kind: 'image', previewUrl: firstFrame.previewUrl, label: '首帧图' })
    if (lastFrame) items.push({ id: lastFrame.id ?? 'last', kind: 'image', previewUrl: lastFrame.previewUrl, label: '尾帧图' })
    return items
  }, [firstFrame, lastFrame])

  /** 当前模式的网格条目 */
  const gridItems = videoMode === 'frames' ? framesGridItems : multimodalGridItems

  /** frames 模式：删除素材（首帧删除联动清空尾帧） */
  const handleFrameRemoveItem = useCallback((id: string) => {
    if (id === (firstFrame?.id ?? 'first')) {
      setFirstFrame(null)
      setLastFrame(null)
    } else if (id === (lastFrame?.id ?? 'last')) {
      setLastFrame(null)
    }
  }, [firstFrame, lastFrame])

  /** frames 模式：添加素材（自动填充空槽位） */
  const handleFrameFileSelect = useCallback(async (files: FileList | null) => {
    if (!files?.[0]) return
    const file = files[0]
    if (isValidImageFile(file)) {
      const img = await readFrameFile(file)
      if (img) {
        if (!firstFrame) setFirstFrame(img)
        else if (!lastFrame) setLastFrame(img)
      }
    }
    if (frameInputRef.current) frameInputRef.current.value = ''
  }, [firstFrame, lastFrame])

  const currentVideoModel = videoModels.find((m) => m.code === videoModel)
  const currentCategoryReferences = useMemo(
    () => parseCategoryReferences(currentVideoModel?.category_references),
    [currentVideoModel?.category_references],
  )
  const availableVideoModes = useMemo(() => getVideoCategoryKeys(currentCategoryReferences), [currentCategoryReferences])
  const multimodalReferenceLimits = useMemo<VideoReferenceCounts>(() => ({
    image: currentCategoryReferences.multimodal?.limits.image.max ?? 0,
    video: currentCategoryReferences.multimodal?.limits.video.max ?? 0,
    audio: currentCategoryReferences.multimodal?.limits.audio.max ?? 0,
    text: 0,
  }), [currentCategoryReferences])
  const getResourceCounts = useCallback((mode: VideoMode): VideoReferenceCounts => {
    if (mode === 'frames') {
      return { image: [firstFrame, lastFrame].filter(Boolean).length, video: 0, audio: 0, text: 0 }
    }

    return {
      image: multimodalImages.length,
      video: multimodalVideos.length,
      audio: multimodalAudios.length,
      text: 0,
    }
  }, [firstFrame, lastFrame, multimodalAudios.length, multimodalImages.length, multimodalVideos.length])

  const validateModeResources = useCallback((mode: VideoMode): boolean => {
    const result = validateCategoryReferenceLimits(currentCategoryReferences, mode, getResourceCounts(mode))
    if (!result.valid) toast.error(result.message ?? '当前参考素材不符合模型限制')
    return result.valid
  }, [currentCategoryReferences, getResourceCounts])

  useEffect(() => {
    if (!videoModelsReady || videoModels.length === 0) return
    const nextModel = videoModels.find((m) => getVideoCategoryKeys(parseCategoryReferences(m.category_references)).length > 0)
    const isValid = videoModels.some((m) => m.code === videoModel)
    if (!isValid && nextModel) setVideoModel(nextModel.code)
  }, [videoModelsReady, videoModels, videoModel])

  useEffect(() => {
    if (!videoModelsReady || availableVideoModes.length === 0) return
    if (!availableVideoModes.includes(videoMode)) setVideoMode(availableVideoModes[0])
  }, [availableVideoModes, videoMode, videoModelsReady])

  useEffect(() => {
    if (!videoModelsReady || videoModels.length === 0) return
    const currentModel = videoModels.find((m) => m.code === videoModel)
    if (!currentModel) return
    const durationOptions = extractSchemaEnums(currentModel.params_schema, 'time_length')
    if (durationOptions.length === 0) return
    const firstValue = Number(durationOptions[0].value)
    if (!durationOptions.some((opt) => Number(opt.value) === videoDuration)) {
      setVideoDuration(firstValue)
    }
  }, [videoModelsReady, videoModels, videoModel])

  useEffect(() => {
    if (!videoModelsReady || videoModels.length === 0) return
    const currentModel = videoModels.find((m) => m.code === videoModel)
    if (!currentModel) return
    const resolutionOptions = extractSchemaEnums(currentModel.params_schema, 'resolution')
    if (resolutionOptions.length === 0) return
    if (!videoResolution || !resolutionOptions.some((opt) => opt.value === videoResolution)) {
      setVideoResolution(resolutionOptions[0].value)
    }
  }, [videoModelsReady, videoModels, videoModel])

  const isSeedance = videoModel.startsWith('seedance-')

  /** 多模态上传 Hook（封装验证/拖拽/删除逻辑） */
  const {
    allInputRef,
    handleAllFiles,
    handleDrop: handleMultimodalDrop,
    handleRemoveItem: handleMultimodalRemoveItem,
  } = useMultimodalUpload({
    images: multimodalImages,
    videos: multimodalVideos,
    audios: multimodalAudios,
    isSeedance,
    referenceLimits: multimodalReferenceLimits,
    onImagesChange: setMultimodalImages,
    onVideosChange: setMultimodalVideos,
    onAudiosChange: setMultimodalAudios,
  })

  // 预估 A 豆消耗（用于确认弹窗）
  const videoEstimatedCredits = useMemo(() => {
    const model = videoModels.find((m) => m.code === videoModel)
    if (!model) return 0
    const unitPrice = getPriceByResolution(model, videoResolution)
    const billableDuration = (videoDuration === -1 ? 15 : videoDuration) + calculateReferenceVideoDurationSeconds(multimodalVideos.map((v) => v.duration))
    return isSeedance ? billableDuration * unitPrice : unitPrice
  }, [videoModels, videoModel, videoResolution, videoDuration, multimodalVideos, isSeedance])

  useEffect(() => {
    if (pendingVideoReferenceImages.length === 0) return
    setVideoMode('multimodal')
    setMultimodalImages((currentImages) => [
      ...currentImages,
      ...pendingVideoReferenceImages.map((img) => ({
        id: img.id,
        previewUrl: img.previewUrl,
        dataUrl: img.dataUrl ?? img.previewUrl,
        file: img.file,
      })),
    ])
    clearPendingVideoReferenceImages()
  }, [pendingVideoReferenceImages, clearPendingVideoReferenceImages])

  const handleFrameDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      if (isValidImageFile(file)) {
        const img = await readFrameFile(file)
        if (img) { if (!firstFrame) setFirstFrame(img); else setLastFrame(img) }
      }
      return
    }
    const asset = getDraggedAsset(e.dataTransfer)
    if (asset.url && (asset.type === 'image' || !asset.type)) {
      try {
        const file = await fetchAssetFile(asset.url, 'image', 'frame')
        const img = await readFrameFile(file, true)
        if (img) { if (!firstFrame) setFirstFrame(img); else setLastFrame(img) }
      } catch { toast.error('图片加载失败') }
    }
  }, [firstFrame])

  const uploadToVideoTemp = async (fileOrDataUrl: File | string, filename: string): Promise<string> => {
    const form = new FormData()
    if (fileOrDataUrl instanceof File) {
      form.append('file', fileOrDataUrl, fileOrDataUrl.name)
    } else {
      const res = await fetch(fileOrDataUrl)
      const blob = await res.blob()
      form.append('file', blob, filename)
    }
    const json = await fetchWithAuth<{ url: string }>('/videos/upload', { method: 'POST', body: form })
    return json.url
  }

  const resolveVideoImageInput = async (img: FrameImage, filename: string, requireUrl: boolean): Promise<string> => {
    if (requireUrl) return uploadToVideoTemp(img.file ?? img.dataUrl, filename)
    if (img.dataUrl.startsWith('data:')) return img.dataUrl
    const resp = await fetch(img.dataUrl)
    if (!resp.ok) throw new Error('reference image fetch failed')
    const blob = await resp.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  const handleVideoGenerate = async () => {
    if (!videoPrompt.trim()) return
    if (!validateModeResources(videoMode)) return
    const ok = await confirm({
      title: '确认生成',
      description: `本次操作预计消耗 ${videoEstimatedCredits} A豆（视频生成），确认是否继续？`,
      confirmText: '确认生成',
      destructive: false,
    })
    if (!ok) return
    setIsVideoUploading(true)
    try {
      let imagesParam: string[] | undefined
      let referenceImagesParam: string[] | undefined
      let referenceVideosParam: string[] | undefined
      let referenceVideoDurationsParam: number[] | undefined
      let referenceAudiosParam: string[] | undefined

      if (videoMode === 'frames') {
        const arr: string[] = []
        if (firstFrame) arr.push(await resolveVideoImageInput(firstFrame, 'first_frame.jpg', isSeedance))
        if (lastFrame) arr.push(await resolveVideoImageInput(lastFrame, 'last_frame.jpg', isSeedance))
        imagesParam = arr.length > 0 ? arr : undefined
      } else {
        const [imgs, vids, auds] = await Promise.all([
          multimodalImages.length > 0
            ? Promise.all(multimodalImages.map((img, i) => resolveVideoImageInput(img, `ref_image_${i}.jpg`, true)))
            : Promise.resolve(undefined),
          multimodalVideos.length > 0
            ? Promise.all(multimodalVideos.map((v) => uploadToVideoTemp(v.file, v.name)))
            : Promise.resolve(undefined),
          multimodalAudios.length > 0
            ? Promise.all(multimodalAudios.map((a) => uploadToVideoTemp(a.file, a.name)))
            : Promise.resolve(undefined),
        ])
        referenceImagesParam = imgs ?? undefined
        referenceVideosParam = vids ?? undefined
        referenceVideoDurationsParam = multimodalVideos.length > 0
          ? multimodalVideos.map((video) => video.duration).filter((duration) => Number.isFinite(duration) && duration > 0)
          : undefined
        referenceAudiosParam = auds ?? undefined
      }

      const resolvedPrompt = resolveMentionPrompt(videoPrompt, mentionResources)
      const batch = await generateVideo({
        prompt: resolvedPrompt.trim(),
        workspace_id: activeWorkspaceId ?? '',
        model: videoModel,
        video_category: videoMode,
        images: imagesParam,
        reference_images: referenceImagesParam,
        reference_videos: referenceVideosParam,
        reference_video_durations: referenceVideoDurationsParam,
        reference_audios: referenceAudiosParam,
        aspect_ratio: videoAspectRatio || undefined,
        resolution: videoResolution || undefined,
        ...(isSeedance ? {
          duration: videoDuration,
          generate_audio: videoGenerateAudio,
          ...(videoMode !== 'frames' ? { camera_fixed: videoCameraFixed } : {}),
          watermark,
        } : {}),
      })
      if (batch) onBatchCreated(batch)
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
      void reportClientSubmissionError({
        error_code: classifyRequestError(err),
        detail: rawMessage.slice(0, 500) || undefined,
        http_status: err instanceof ApiError ? err.status : null,
        model: videoModel,
      })
      toast.error(getRequestErrorMessage(err, '视频生成请求失败，请稍后重试'))
    } finally {
      setIsVideoUploading(false)
    }
  }

  const handleSaveDefaults = () => {
    const d = { videoModel, videoAspectRatio, videoResolution, videoDuration, videoGenerateAudio, videoCameraFixed }
    saveDefaults({ image: userDefaults ?? undefined, video: d, avatar: avatarDefaults ?? undefined })
    toast.success('已保存为默认参数')
  }

  const switchMode = (mode: VideoMode) => {
    if (mode === videoMode) return
    setVideoMode(mode)
  }

  const modeBtnCls = (active: boolean) => cn(
    'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
    active ? 'nav-item-active text-primary-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground hover:bg-muted/80'
  )

  /** 拖拽覆盖层状态 */
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [])

  /** 统一拖拽放下处理（根据当前模式分发） */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (videoMode === 'frames') {
      await handleFrameDrop(e)
    } else {
      await handleMultimodalDrop(e)
    }
  }, [videoMode, handleFrameDrop, handleMultimodalDrop])

  /** 统一删除处理（根据当前模式分发） */
  const handleRemoveItem = useCallback((id: string) => {
    if (videoMode === 'frames') {
      handleFrameRemoveItem(id)
    } else {
      handleMultimodalRemoveItem(id)
    }
  }, [videoMode, handleFrameRemoveItem, handleMultimodalRemoveItem])

  /** 统一上传按钮点击（根据当前模式分发） */
  const handleAddClick = useCallback(() => {
    if (videoMode === 'frames') {
      frameInputRef.current?.click()
    } else {
      allInputRef.current?.click()
    }
  }, [videoMode])

  /** 判断是否还能添加素材 */
  const canAddMore = videoMode === 'frames'
    ? !(firstFrame && lastFrame)
    : (multimodalImages.length + multimodalVideos.length + multimodalAudios.length <
        (multimodalReferenceLimits.image + multimodalReferenceLimits.video + multimodalReferenceLimits.audio))

  return (
    <>
      <div
        className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-2 relative transition-colors"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none rounded-b-xl rounded-tr-xl">
            <ImagePlus className="h-10 w-10 text-primary" />
            <span className="text-sm font-medium text-primary">松开以添加素材</span>
          </div>
        )}
        <div className={cn('flex flex-col flex-1 min-h-0 gap-2', isDragging && 'opacity-30 pointer-events-none')}>
          {/* 模型选择器行 */}
          <ModelSelectorRow
            models={videoModels}
            videoModel={videoModel}
            isDisabled={isVideoGenerating || isVideoUploading || !!disabled}
            onModelChange={setVideoModel}
            onSaveDefaults={handleSaveDefaults}
          />
          <div className="flex gap-2 shrink-0">
            {availableVideoModes.map((mode) => (
              <button key={mode} onClick={() => switchMode(mode)} className={modeBtnCls(videoMode === mode)}>
                {currentCategoryReferences[mode]?.label ?? mode}
              </button>
            ))}
          </div>

          {/* 沉浸式编辑器（缩略图网格 + 文本输入） */}
          <ImmersiveEditor
            gridItems={gridItems}
            showAddButton={canAddMore}
            onAddClick={handleAddClick}
            addButtonDisabled={isVideoGenerating || isVideoUploading || disabled}
            onRemoveItem={handleRemoveItem}
            gridEmptyText={videoMode === 'frames' ? '点击或拖拽上传首帧图/尾帧图' : '点击或拖拽上传素材（图片 / 视频 / 音频）'}
            gridEmptyIcon={ImagePlus}
            onGridEmptyClick={handleAddClick}
            editorValue={videoPrompt}
            editorOnChange={setVideoPrompt}
            editorResources={mentionResources}
            editorPlaceholder="描述你想要生成的视频内容..."
            editorDisabled={isVideoGenerating || isVideoUploading || disabled}
            editorMentionClassName={(kind) => {
              const base = 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] align-baseline'
              if (kind === 'video') return `${base} border-accent-purple/35 bg-accent-purple/12 text-accent-purple shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_12px_rgba(200,155,236,0.12)]`
              if (kind === 'audio') return `${base} border-accent-blue/35 bg-accent-blue/12 text-accent-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_12px_rgba(107,163,245,0.12)]`
              return `${base} border-primary/35 bg-primary/12 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_12px_rgba(200,156,236,0.12)]`
            }}
            editorMentionIcon={(kind) => {
              if (kind === 'video') return Film
              if (kind === 'audio') return Music
              return ImageIcon
            }}
            editorEmptyText="暂无可引用资源"
          />
        </div>
      </div>

      {/* frames 模式专用文件 input */}
      <input
        ref={frameInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFrameFileSelect(e.target.files)}
      />

      {/* multimodal 模式统一文件 input */}
      <input
        ref={allInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/x-m4a"
        multiple
        className="hidden"
        onChange={(e) => handleAllFiles(e.target.files)}
      />

      <VideoParamsPanel
        models={videoModels}
        videoMode={videoMode}
        videoModel={videoModel}
        videoAspectRatio={videoAspectRatio}
        videoResolution={videoResolution}
        videoDuration={videoDuration}
        referenceVideoDurations={multimodalVideos.map((video) => video.duration)}
        videoGenerateAudio={videoGenerateAudio}
        videoCameraFixed={videoCameraFixed}
        isSeedance={isSeedance}
        isGenerating={isVideoGenerating}
        isUploading={isVideoUploading}
        disabled={disabled}
        promptEmpty={!videoPrompt.trim()}
        onAspectRatioChange={setVideoAspectRatio}
        onResolutionChange={setVideoResolution}
        onDurationChange={setVideoDuration}
        onGenerateAudioChange={setVideoGenerateAudio}
        onCameraFixedChange={setVideoCameraFixed}
        onGenerate={handleVideoGenerate}
      />
    </>
  )
}

/** 模型选择器行 — 占满宽度，ProviderIcon 供应商图标 + 设为默认在上方 */
function ModelSelectorRow({
  models,
  videoModel,
  isDisabled,
  onModelChange,
  onSaveDefaults,
}: {
  models?: ModelItem[]
  videoModel: string
  isDisabled: boolean
  onModelChange: (v: string) => void
  onSaveDefaults: () => void
}) {
  const [open, setOpen] = useState(false)
  const currentModel = models?.find((m) => m.code === videoModel)

  return (
    <div className="shrink-0">
      {/* 设为默认 — 模型框上方左对齐 */}
      <div className="flex items-center justify-between mb-1">
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-0.5"
          disabled={isDisabled}
          onClick={onSaveDefaults}
        >
          设为默认
        </button>
      </div>

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border px-3 py-2 transition-colors text-left',
              open
                ? 'border-primary/40 bg-primary/5'
                : 'border-border/60 bg-background hover:border-primary/30',
            )}
            disabled={isDisabled}
          >
            {/* 供应商图标 */}
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50 shrink-0">
              <ModelBrandIcon modelCode={currentModel?.code ?? videoModel} providerCode={currentModel?.provider_code} size={40} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{currentModel?.name ?? videoModel}</div>
              {currentModel?.description && (
                <div className="text-[11px] text-muted-foreground truncate">{currentModel.description}</div>
              )}
            </div>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className="z-[120] max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-xl border border-border/80 bg-popover p-1.5 shadow-xl shadow-foreground/5 animate-in fade-in-0 zoom-in-95"
          >
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">选择模型</div>
            {(models ?? []).map((m) => {
              const isActive = m.code === videoModel
              return (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => { onModelChange(m.code); setOpen(false) }}
                  disabled={isDisabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-popover-foreground hover:bg-muted',
                    isDisabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/50 shrink-0">
                    <ModelBrandIcon modelCode={m.code} providerCode={m.provider_code} size={32} />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.name}</span>
                    {m.description && (
                      <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                        {m.description}
                      </span>
                    )}
                  </span>
                  {isActive && <Check className="h-3 w-3 shrink-0" />}
                </button>
              )
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
