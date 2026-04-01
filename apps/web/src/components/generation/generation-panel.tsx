'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGenerationStore } from '@/stores/generation-store'
import { useGenerate } from '@/hooks/use-generate'
import { useVideoGenerate } from '@/hooks/use-video-generate'
import { useTeamFeatures } from '@/hooks/use-team-features'
import { useAuthStore } from '@/stores/auth-store'
import { Sparkles, Loader2, Coins, Image as ImageIcon, Video, Zap, Target, ImagePlus, Trash2, Search, Film, X, UserSquare2, Music, Clapperboard, Play } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { ReferenceImageUploadCompact } from './reference-image-upload-compact'
import { CompanyAImagePicker } from './company-a-image-picker'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { cn } from '@/lib/utils'
import Image from 'next/image'

const MODEL_CREDITS: Record<'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0', number> = {
  gemini: 5,
  'nano-banana-pro': 10,
  'seedream-5.0-lite': 5,
  'seedream-4.5': 5,
  'seedream-4.0': 5,
}

const MAX_REF_IMAGES = 10
const MAX_FILE_MB = 20

type ModelResolution = '1k' | '2k' | '3k' | '4k'

const MODEL_OPTIONS: Array<{
  value: 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
  label: string
  icon: React.ElementType
  desc: string
  credits: number
  resolutions: ModelResolution[]
  supportsWatermark: boolean
}> = [
  {
    value: 'gemini',
    label: '全能图片2',
    icon: Zap,
    desc: '快速生成，适合日常使用',
    credits: 5,
    resolutions: ['1k', '2k', '4k'],
    supportsWatermark: false,
  },
  {
    value: 'nano-banana-pro',
    label: '全能图片Pro',
    icon: Target,
    desc: '高质量输出，细节丰富',
    credits: 10,
    resolutions: ['1k', '2k', '4k'],
    supportsWatermark: false,
  },
  {
    value: 'seedream-5.0-lite',
    label: 'Seedream 5.0',
    icon: Sparkles,
    desc: '最新火山引擎模型，联网搜索增强',
    credits: 5,
    resolutions: ['2k', '3k'],
    supportsWatermark: true,
  },
  {
    value: 'seedream-4.5',
    label: 'Seedream 4.5',
    icon: Sparkles,
    desc: '高分辨率图像生成',
    credits: 5,
    resolutions: ['2k', '4k'],
    supportsWatermark: true,
  },
  {
    value: 'seedream-4.0',
    label: 'Seedream 4.0',
    icon: Sparkles,
    desc: '多分辨率图像生成',
    credits: 5,
    resolutions: ['1k', '2k', '4k'],
    supportsWatermark: true,
  },
]

const ALL_RESOLUTION_OPTIONS: Array<{ value: ModelResolution; label: string }> = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '3k', label: '3K' },
  { value: '4k', label: '4K' },
]

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const

const QUANTITY_OPTIONS = [1, 2, 3, 4] as const

const VIDEO_MODEL_OPTIONS = {
  frames: [
    { value: 'veo3.1-fast', label: '全能视频3.1 Fast', desc: '快速高质量视频生成', credits: 10, isSeedance: false },
    { value: 'seedance-1.5-pro', label: 'Seedance 1.5 Pro', desc: '有声视频生成，支持首尾帧', credits: 100, isSeedance: true },
  ],
  components: [
    { value: 'veo3.1-components', label: '全能视频3.1', desc: '基于参考图片生成视频', credits: 15, isSeedance: false },
  ],
} as const

