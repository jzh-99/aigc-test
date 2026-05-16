'use client'

import { useState, useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Coins, ImagePlus, Music, X } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import { cn, generateUUID } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationDefaults } from '@/hooks/use-generation-defaults'
import { fetchWithAuth, ApiError, getRequestErrorMessage, reportClientSubmissionError, classifyRequestError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { FrameImage } from '../shared/types'
import { readFrameFile, isValidImageFile, isValidAudioFile, getDraggedAsset, fetchAssetFile } from '../shared/file-utils'

interface AvatarAudio {
  id: string
  name: string
  dataUrl: string
  duration: number
}

interface AvatarPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
}

export function AvatarPanel({ onBatchCreated, disabled }: AvatarPanelProps) {
  const { videoDefaults, avatarDefaults, userDefaults, prompt: storePrompt } = useGenerationStore()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { save: saveDefaults } = useGenerationDefaults()

  const [avatarImage, setAvatarImage] = useState<FrameImage | null>(null)
  const [avatarAudio, setAvatarAudio] = useState<AvatarAudio | null>(null)
  // 从 store 读取 prompt 作为初始值，支持从历史记录复用配置
  const [avatarPrompt, setAvatarPrompt] = useState(storePrompt)
  const [avatarResolution, setAvatarResolution] = useState<'720p' | '1080p'>(
    (avatarDefaults?.avatarResolution as '720p' | '1080p') ?? '720p'
  )
  const [isAvatarGenerating, setIsAvatarGenerating] = useState(false)

  const avatarImageRef = useRef<HTMLInputElement>(null)
  const avatarAudioRef = useRef<HTMLInputElement>(null)

  const handleAvatarImageDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const asset = getDraggedAsset(e.dataTransfer)
    if (!asset.url) return
    if (asset.type === 'video') {
      toast.error('当前区域只支持图片参考，请拖拽图片资产')
      return
    }
    try {
      const file = await fetchAssetFile(asset.url, asset.type, 'avatar-image')
      if (file.size > 5 * 1024 * 1024) { toast.error('人物图片不能超过 5 MB'); return }
      const img = await readFrameFile(file, true)
      if (img) setAvatarImage(img)
    } catch {
      toast.error('图片加载失败，请确认网络可访问图片服务器')
    }
  }

  const handleAvatarAudioDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const asset = getDraggedAsset(e.dataTransfer)
    if (!asset.url) return
    toast.error('当前区域不支持视频参考，请上传音频文件')
  }

  const handleAvatarGenerate = async () => {
    if (!avatarImage || !avatarAudio) return
    setIsAvatarGenerating(true)
    try {
      // 并行上传图片和音频
      const [imageUpload, audioUpload] = await Promise.all([
        (async () => {
          const form = new FormData()
          const blob = await fetch(avatarImage.dataUrl).then(r => r.blob())
          form.append('file', blob, `avatar-image.${blob.type.split('/')[1] || 'jpg'}`)
          const res = await fetchWithAuth<{ url: string }>('/avatar/upload', { method: 'POST', body: form })
          return res
        })(),
        (async () => {
          const form = new FormData()
          const blob = await fetch(avatarAudio.dataUrl).then(r => r.blob())
          form.append('file', blob, avatarAudio.name)
          const res = await fetchWithAuth<{ url: string }>('/avatar/upload', { method: 'POST', body: form })
          return res
        })(),
      ])

      const batch = await fetchWithAuth<BatchResponse>('/avatar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: activeWorkspaceId,
          image_url: imageUpload.url,
          audio_url: audioUpload.url,
          audio_duration: avatarAudio.duration,
          prompt: avatarPrompt.trim() || undefined,
          resolution: avatarResolution,
        }),
      })
      onBatchCreated(batch)
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
      void reportClientSubmissionError({
        error_code: classifyRequestError(err),
        detail: rawMessage.slice(0, 500) || undefined,
        http_status: err instanceof ApiError ? err.status : null,
      })
      toast.error(getRequestErrorMessage(err, '数字人生成请求失败，请稍后重试'))
    } finally {
      setIsAvatarGenerating(false)
    }
  }

  const handleSaveDefaults = () => {
    saveDefaults({
      image: userDefaults ?? undefined,
      video: videoDefaults ?? undefined,
      avatar: { avatarResolution },
    })
    toast.success('已保存为默认参数')
  }

  const estimatedCredits = avatarAudio ? `${Math.ceil(avatarAudio.duration) * 50} 积分` : '50 积分/秒'
  const isDisabled = isAvatarGenerating || !!disabled

  return (
    <>
      <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-3">
        {/* 人物图片上传 */}
        <div className="shrink-0">
          <p className="text-[11px] text-muted-foreground mb-1">人物图片（必填，≤5MB）</p>
          {avatarImage ? (
            <div className="relative h-[90px] w-full rounded-lg overflow-hidden border bg-muted group"
              onDragOver={(e) => e.preventDefault()} onDrop={handleAvatarImageDrop}>
              <Image src={avatarImage.previewUrl} alt="" fill className="object-contain" sizes="300px" unoptimized />
              <button
                onClick={() => setAvatarImage(null)}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
              ><X className="h-3 w-3 text-background" /></button>
            </div>
          ) : (
            <button
              onClick={() => avatarImageRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleAvatarImageDrop}
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
            <div className="flex items-center gap-3 h-10 px-3 rounded-lg border bg-muted"
              onDragOver={(e) => e.preventDefault()} onDrop={handleAvatarAudioDrop}>
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
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleAvatarAudioDrop}
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
            if (!isValidImageFile(f)) { toast.error(`文件「${f.name}」格式不支持，请上传 JPG / PNG / WEBP 格式的图片`); e.target.value = ''; return }
            if (f.size > 5 * 1024 * 1024) { toast.error('人物图片不能超过 5 MB'); e.target.value = ''; return }
            const img = await readFrameFile(f, true)
            if (img) setAvatarImage(img)
            e.target.value = ''
          }}
        />
        <input ref={avatarAudioRef} type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/x-m4a" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            if (!isValidAudioFile(f)) { toast.error(`文件「${f.name}」格式不支持，请上传 MP3 / WAV / M4A / AAC 格式的音频`); e.target.value = ''; return }
            const url = URL.createObjectURL(f)
            const audio = document.createElement('audio')
            audio.src = url
            audio.onloadedmetadata = () => {
              const dur = audio.duration
              URL.revokeObjectURL(url)
              if (dur > 60) { toast.error('驱动音频时长不能超过 60 秒'); return }
              const reader = new FileReader()
              reader.onload = () => setAvatarAudio({ id: generateUUID(), name: f.name, dataUrl: reader.result as string, duration: dur })
              reader.readAsDataURL(f)
            }
            e.target.value = ''
          }}
        />
      </div>

      {/* 参数配置 + 生成按钮 */}
      <div className="rounded-xl border bg-card p-3 relative">
        <button
          className="absolute top-2 right-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
          disabled={isDisabled}
          onClick={handleSaveDefaults}
        >
          设为默认
        </button>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">分辨率</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {([{ value: '720p', label: '720p', desc: '标准' }, { value: '1080p', label: '1080p', desc: '高清' }] as const).map((r) => (
              <button
                key={r.value}
                onClick={() => setAvatarResolution(r.value)}
                disabled={isDisabled}
                className={cn(
                  'py-1.5 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                  avatarResolution === r.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/50',
                  isDisabled && 'opacity-50 cursor-not-allowed'
                )}
              >
                {r.label} <span className="text-xs font-normal text-muted-foreground">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Coins className="h-4 w-4 text-amber-500" />
          <span>{estimatedCredits}</span>
        </div>
        <Button variant="gradient" size="lg" className="gap-2 px-8"
          onClick={handleAvatarGenerate}
          disabled={isDisabled || !avatarImage || !avatarAudio}
        >
          {isAvatarGenerating
            ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </>
  )
}
