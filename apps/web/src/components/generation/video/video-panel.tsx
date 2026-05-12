'use client'

import { useState, useCallback, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useVideoGenerate } from '@/hooks/use-video-generate'
import { useGenerationDefaults } from '@/hooks/use-generation-defaults'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fetchWithAuth, ApiError, getRequestErrorMessage, reportClientSubmissionError, classifyRequestError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { VideoParams } from '@/stores/generation-store'
import { VideoFramesZone } from './video-frames-zone'
import { VideoComponentsZone } from './video-components-zone'
import { VideoMultimodalZone } from './video-multimodal-zone'
import type { MultimodalVideo, MultimodalAudio } from './video-multimodal-zone'
import { VideoParams as VideoParamsPanel } from './video-params'
import type { FrameImage } from '../shared/types'
import { readFrameFile, isValidImageFile, fetchAssetFile, getDraggedAsset } from '../shared/file-utils'
import { useModels } from '@/hooks/use-models'

type VideoMode = 'frames' | 'components' | 'multimodal'

interface VideoPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
  initialParams?: VideoParams | null
}

export function VideoPanel({ onBatchCreated, disabled, initialParams }: VideoPanelProps) {
  const { watermark, videoDefaults, avatarDefaults, userDefaults } = useGenerationStore()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { save: saveDefaults } = useGenerationDefaults()
  const { generate: generateVideo, isGenerating: isVideoGenerating } = useVideoGenerate()
  const { models: videoModels, isReady: videoModelsReady } = useModels('video', activeWorkspaceId)

  // 视频模式与参数
  const [videoMode, setVideoMode] = useState<VideoMode>((initialParams?.videoMode as VideoMode) ?? 'multimodal')
  const [videoModel, setVideoModel] = useState(initialParams?.videoModel ?? 'seedance-2.0')

  // 模型列表加载完成后，若当前选中的模型不在可用列表中，自动切换到第一个可用模型
  useEffect(() => {
    if (!videoModelsReady || videoModels.length === 0) return
    const isValid = videoModels.some((m) => m.code === videoModel)
    if (!isValid) setVideoModel(videoModels[0].code)
  }, [videoModelsReady, videoModels, videoModel])
  const [videoAspectRatio, setVideoAspectRatio] = useState(initialParams?.videoAspectRatio ?? 'adaptive')
  const [videoUpsample, setVideoUpsample] = useState(initialParams?.videoUpsample ?? false)
  const [videoDuration, setVideoDuration] = useState(initialParams?.videoDuration ?? -1)
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(initialParams?.videoGenerateAudio ?? true)
  const [videoCameraFixed, setVideoCameraFixed] = useState(initialParams?.videoCameraFixed ?? false)
  const [videoPrompt, setVideoPrompt] = useState(initialParams?.videoPrompt ?? '')
  const [isVideoUploading, setIsVideoUploading] = useState(false)

  // 首尾帧
  const [firstFrame, setFirstFrame] = useState<FrameImage | null>(null)
  const [lastFrame, setLastFrame] = useState<FrameImage | null>(null)
  const [framePreviewIndex, setFramePreviewIndex] = useState<0 | 1 | null>(null)

  // 参考生视频（components）
  const [componentImages, setComponentImages] = useState<FrameImage[]>([])
  const [componentPreviewIndex, setComponentPreviewIndex] = useState<number | null>(null)

  // 全能参考（multimodal）
  const [multimodalImages, setMultimodalImages] = useState<FrameImage[]>([])
  const [multimodalVideos, setMultimodalVideos] = useState<MultimodalVideo[]>([])
  const [multimodalAudios, setMultimodalAudios] = useState<MultimodalAudio[]>([])

  const isSeedance = videoModel.startsWith('seedance-')
  const isSeedance2 = videoModel === 'seedance-2.0' || videoModel === 'seedance-2.0-fast'

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
    setIsVideoUploading(true)
    try {
      let imagesParam: string[] | undefined
      let referenceImagesParam: string[] | undefined
      let referenceVideosParam: string[] | undefined
      let referenceAudiosParam: string[] | undefined

      if (videoMode === 'frames') {
        const arr: string[] = []
        if (firstFrame) arr.push(await resolveVideoImageInput(firstFrame, 'first_frame.jpg', isSeedance))
        if (lastFrame) arr.push(await resolveVideoImageInput(lastFrame, 'last_frame.jpg', isSeedance))
        imagesParam = arr.length > 0 ? arr : undefined
      } else if (videoMode === 'multimodal') {
        // 三组并行上传
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
        referenceAudiosParam = auds ?? undefined
      } else {
        // components mode
        if (isSeedance2) {
          if (componentImages.length > 0) {
            referenceImagesParam = await Promise.all(
              componentImages.map((img, i) => resolveVideoImageInput(img, `ref_image_${i}.jpg`, true))
            )
          }
        } else {
          imagesParam = componentImages.length > 0
            ? await Promise.all(componentImages.map((img, i) => resolveVideoImageInput(img, `ref_image_${i}.jpg`, false)))
            : undefined
        }
      }

      const batch = await generateVideo({
        prompt: videoPrompt.trim(),
        workspace_id: activeWorkspaceId ?? '',
        model: videoModel,
        images: imagesParam,
        reference_images: referenceImagesParam,
        reference_videos: referenceVideosParam,
        reference_audios: referenceAudiosParam,
        aspect_ratio: videoAspectRatio || undefined,
        ...(isSeedance ? {
          duration: videoDuration,
          generate_audio: videoGenerateAudio,
          ...(videoMode !== 'frames' ? { camera_fixed: videoCameraFixed } : {}),
          watermark,
        } : {
          enable_upsample: videoUpsample,
        }),
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
    const d = { videoModel, videoAspectRatio, videoUpsample, videoDuration, videoGenerateAudio, videoCameraFixed }
    saveDefaults({ image: userDefaults ?? undefined, video: d, avatar: avatarDefaults ?? undefined })
    toast.success('已保存为默认参数')
  }

  const switchMode = (mode: VideoMode) => {
    setVideoMode(mode)
    if (mode === 'multimodal' && !['seedance-2.0', 'seedance-2.0-fast'].includes(videoModel)) setVideoModel('seedance-2.0')
    if (mode === 'frames') { setComponentImages([]); if (!['veo3.1-fast', 'seedance-1.5-pro', 'seedance-2.0', 'seedance-2.0-fast'].includes(videoModel)) setVideoModel('veo3.1-fast') }
    if (mode === 'components') { setFirstFrame(null); setLastFrame(null); if (!['veo3.1-components', 'seedance-2.0', 'seedance-2.0-fast'].includes(videoModel)) setVideoModel('veo3.1-components') }
  }

  const modeBtnCls = (active: boolean) => cn(
    'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
  )

  const isComponentsDisabled = videoMode === 'components' && componentImages.length === 0

  return (
    <>
      <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-2">
        {/* 子模式切换 */}
        <div className="flex gap-2 shrink-0">
          <button onClick={() => switchMode('multimodal')} className={modeBtnCls(videoMode === 'multimodal')}>全能参考</button>
          <button onClick={() => switchMode('frames')} className={modeBtnCls(videoMode === 'frames')}>首尾帧</button>
          <button onClick={() => switchMode('components')} className={modeBtnCls(videoMode === 'components')}>参考生视频</button>
        </div>

        {/* 素材上传区 */}
        {videoMode === 'frames' && (
          <VideoFramesZone
            firstFrame={firstFrame} lastFrame={lastFrame} framePreviewIndex={framePreviewIndex}
            onFirstFrameChange={setFirstFrame} onLastFrameChange={setLastFrame}
            onPreviewIndexChange={setFramePreviewIndex}
            onFrameDrop={handleFrameDrop} onFileRead={readFrameFile}
          />
        )}
        {videoMode === 'multimodal' && (
          <VideoMultimodalZone
            images={multimodalImages} videos={multimodalVideos} audios={multimodalAudios}
            isSeedance={isSeedance}
            onImagesChange={setMultimodalImages} onVideosChange={setMultimodalVideos} onAudiosChange={setMultimodalAudios}
          />
        )}
        {videoMode === 'components' && (
          <VideoComponentsZone
            referenceImages={componentImages} previewIndex={componentPreviewIndex}
            onImagesChange={setComponentImages} onPreviewIndexChange={setComponentPreviewIndex}
          />
        )}

        {/* 提示词 */}
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
        modelsReady={videoModelsReady}
        videoMode={videoMode} videoModel={videoModel} videoAspectRatio={videoAspectRatio}
        videoUpsample={videoUpsample} videoDuration={videoDuration}
        videoGenerateAudio={videoGenerateAudio} videoCameraFixed={videoCameraFixed}
        isSeedance={isSeedance} isGenerating={isVideoGenerating} isUploading={isVideoUploading}
        disabled={disabled || isComponentsDisabled}
        onModelChange={setVideoModel} onAspectRatioChange={setVideoAspectRatio}
        onUpsampleChange={setVideoUpsample} onDurationChange={setVideoDuration}
        onGenerateAudioChange={setVideoGenerateAudio} onCameraFixedChange={setVideoCameraFixed}
        onGenerate={handleVideoGenerate} onSaveDefaults={handleSaveDefaults}
      />
    </>
  )
}