const VIDEO_ASPECT_RATIOS_DEFAULT = [
  { value: '', label: '自动' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
]

const VIDEO_ASPECT_RATIOS_SEEDANCE = [
  { value: 'adaptive', label: '自适应' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9' },
]

const VIDEO_RESOLUTIONS = [
  { value: false, label: '720p', desc: '标准' },
  { value: true, label: '1080p', desc: '高清' },
] as const

const SEEDANCE_DURATION_OPTIONS = [
  { value: 4, label: '4s' },
  { value: 5, label: '5s' },
  { value: 6, label: '6s' },
  { value: 8, label: '8s' },
  { value: 10, label: '10s' },
  { value: 12, label: '12s' },
  { value: -1, label: '自动' },
] as const

interface FrameImage {
  id?: string
  previewUrl: string
  dataUrl: string
}

interface GenerationPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
  initialMode?: 'image' | 'video' | 'avatar' | 'action_imitation'
}

export function GenerationPanel({ onBatchCreated, disabled, initialMode = 'image' }: GenerationPanelProps) {
  const [mode, setMode] = useState<'image' | 'video' | 'avatar' | 'action_imitation'>(initialMode)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [companyAPickerOpen, setCompanyAPickerOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Video mode state
  const [videoMode, setVideoMode] = useState<'frames' | 'components'>('frames')
  const [videoPrompt, setVideoPrompt] = useState('')
  const [videoModel, setVideoModel] = useState('veo3.1-fast')
  const [videoAspectRatio, setVideoAspectRatio] = useState('')
  const [videoUpsample, setVideoUpsample] = useState(false)
  const [videoDuration, setVideoDuration] = useState<number>(5)
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(true)
  const [videoCameraFixed, setVideoCameraFixed] = useState(false)
  const [firstFrame, setFirstFrame] = useState<FrameImage | null>(null)
  const [lastFrame, setLastFrame] = useState<FrameImage | null>(null)
  const [framePreviewIndex, setFramePreviewIndex] = useState<0 | 1 | null>(null)
  const firstFrameRef = useRef<HTMLInputElement>(null)
  const lastFrameRef = useRef<HTMLInputElement>(null)

  // Reference components mode state
  const [videoReferenceImages, setVideoReferenceImages] = useState<FrameImage[]>([])
  const [referencePreviewIndex, setReferencePreviewIndex] = useState<number | null>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const [isReferenceDragging, setIsReferenceDragging] = useState(false)
  const referenceDragCounterRef = useRef(0)

  // Avatar (数字人) mode state
  const [avatarImage, setAvatarImage] = useState<FrameImage | null>(null)
  const [avatarAudio, setAvatarAudio] = useState<{ id: string; name: string; dataUrl: string; duration: number } | null>(null)
  const [avatarPrompt, setAvatarPrompt] = useState('')
  const [avatarResolution, setAvatarResolution] = useState<'720p' | '1080p'>('720p')
  const [isAvatarGenerating, setIsAvatarGenerating] = useState(false)
  const avatarImageRef = useRef<HTMLInputElement>(null)
  const avatarAudioRef = useRef<HTMLInputElement>(null)

  // Action Imitation (动作模仿) mode state
  const [actionImage, setActionImage] = useState<FrameImage | null>(null)
  const [actionVideo, setActionVideo] = useState<{ file: File; previewUrl: string; duration: number; name: string } | null>(null)
  const [actionVideoPreviewOpen, setActionVideoPreviewOpen] = useState(false)
  const [isActionGenerating, setIsActionGenerating] = useState(false)
  const actionImageRef = useRef<HTMLInputElement>(null)
  const actionVideoRef = useRef<HTMLInputElement>(null)

  const { isCompanyA, showVideoTab, showAvatarTab, showActionImitationTab } = useTeamFeatures()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)

  const {
    prompt,
    setPrompt,
    modelType,
    setModelType,
    resolution,
    setResolution,
    quantity,
    setQuantity,
    aspectRatio,
    setAspectRatio,
    referenceImages,
    addReferenceImage,
    watermark,
    setWatermark,
    isGenerating,
    videoParams
  } = useGenerationStore()

  const clearReferenceImages = useGenerationStore((s) => s.clearReferenceImages)
  const pendingModule = useGenerationStore((s) => s.pendingModule)
  const clearPendingModule = useGenerationStore((s) => s.clearPendingModule)

  // Switch to the right tab when applyBatch is called (from history / assets)
  useEffect(() => {
    if (!pendingModule) return
    if (pendingModule === 'video') {
      if (videoParams) {
        setVideoPrompt(videoParams.videoPrompt)
        setVideoModel(videoParams.videoModel)
        setVideoAspectRatio(videoParams.videoAspectRatio)
        setVideoUpsample(videoParams.videoUpsample)
      }
      setMode('video')
    } else if (pendingModule === 'avatar') {
      setMode('avatar')
    } else if (pendingModule === 'action_imitation') {
      setMode('action_imitation')
    } else {
      setMode('image')
    }
    clearPendingModule()
  }, [pendingModule]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset resolution if the selected model doesn't support the current resolution
  useEffect(() => {
    const model = MODEL_OPTIONS.find(m => m.value === modelType)
    if (model && !model.resolutions.includes(resolution as ModelResolution)) {
      setResolution(model.resolutions[0])
    }
  }, [modelType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset video aspect ratio when switching between Seedance and non-Seedance
  useEffect(() => {
    const isSeedance = videoModel === 'seedance-1.5-pro'
    if (isSeedance && !VIDEO_ASPECT_RATIOS_SEEDANCE.find(r => r.value === videoAspectRatio)) {
      setVideoAspectRatio('adaptive')
    } else if (!isSeedance && !VIDEO_ASPECT_RATIOS_DEFAULT.find(r => r.value === videoAspectRatio)) {
      setVideoAspectRatio('')
    }
  }, [videoModel]) // eslint-disable-line react-hooks/exhaustive-deps

  // Process dropped / selected image files
  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (referenceImages.length >= MAX_REF_IMAGES) break
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_FILE_MB * 1024 * 1024) continue
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      addReferenceImage({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        dataUrl,
      })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [referenceImages.length, addReferenceImage])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    await handleImageFiles(e.dataTransfer.files)
  }, [handleImageFiles])

  const estimatedCredits = (MODEL_CREDITS[modelType] ?? 5) * quantity

  // Handle Company A image selection — fetch as blob so it integrates with existing upload flow
  const handleSelectCompanyAImage = useCallback(async (url: string, name: string) => {
    if (referenceImages.length >= MAX_REF_IMAGES) {
      toast.error(`最多添加 ${MAX_REF_IMAGES} 张参考图`)
      return
    }
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error('fetch failed')
      const blob = await resp.blob()
      const ext = blob.type.split('/')[1] || 'jpg'
      const file = new File([blob], `${name}.${ext}`, { type: blob.type })
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      addReferenceImage({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(blob),
        dataUrl,
      })
    } catch {
      toast.error('图片加载失败，请确认网络可访问图片服务器')
    }
  }, [referenceImages.length, addReferenceImage])
  const { generate } = useGenerate()
  const { generate: generateVideo, isGenerating: isVideoGenerating } = useVideoGenerate()

  const handleAvatarGenerate = async () => {
    if (!avatarImage || !avatarAudio) return
    setIsAvatarGenerating(true)
    try {
      const token = useAuthStore.getState().accessToken ?? ''

      // Upload image
      const imageFormData = new FormData()
      const imageBlob = await fetch(avatarImage.dataUrl).then(r => r.blob())
      imageFormData.append('file', imageBlob, `avatar-image.${imageBlob.type.split('/')[1] || 'jpg'}`)
      const imageUploadRes = await fetch('/api/v1/avatar/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: imageFormData,
      })
      if (!imageUploadRes.ok) throw new ApiError(imageUploadRes.status, 'UPLOAD_ERROR', '图片上传失败')
      const imageUpload = (await imageUploadRes.json()) as { url: string }

      // Upload audio
      const audioFormData = new FormData()
      const audioBlob = await fetch(avatarAudio.dataUrl).then(r => r.blob())
      audioFormData.append('file', audioBlob, avatarAudio.name)
      const audioUploadRes = await fetch('/api/v1/avatar/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: audioFormData,
      })
      if (!audioUploadRes.ok) throw new ApiError(audioUploadRes.status, 'UPLOAD_ERROR', '音频上传失败')
      const audioUpload = (await audioUploadRes.json()) as { url: string }

      // Submit generation
      const res = await fetch('/api/v1/avatar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          workspace_id: activeWorkspaceId,
          image_url: imageUpload.url,
          audio_url: audioUpload.url,
          audio_duration: avatarAudio.duration,
          prompt: avatarPrompt.trim() || undefined,
          resolution: avatarResolution,
        }),
      })
      const batch = await res.json()
      if (!res.ok) {
        throw new ApiError(res.status, batch?.error?.code ?? 'AVATAR_ERROR', batch?.error?.message ?? '数字人生成失败')
      }
      onBatchCreated(batch)
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      } else {
        toast.error('数字人生成请求失败，请稍后重试')
      }
    } finally {
      setIsAvatarGenerating(false)
    }
  }

  const handleActionImitationGenerate = async () => {
    if (!actionImage || !actionVideo) return
    setIsActionGenerating(true)
    try {
      const token = useAuthStore.getState().accessToken ?? ''

      // Upload video
      const videoFormData = new FormData()
      videoFormData.append('file', actionVideo.file, actionVideo.name)
      const videoUploadRes = await fetch('/api/v1/action-imitation/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: videoFormData,
      })
      if (!videoUploadRes.ok) throw new ApiError(videoUploadRes.status, 'UPLOAD_ERROR', '视频上传失败')
      const videoUpload = (await videoUploadRes.json()) as { url: string }

      // Extract base64 from dataUrl
      const [header, imageBase64] = actionImage.dataUrl.split(',')
      const imageMime = header.replace('data:', '').replace(';base64', '') || 'image/jpeg'

      // Submit generation
      const res = await fetch('/api/v1/action-imitation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          workspace_id: activeWorkspaceId,
          image_base64: imageBase64,
          image_mime: imageMime,
          video_url: videoUpload.url,
          video_duration: actionVideo.duration,
        }),
      })
      const batch = await res.json()
      if (!res.ok) {
        throw new ApiError(res.status, batch?.error?.code ?? 'ACTION_IMITATION_ERROR', batch?.error?.message ?? '动作模仿生成失败')
      }
      onBatchCreated(batch)
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      } else {
        toast.error('动作模仿生成请求失败，请稍后重试')
      }
    } finally {
      setIsActionGenerating(false)
    }
  }

  const handleGenerate = async () => {
    try {
      const batch = await generate()
      if (batch) {
        onBatchCreated(batch)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      } else {
        toast.error('生成请求失败，请稍后重试')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating && !disabled) {
      handleGenerate()
    }
  }

  const readFrameFile = useCallback(async (file: File): Promise<FrameImage | null> => {
    if (!file.type.startsWith('image/')) return null
    if (file.size > MAX_FILE_MB * 1024 * 1024) return null
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve({
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        dataUrl: reader.result as string,
      })
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  }, [])

  // Handle reference images for components mode
  const handleReferenceFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    const newImages: FrameImage[] = []
    for (const file of Array.from(files)) {
      if (videoReferenceImages.length + newImages.length >= 3) break
      const img = await readFrameFile(file)
      if (img) newImages.push(img)
    }
    setVideoReferenceImages(prev => [...prev, ...newImages])
    if (referenceInputRef.current) referenceInputRef.current.value = ''
  }, [videoReferenceImages.length, readFrameFile])

  const handleReferenceDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    referenceDragCounterRef.current++
    if (referenceDragCounterRef.current === 1) setIsReferenceDragging(true)
  }, [])

  const handleReferenceDragLeave = useCallback(() => {
    referenceDragCounterRef.current--
    if (referenceDragCounterRef.current === 0) setIsReferenceDragging(false)
  }, [])

  const handleReferenceDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleReferenceDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    referenceDragCounterRef.current = 0
    setIsReferenceDragging(false)
    await handleReferenceFiles(e.dataTransfer.files)
  }, [handleReferenceFiles])

  const removeReferenceImage = useCallback((index: number) => {
    setVideoReferenceImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const clearReferenceImagesVideo = useCallback(() => {
    setVideoReferenceImages([])
  }, [])

  const handleVideoGenerate = async () => {
    if (!videoPrompt.trim()) return
    try {
      const images: string[] = []
      if (videoMode === 'frames') {
        if (firstFrame) images.push(firstFrame.dataUrl)
        if (lastFrame) images.push(lastFrame.dataUrl)
      } else {
        images.push(...videoReferenceImages.map(img => img.dataUrl))
      }

      const isSeedance = videoModel === 'seedance-1.5-pro'
      const batch = await generateVideo({
        prompt: videoPrompt.trim(),
        workspace_id: activeWorkspaceId ?? '',
        model: videoModel,
        images: images.length > 0 ? images : undefined,
        aspect_ratio: videoAspectRatio || undefined,
        ...(isSeedance ? {
          resolution: videoUpsample ? '1080p' : '720p',
          duration: videoDuration,
          generate_audio: videoGenerateAudio,
          camera_fixed: videoCameraFixed,
        } : {
          enable_upsample: videoUpsample,
        }),
      })
      if (batch) onBatchCreated(batch)
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      } else {
        toast.error('视频生成请求失败，请稍后重试')
      }
    }
  }

  const currentModel = MODEL_OPTIONS.find(m => m.value === modelType)
  const isSeedanceVideo = videoModel === 'seedance-1.5-pro'
  const availableResolutions = ALL_RESOLUTION_OPTIONS.filter(r =>
    currentModel?.resolutions.includes(r.value) ?? true
  )

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* 提示词区域 + 书签标签 */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* 书签标签 - 公司A只有图片模式，隐藏标签直接全圆角卡片 */}
        {!isCompanyA && (
          <div className="flex items-end">
            <button
              onClick={() => setMode('image')}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-t-lg border-t border-l border-r text-sm font-medium transition-all relative z-10 -mb-px',
                mode === 'image'
                  ? 'bg-card border-border text-foreground'
                  : 'bg-muted/60 border-muted text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              图片
            </button>
            {showVideoTab && (
              <button
                onClick={() => setMode('video')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-t-lg border-t border-l border-r text-sm font-medium transition-all relative -mb-px',
                  mode === 'video'
                    ? 'bg-card border-border text-foreground z-10'
                    : 'bg-muted/60 border-muted text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <Video className="h-3.5 w-3.5" />
                视频
              </button>
            )}
            {showAvatarTab && (
              <button
                onClick={() => setMode('avatar')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-t-lg border-t border-l border-r text-sm font-medium transition-all relative -mb-px',
                  mode === 'avatar'
                    ? 'bg-card border-border text-foreground z-10'
                    : 'bg-muted/60 border-muted text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <UserSquare2 className="h-3.5 w-3.5" />
                数字人
              </button>
            )}
            {showActionImitationTab && (
              <button
                onClick={() => setMode('action_imitation')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-t-lg border-t border-l border-r text-sm font-medium transition-all relative -mb-px',
                  mode === 'action_imitation'
                    ? 'bg-card border-border text-foreground z-10'
                    : 'bg-muted/60 border-muted text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <Clapperboard className="h-3.5 w-3.5" />
                动作模仿
              </button>
            )}
          </div>
        )}

        {/* 提示词卡片 */}
        {mode === 'image' ? (
          <div
            className={cn(
              'border border-border bg-card p-4 flex-1 flex flex-col min-h-0 relative transition-colors',
              isCompanyA ? 'rounded-xl' : 'rounded-b-xl rounded-tr-xl',
              isDragging && 'border-primary bg-primary/5'
            )}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* 拖拽遮罩提示 */}
            {isDragging && (
              <div className={cn(
                'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none',
                isCompanyA ? 'rounded-xl' : 'rounded-b-xl rounded-tr-xl'
              )}>
                <ImagePlus className="h-10 w-10 text-primary" />
                <span className="text-sm font-medium text-primary">松开以添加参考图</span>
              </div>
            )}
            <div className={cn('flex flex-col flex-1 min-h-0 gap-2', isDragging && 'opacity-30 pointer-events-none')}>
              {/* 参考图区域 - 固定高度，保证添加图片前后布局不变 */}
              <div className={cn('shrink-0', isCompanyA ? 'h-[88px]' : 'h-[68px]')}>
                {referenceImages.length > 0 ? (
                  <div
                    onClick={() => setImageDialogOpen(true)}
                    className="cursor-pointer group h-full"
                  >
                    <div className="flex items-center gap-3 h-full">
                      {/* 堆叠图片预览 */}
                      <div className="relative w-16 h-14 shrink-0">
                        {referenceImages.slice(0, 3).map((img, index) => (
                          <div
                            key={img.id}
                            className="absolute rounded-lg border-2 border-background shadow-md overflow-hidden transition-transform group-hover:scale-105"
                            style={{
                              width: '44px',
                              height: '44px',
                              left: `${index * 14}px`,
                              top: `${index * 3}px`,
                              zIndex: 3 - index,
                            }}
                          >
                            <Image
                              src={img.previewUrl}
                              alt=""
                              fill
                              className="object-cover"
                              sizes="44px"
                              unoptimized
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          {referenceImages.length} 张参考图
                        </div>
                        <div className="text-xs text-muted-foreground">
                          点击查看和管理
                        </div>
                      </div>
                      <ImageIcon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                      {isCompanyA && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setCompanyAPickerOpen(true) }}
                          className="h-6 w-6 rounded-md flex items-center justify-center text-blue-500 hover:bg-blue-500/10 transition-colors shrink-0"
                          title="从图库搜索添加"
                        >
                          <Search className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); clearReferenceImages() }}
                        className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                        title="清空全部参考图"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : isCompanyA ? (
                  /* 公司A：全宽上传框 + 右侧居中实体图库按钮 */
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'h-full w-full rounded-xl border-2 border-dashed transition-all cursor-pointer',
                      'border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50',
                      'flex items-center gap-3 px-3'
                    )}
                  >
                    <ImagePlus className="h-6 w-6 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-primary leading-tight">上传参考图</div>
                      <div className="text-[11px] text-primary/60 leading-tight mt-0.5">点击或拖拽 · 最多 {MAX_REF_IMAGES} 张</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setCompanyAPickerOpen(true) }}
                      className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-xs font-medium transition-colors mr-2"
                    >
                      <Search className="h-3.5 w-3.5" />
                      图库搜索
                    </button>
                  </div>
                ) : (
                  /* 无参考图 - 横向全宽，直接触发文件选择 */
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'h-full w-full rounded-xl border-2 border-dashed transition-all cursor-pointer',
                      'border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50',
                      'flex items-center gap-3 px-3'
                    )}
                  >
                    <ImagePlus className="h-6 w-6 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-primary leading-tight">上传参考图</div>
                      <div className="text-[11px] text-primary/60 leading-tight mt-0.5">最多 {MAX_REF_IMAGES} 张 · 支持拖拽</div>
                    </div>
                  </div>
                )}
              </div>

              {/* 提示词输入 - 撑满剩余空间 */}
              <div className="flex-1 min-h-0">
                <Textarea
                  placeholder="描述你想要生成的图片...&#10;&#10;Ctrl+Enter 快速生成"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-full resize-none"
                  disabled={isGenerating || disabled}
                />
              </div>
            </div>
          </div>
        ) : mode === 'video' ? (
          <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-2">
            {/* Video mode switcher */}
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  setVideoMode('frames')
                  if (!VIDEO_MODEL_OPTIONS.frames.find(m => m.value === videoModel)) {
                    setVideoModel('veo3.1-fast')
                  }
                  setVideoReferenceImages([])
                }}
                className={cn(
                  'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
                  videoMode === 'frames'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                )}
              >
                首尾帧
              </button>
              <button
                onClick={() => {
                  setVideoMode('components')
                  setVideoModel('veo3.1-components')
                  setFirstFrame(null)
                  setLastFrame(null)
                }}
                className={cn(
                  'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
                  videoMode === 'components'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                )}
              >
                参考生视频
              </button>
            </div>

            {/* Image upload area - dynamic based on mode */}
            {videoMode === 'frames' ? (
              <div className="flex gap-2 shrink-0">
                {/* First frame */}
                <div className="flex-1 flex flex-col gap-1">
                  <p className="text-[11px] text-muted-foreground leading-none">首帧图（可选）</p>
                  {firstFrame ? (
                    <div
                      className="relative h-[90px] w-full rounded-lg overflow-hidden border bg-muted group cursor-zoom-in"
                      onClick={() => setFramePreviewIndex(0)}
                    >
                      <Image src={firstFrame.previewUrl} alt="" fill className="object-contain" sizes="200px" unoptimized />
                      <button
                        onClick={(e) => { e.stopPropagation(); setFirstFrame(null); setLastFrame(null) }}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      >
                        <X className="h-3 w-3 text-background" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => firstFrameRef.current?.click()}
                      className="h-[90px] w-full rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1"
                    >
                      <Film className="h-4 w-4 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">点击上传</span>
                    </button>
                  )}
                </div>
                {/* Last frame */}
                <div className="flex-1 flex flex-col gap-1">
                  <p className="text-[11px] text-muted-foreground leading-none">尾帧图（可选）</p>
                  {lastFrame ? (
                    <div
                      className="relative h-[90px] w-full rounded-lg overflow-hidden border bg-muted group cursor-zoom-in"
                      onClick={() => setFramePreviewIndex(1)}
                    >
                      <Image src={lastFrame.previewUrl} alt="" fill className="object-contain" sizes="200px" unoptimized />
                      <button
                        onClick={(e) => { e.stopPropagation(); setLastFrame(null) }}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      >
                        <X className="h-3 w-3 text-background" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => lastFrameRef.current?.click()}
                      disabled={!firstFrame}
                      className={cn(
                        'h-[90px] w-full rounded-lg border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1',
                        firstFrame
                          ? 'border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 cursor-pointer'
                          : 'border-muted-foreground/15 opacity-50 cursor-not-allowed'
                      )}
                    >
                      <Film className="h-4 w-4 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">点击上传</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'shrink-0 relative transition-colors',
                  isReferenceDragging && 'opacity-50'
                )}
                onDragEnter={handleReferenceDragEnter}
                onDragLeave={handleReferenceDragLeave}
                onDragOver={handleReferenceDragOver}
                onDrop={handleReferenceDrop}
              >
                {isReferenceDragging && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none rounded-xl border-2 border-primary bg-primary/5">
                    <ImagePlus className="h-8 w-8 text-primary" />
                    <span className="text-sm font-medium text-primary">松开以添加参考图</span>
                  </div>
                )}
                {videoReferenceImages.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground">{videoReferenceImages.length}/3 张参考图</p>
                      <button
                        onClick={clearReferenceImagesVideo}
                        className="text-[11px] text-destructive hover:underline"
                      >
                        清空全部
                      </button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {videoReferenceImages.map((img, index) => (
                        <div
                          key={img.id ?? index}
                          className="relative h-[90px] w-[90px] rounded-lg overflow-hidden border bg-muted group cursor-zoom-in"
                          onClick={() => setReferencePreviewIndex(index)}
                        >
                          <Image src={img.previewUrl} alt="" fill className="object-cover" sizes="90px" unoptimized />
                          <button
                            onClick={(e) => { e.stopPropagation(); removeReferenceImage(index) }}
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          >
                            <X className="h-3 w-3 text-background" />
                          </button>
                        </div>
                      ))}
                      {videoReferenceImages.length < 3 && (
                        <button
                          onClick={() => referenceInputRef.current?.click()}
                          className="h-[90px] w-[90px] rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1"
                        >
                          <ImagePlus className="h-4 w-4 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">添加</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => referenceInputRef.current?.click()}
                    className="h-[90px] w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all cursor-pointer flex items-center gap-3 px-4"
                  >
                    <ImagePlus className="h-6 w-6 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-primary leading-tight">上传参考图片</div>
                      <div className="text-[11px] text-primary/60 leading-tight mt-0.5">1-3张 · 支持拖拽</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Prompt */}
            <div className="flex-1 min-h-0">
              <Textarea
                placeholder="描述你想要生成的视频内容..."
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                className="h-full resize-none"
                disabled={isVideoGenerating || disabled}
              />
            </div>

            {/* Hidden file inputs */}
            <input ref={firstFrameRef} type="file" accept="image/*" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setFirstFrame(await readFrameFile(f))
                e.target.value = ''
              }}
            />
            <input ref={lastFrameRef} type="file" accept="image/*" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setLastFrame(await readFrameFile(f))
                e.target.value = ''
              }}
            />
            <input ref={referenceInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => handleReferenceFiles(e.target.files)}
            />

            {/* Frame image lightbox */}
            {framePreviewIndex !== null && (firstFrame || lastFrame) && (() => {
              const frames = [firstFrame, lastFrame].filter(Boolean) as FrameImage[]
              const labels = firstFrame && lastFrame ? ['首帧图', '尾帧图'] : [firstFrame ? '首帧图' : '尾帧图']
              const activeIdx = framePreviewIndex === 1 && firstFrame ? 1 : 0
              const frame = frames[activeIdx]
              if (!frame) return null
              return (
                <ImageLightbox
                  url={frame.previewUrl}
                  alt={labels[activeIdx]}
                  onClose={() => setFramePreviewIndex(null)}
                  onPrev={activeIdx > 0 ? () => setFramePreviewIndex(0) : undefined}
                  onNext={activeIdx < frames.length - 1 ? () => setFramePreviewIndex(1) : undefined}
                  footer={<p className="text-sm text-white/80">{labels[activeIdx]}</p>}
                />
              )
            })()}

            {/* Reference images lightbox */}
            {referencePreviewIndex !== null && videoReferenceImages[referencePreviewIndex] && (
              <ImageLightbox
                url={videoReferenceImages[referencePreviewIndex].previewUrl}
                alt={`参考图 ${referencePreviewIndex + 1}`}
                onClose={() => setReferencePreviewIndex(null)}
                onPrev={referencePreviewIndex > 0 ? () => setReferencePreviewIndex(referencePreviewIndex - 1) : undefined}
                onNext={referencePreviewIndex < videoReferenceImages.length - 1 ? () => setReferencePreviewIndex(referencePreviewIndex + 1) : undefined}
                footer={<p className="text-sm text-white/80">参考图 {referencePreviewIndex + 1}/{videoReferenceImages.length}</p>}
              />
            )}
          </div>
        ) : mode === 'action_imitation' ? (
          <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-2">
            {/* 人物图片上传 — 占上半 */}
            <div className="flex-1 min-h-0 flex flex-col">
              <p className="text-[11px] text-muted-foreground mb-1 shrink-0">人物图片（必填，≤4.7MB）</p>
              {actionImage ? (
                <div className="flex-1 min-h-0 relative rounded-lg overflow-hidden border bg-muted group">
                  <Image src={actionImage.previewUrl} alt="" fill className="object-contain" sizes="300px" unoptimized />
                  <button
                    onClick={() => setActionImage(null)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X className="h-3 w-3 text-background" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => actionImageRef.current?.click()}
                  className="flex-1 min-h-0 w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all flex flex-col items-center justify-center gap-1"
                >
                  <ImagePlus className="h-5 w-5 text-primary shrink-0" />
                  <div className="text-center">
                    <div className="text-sm font-medium text-primary">上传人物图片</div>
                    <div className="text-[11px] text-primary/60">jpg / png · 最大 4.7MB</div>
                  </div>
                </button>
              )}
            </div>

            {/* 驱动视频上传 — 占下半 */}
            <div className="flex-1 min-h-0 flex flex-col">
              <p className="text-[11px] text-muted-foreground mb-1 shrink-0">驱动视频（必填，≤30秒）</p>
              {actionVideo ? (
                <div
                  className="flex-1 min-h-0 relative rounded-lg overflow-hidden border bg-black group cursor-pointer"
                  onClick={() => setActionVideoPreviewOpen(true)}
                >
                  <video
                    src={actionVideo.previewUrl}
                    className="absolute inset-0 w-full h-full object-contain"
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001 }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                    <Play className="h-8 w-8 text-white drop-shadow" />
                  </div>
                  <div className="absolute bottom-1 left-1 right-7">
                    <span className="text-[10px] bg-black/60 text-white rounded px-1 py-0.5 truncate block">
                      {actionVideo.name} · {actionVideo.duration.toFixed(1)}s
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setActionVideo(null) }}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X className="h-3 w-3 text-background" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => actionVideoRef.current?.click()}
                  className="flex-1 min-h-0 w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all flex flex-col items-center justify-center gap-1"
                >
                  <Clapperboard className="h-4 w-4 text-primary shrink-0" />
                  <div className="text-center">
                    <div className="text-sm font-medium text-primary">上传驱动视频</div>
                    <div className="text-[11px] text-primary/60">mp4 / mov / webm · 最大 30s</div>
                  </div>
                </button>
              )}
            </div>

            {/* 提示 */}
            <p className="text-[11px] text-muted-foreground shrink-0">💡 图片与视频中人物比例越接近，效果越好</p>

            {/* 隐藏文件输入 */}
            <input ref={actionImageRef} type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (f.size > 4.7 * 1024 * 1024) { toast.error('图片不能超过 4.7MB'); return }
                const img = await readFrameFile(f)
                if (img) setActionImage(img)
                e.target.value = ''
              }}
            />
            <input ref={actionVideoRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const url = URL.createObjectURL(f)
                const video = document.createElement('video')
                video.src = url
                video.onloadedmetadata = () => {
                  const dur = video.duration
                  URL.revokeObjectURL(url)
                  if (dur > 30) { toast.error('视频不能超过 30 秒'); return }
                  const previewUrl = URL.createObjectURL(f)
                  setActionVideo({ file: f, previewUrl, duration: dur, name: f.name })
                }
                e.target.value = ''
              }}
            />

            {/* 视频预览对话框 */}
            {actionVideoPreviewOpen && actionVideo && (
              <Dialog open={actionVideoPreviewOpen} onOpenChange={setActionVideoPreviewOpen}>
                <DialogContent className="max-w-2xl p-2">
                  <video src={actionVideo.previewUrl} controls autoPlay className="w-full rounded-lg max-h-[70vh]" />
                </DialogContent>
              </Dialog>
            )}
          </div>
        ) : (
          <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-3">
            {/* 人物图片上传 */}
            <div className="shrink-0">
              <p className="text-[11px] text-muted-foreground mb-1">人物图片（必填，≤5MB）</p>
              {avatarImage ? (
                <div className="relative h-[90px] w-full rounded-lg overflow-hidden border bg-muted group">
                  <Image src={avatarImage.previewUrl} alt="" fill className="object-contain" sizes="300px" unoptimized />
                  <button
                    onClick={() => setAvatarImage(null)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X className="h-3 w-3 text-background" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => avatarImageRef.current?.click()}
                  className="h-[90px] w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all flex items-center gap-3 px-4"
                >
                  <ImagePlus className="h-5 w-5 text-primary shrink-0" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-primary">上传人物图片</div>
                    <div className="text-[11px] text-primary/60">jpg / png / webp · 最大 5MB</div>
                  </div>
                </button>
              )}
            </div>

            {/* 音频上传 */}
            <div className="shrink-0">
              <p className="text-[11px] text-muted-foreground mb-1">驱动音频（必填，≤60秒）</p>
              {avatarAudio ? (
                <div className="flex items-center gap-3 h-10 px-3 rounded-lg border bg-muted">
                  <Music className="h-4 w-4 text-primary shrink-0" />
                  <span className="flex-1 text-sm truncate">{avatarAudio.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{avatarAudio.duration.toFixed(1)}s</span>
                  <button onClick={() => setAvatarAudio(null)} className="h-5 w-5 rounded-full hover:bg-foreground/10 flex items-center justify-center shrink-0">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => avatarAudioRef.current?.click()}
                  className="h-10 w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all flex items-center gap-3 px-4"
                >
                  <Music className="h-4 w-4 text-primary shrink-0" />
                  <div className="text-sm font-medium text-primary">上传音频文件</div>
                  <div className="text-[11px] text-primary/60 ml-1">mp3 / wav / m4a · 最大 60s</div>
                </button>
              )}
            </div>

            {/* 提示词 */}
            <div className="flex-1 min-h-0">
              <Textarea
                placeholder="可选：描述动作、运镜或画面风格..."
                value={avatarPrompt}
                onChange={(e) => setAvatarPrompt(e.target.value)}
                className="h-full resize-none"
                disabled={isAvatarGenerating}
              />
            </div>

            {/* 隐藏文件输入 */}
            <input ref={avatarImageRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (f.size > 5 * 1024 * 1024) { toast.error('图片不能超过 5MB'); return }
                const img = await readFrameFile(f)
                if (img) setAvatarImage(img)
                e.target.value = ''
              }}
            />
            <input ref={avatarAudioRef} type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/x-m4a" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const url = URL.createObjectURL(f)
                const audio = document.createElement('audio')
                audio.src = url
                audio.onloadedmetadata = () => {
                  const dur = audio.duration
                  URL.revokeObjectURL(url)
                  if (dur > 60) { toast.error('音频不能超过 60 秒'); return }
                  const reader = new FileReader()
                  reader.onload = () => setAvatarAudio({ id: crypto.randomUUID(), name: f.name, dataUrl: reader.result as string, duration: dur })
                  reader.readAsDataURL(f)
                }
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>

      {mode === 'image' && (
        <>
          {/* 生成配置 - 紧凑间距 */}          <div className="rounded-xl border bg-card p-3">
            <div className="space-y-3">
              {/* 模型选择 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">模型</Label>
                <Select
                  value={modelType}
                  onValueChange={(v) => setModelType(v as 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0')}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue>
                      {currentModel?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((model) => {
                      const Icon = model.icon
                      return (
                        <SelectItem key={model.value} value={model.value} className="py-2">
                          <div className="flex items-start gap-3">
                            <Icon className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm mb-0.5">{model.label}</div>
                              <div className="text-xs text-muted-foreground leading-snug">
                                {model.desc}
                              </div>
                              <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                                <Coins className="h-3 w-3" />
                                {model.credits} 积分/张
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* 质量 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">质量</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {availableResolutions.map((res) => (
                    <button
                      key={res.value}
                      onClick={() => setResolution(res.value)}
                      disabled={disabled}
                      className={cn(
                        'py-1.5 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                        resolution === res.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/50',
                        disabled && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 水印 - 仅 Seedream 模型显示 */}
              {currentModel?.supportsWatermark && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">水印</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[{ value: false, label: '不加水印' }, { value: true, label: '添加水印' }].map((opt) => (
                      <button
                        key={String(opt.value)}
                        onClick={() => setWatermark(opt.value)}
                        disabled={disabled}
                        className={cn(
                          'py-1.5 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                          watermark === opt.value
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border hover:border-primary/50',
                          disabled && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 画面比例 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">比例</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar.value}
                      onClick={() => setAspectRatio(ar.value)}
                      disabled={disabled}
                      className={cn(
                        'flex flex-col items-center gap-1 py-1.5 px-1 rounded-lg border-2 transition-all',
                        aspectRatio === ar.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/50',
                        disabled && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="flex items-end justify-center h-3.5">
                        <AspectRatioIcon ratio={ar.value} active={aspectRatio === ar.value} />
                      </div>
                      <span className="text-xs font-medium">{ar.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center gap-3">
            <Select
              value={String(quantity)}
              onValueChange={(v) => setQuantity(Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="w-[90px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUANTITY_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} 张
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex-1" />

            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Coins className="h-4 w-4 text-amber-500" />
              <span>{estimatedCredits} 积分</span>
            </div>

            <Button
              variant="gradient"
              size="lg"
              className="gap-2 px-8"
              onClick={handleGenerate}
              disabled={isGenerating || disabled || !prompt.trim()}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  生成
                </>
              )}
            </Button>
          </div>

          {/* 参考图管理对话框 */}
          <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>参考图片管理</DialogTitle>
              </DialogHeader>
              <div className="mt-4">
                <ReferenceImageUploadCompact expanded />
              </div>
            </DialogContent>
          </Dialog>

          {/* 隐藏文件选择器 - 无图时直接上传 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleImageFiles(e.target.files)}
          />

          {/* 公司A图库选择器 */}
          {isCompanyA && (
            <CompanyAImagePicker
              open={companyAPickerOpen}
              onOpenChange={setCompanyAPickerOpen}
              onSelectPoster={handleSelectCompanyAImage}
            />
          )}
        </>
      )}

      {mode === 'video' && (
        <>
          {/* 视频生成配置 */}
          <div className="rounded-xl border bg-card p-3">
            <div className="space-y-3">
              {/* 模型 + 分辨率 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">模型</Label>
                  <Select value={videoModel} onValueChange={setVideoModel} disabled={isVideoGenerating || disabled}>
                    <SelectTrigger className="h-9">
                      <SelectValue>
                        {VIDEO_MODEL_OPTIONS[videoMode].find(m => m.value === videoModel)?.label ?? videoModel}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_MODEL_OPTIONS[videoMode].map((m) => (
                        <SelectItem key={m.value} value={m.value} className="py-2">
                          <div className="flex items-start gap-3">
                            <Film className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm mb-0.5">{m.label}</div>
                              <div className="text-xs text-muted-foreground leading-snug">{m.desc}</div>
                              <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                                <Coins className="h-3 w-3" />
                                {m.isSeedance ? `${m.credits} 积分/秒` : `${m.credits} 积分/次`}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">分辨率</Label>
                  <Select
                    value={String(videoUpsample)}
                    onValueChange={(v) => setVideoUpsample(v === 'true')}
                    disabled={isVideoGenerating || disabled}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_RESOLUTIONS.map((r) => (
                        <SelectItem key={String(r.value)} value={String(r.value)}>
                          <span className="font-medium">{r.label}</span>
                          <span className="text-xs text-muted-foreground ml-1.5">{r.desc}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 2: 比例 [buttons veo] | 比例+时长 [dropdowns seedance] */}
              {isSeedanceVideo ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">比例</Label>
                    <Select value={videoAspectRatio} onValueChange={setVideoAspectRatio} disabled={isVideoGenerating || disabled}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_ASPECT_RATIOS_SEEDANCE.map((ar) => (
                          <SelectItem key={ar.value} value={ar.value}>{ar.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">时长</Label>
                    <Select value={String(videoDuration)} onValueChange={(v) => setVideoDuration(Number(v))} disabled={isVideoGenerating || disabled}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEEDANCE_DURATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">比例</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {VIDEO_ASPECT_RATIOS_DEFAULT.map((ar) => (
                      <button
                        key={ar.value}
                        onClick={() => setVideoAspectRatio(ar.value)}
                        disabled={isVideoGenerating || disabled}
                        className={cn(
                          'py-1.5 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                          videoAspectRatio === ar.value
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border hover:border-primary/50',
                          (isVideoGenerating || disabled) && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {ar.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Row 3 (Seedance only): 音频 + 镜头 */}
              {isSeedanceVideo && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">音频</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[{ value: true, label: '有声' }, { value: false, label: '无声' }].map((opt) => (
                        <button
                          key={String(opt.value)}
                          onClick={() => setVideoGenerateAudio(opt.value)}
                          disabled={isVideoGenerating || disabled}
                          className={cn(
                            'py-1.5 px-2 rounded-lg border-2 text-sm font-medium transition-all',
                            videoGenerateAudio === opt.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-border hover:border-primary/50',
                            (isVideoGenerating || disabled) && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">镜头</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[{ value: false, label: '自由' }, { value: true, label: '固定' }].map((opt) => (
                        <button
                          key={String(opt.value)}
                          onClick={() => setVideoCameraFixed(opt.value)}
                          disabled={isVideoGenerating || disabled}
                          className={cn(
                            'py-1.5 px-2 rounded-lg border-2 text-sm font-medium transition-all',
                            videoCameraFixed === opt.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-border hover:border-primary/50',
                            (isVideoGenerating || disabled) && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center gap-3">
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Coins className="h-4 w-4 text-amber-500" />
              {isSeedanceVideo
                ? <span>{(videoDuration === -1 ? 12 : videoDuration) * 100} 积分</span>
                : <span>{VIDEO_MODEL_OPTIONS[videoMode].find(m => m.value === videoModel)?.credits ?? 10} 积分</span>
              }
            </div>
            <Button
              variant="gradient"
              size="lg"
              className="gap-2 px-8"
              onClick={handleVideoGenerate}
              disabled={isVideoGenerating || disabled || !videoPrompt.trim() || (videoMode === 'components' && videoReferenceImages.length === 0)}
            >
              {isVideoGenerating ? (
                <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
              ) : (
                <><Sparkles className="h-4 w-4" />生成</>
              )}
            </Button>
          </div>
        </>
      )}

      {mode === 'avatar' && (
        <>
          {/* 数字人配置 */}
          <div className="rounded-xl border bg-card p-3">
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">分辨率</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[{ value: '720p', label: '720p', desc: '标准' }, { value: '1080p', label: '1080p', desc: '高清' }].map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setAvatarResolution(r.value as '720p' | '1080p')}
                      disabled={isAvatarGenerating}
                      className={cn(
                        'py-1.5 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                        avatarResolution === r.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/50',
                        isAvatarGenerating && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {r.label} <span className="text-xs font-normal text-muted-foreground">{r.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center gap-3">
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Coins className="h-4 w-4 text-amber-500" />
              <span>{avatarAudio ? `${Math.ceil(avatarAudio.duration) * 50} 积分` : '50 积分/秒'}</span>
            </div>
            <Button
              variant="gradient"
              size="lg"
              className="gap-2 px-8"
              onClick={handleAvatarGenerate}
              disabled={isAvatarGenerating || disabled || !avatarImage || !avatarAudio}
            >
              {isAvatarGenerating ? (
                <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
              ) : (
                <><Sparkles className="h-4 w-4" />生成</>
              )}
            </Button>
          </div>
        </>
      )}

      {mode === 'action_imitation' && (
        <>
          {/* 底部操作栏 */}
          <div className="flex items-center gap-3">
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Coins className="h-4 w-4 text-amber-500" />
              <span>{actionVideo ? `${Math.ceil(actionVideo.duration) * 20} 积分` : '20 积分/秒'}</span>
            </div>
            <Button
              variant="gradient"
              size="lg"
              className="gap-2 px-8"
              onClick={handleActionImitationGenerate}
              disabled={isActionGenerating || disabled || !actionImage || !actionVideo}
            >
              {isActionGenerating ? (
                <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
              ) : (
                <><Sparkles className="h-4 w-4" />生成</>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function AspectRatioIcon({ ratio, active }: { ratio: string; active: boolean }) {
  const [w, h] = ratio.split(':').map(Number)
  const maxSize = 14
  const scale = maxSize / Math.max(w, h)
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)

  return (
    <div
      className={cn(
        'rounded border-2',
        active ? 'border-primary bg-primary/20' : 'border-current opacity-40'
      )}
      style={{ width, height }}
    />
  )
}
