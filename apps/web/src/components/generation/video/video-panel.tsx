'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useVideoGenerate } from '@/hooks/use-video-generate'
import { useConfirm } from '@/hooks/use-confirm'
import { useGenerationDefaults } from '@/hooks/use-generation-defaults'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  getVideoCategoryKeys,
  parseCategoryReferences,
  validateCategoryReferenceLimits,
  calculateReferenceVideoDurationSeconds,
  type VideoCategory,
  type VideoReferenceCounts,
} from '@aigc/types'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import { fetchWithAuth, ApiError, getRequestErrorMessage, reportClientSubmissionError, classifyRequestError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { VideoParams } from '@/stores/generation-store'
import { VideoFramesZone } from './video-frames-zone'
import { VideoMultimodalZone } from './video-multimodal-zone'
import type { MultimodalVideo, MultimodalAudio } from './video-multimodal-zone'
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
  const [framePreviewIndex, setFramePreviewIndex] = useState<0 | 1 | null>(null)

  const [multimodalImages, setMultimodalImages] = useState<FrameImage[]>(() => referenceImagesToFrameImages(initialParams?.videoReferenceImages))
  const [multimodalVideos, setMultimodalVideos] = useState<MultimodalVideo[]>([])
  const [multimodalAudios, setMultimodalAudios] = useState<MultimodalAudio[]>([])

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

      const batch = await generateVideo({
        prompt: videoPrompt.trim(),
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

  return (
    <>
      <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-2">
        <div className="flex gap-2 shrink-0">
          {availableVideoModes.map((mode) => (
            <button key={mode} onClick={() => switchMode(mode)} className={modeBtnCls(videoMode === mode)}>
              {currentCategoryReferences[mode]?.label ?? mode}
            </button>
          ))}
        </div>

        {videoMode === 'frames' && (
          <VideoFramesZone
            firstFrame={firstFrame}
            lastFrame={lastFrame}
            framePreviewIndex={framePreviewIndex}
            onFirstFrameChange={setFirstFrame}
            onLastFrameChange={setLastFrame}
            onPreviewIndexChange={setFramePreviewIndex}
            onFrameDrop={handleFrameDrop}
            onFileRead={readFrameFile}
          />
        )}
        {videoMode === 'multimodal' && currentCategoryReferences.multimodal && (
          <VideoMultimodalZone
            images={multimodalImages}
            videos={multimodalVideos}
            audios={multimodalAudios}
            isSeedance={isSeedance}
            referenceLimits={multimodalReferenceLimits}
            onImagesChange={setMultimodalImages}
            onVideosChange={setMultimodalVideos}
            onAudiosChange={setMultimodalAudios}
          />
        )}

        <div className="flex-1 min-h-0">
          <Textarea
            placeholder="描述你想要生成的视频内容..."
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            className="h-full resize-none"
            disabled={isVideoGenerating || disabled}
          />
        </div>
      </div>

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
        onModelChange={setVideoModel}
        onAspectRatioChange={setVideoAspectRatio}
        onResolutionChange={setVideoResolution}
        onDurationChange={setVideoDuration}
        onGenerateAudioChange={setVideoGenerateAudio}
        onCameraFixedChange={setVideoCameraFixed}
        onGenerate={handleVideoGenerate}
        onSaveDefaults={handleSaveDefaults}
      />
    </>
  )
}
