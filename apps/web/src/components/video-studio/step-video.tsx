'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Loader2, Play, Download, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { apiPost, apiGet } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { Shot } from '@/lib/video-studio-api'
import type { DescribeData } from '@/hooks/video-studio/use-wizard-state'
import { VIDEO_PER_SECOND_CREDITS } from '@/lib/credits'

type VideoModel = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-1.5-pro'

interface VideoParams {
  model: VideoModel
  durationOverride: number | null  // null = use shot.duration
}

const VIDEO_MODEL_OPTIONS: Array<{ value: VideoModel; label: string; creditsPerSec: number }> = [
  { value: 'seedance-2.0',      label: 'Seedance 2.0',      creditsPerSec: VIDEO_PER_SECOND_CREDITS['seedance-2.0'] },
  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', creditsPerSec: VIDEO_PER_SECOND_CREDITS['seedance-2.0-fast'] },
  { value: 'seedance-1.5-pro',  label: 'Seedance 1.5 Pro',  creditsPerSec: VIDEO_PER_SECOND_CREDITS['seedance-1.5-pro'] },
]

const DEFAULT_VIDEO_PARAMS: VideoParams = { model: 'seedance-2.0', durationOverride: null }

function calcVideoCost(shot: Shot, params: VideoParams): number {
  const dur = Math.min(Math.max(Math.round(params.durationOverride ?? shot.duration), 4), 15)
  const cps = VIDEO_MODEL_OPTIONS.find(m => m.value === params.model)?.creditsPerSec ?? 5
  return dur * cps
}

async function generateVideo(params: {
  prompt: string
  model: VideoModel
  aspectRatio: string
  duration: number
  referenceImages: string[]
  workspaceId: string
}): Promise<string> {
  const clampedDuration = Math.min(Math.max(Math.round(params.duration), 4), 15)
  const batch = await apiPost<BatchResponse>('/videos/generate', {
    idempotency_key: `vs_vid_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    prompt: params.prompt,
    workspace_id: params.workspaceId,
    model: params.model,
    aspect_ratio: params.aspectRatio,
    duration: clampedDuration,
    generate_audio: false,
    ...(params.referenceImages.length > 0 ? { reference_images: params.referenceImages } : {}),
  })

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const updated = await apiGet<BatchResponse>(`/batches/${batch.id}`)
    if (updated.status === 'completed' || updated.status === 'partial_complete') {
      const url = updated.tasks[0]?.asset?.storage_url ?? updated.tasks[0]?.asset?.original_url
      if (url) return url
      throw new Error('视频URL为空')
    }
    if (updated.status === 'failed') throw new Error('视频生成失败')
  }
  throw new Error('生成超时')
}

interface ShotVideoCardProps {
  shot: Shot
  referenceImages: string[]
  videoUrl: string | undefined
  aspectRatio: string
  workspaceId: string
  videoParams: VideoParams
  onVideoReady: (url: string) => void
  registerGenerate: (shotId: string, fn: () => Promise<void>) => void
}

function ShotVideoCard({ shot, referenceImages, videoUrl, aspectRatio, workspaceId, videoParams, onVideoReady, registerGenerate }: ShotVideoCardProps) {
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [showParams, setShowParams] = useState(false)

  const buildPrompt = useCallback(() => {
    const parts = [shot.content]
    if (shot.cameraMove) parts.push(`Camera: ${shot.cameraMove}`)
    if (shot.dialogue) parts.push(`Dialogue: ${shot.dialogue}`)
    return parts.join('. ')
  }, [shot])

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const parts = [shot.content]
      if (shot.cameraMove) parts.push(`Camera: ${shot.cameraMove}`)
      if (shot.dialogue) parts.push(`Dialogue: ${shot.dialogue}`)
      const url = await generateVideo({
        prompt: parts.join('. '),
        model: videoParams.model,
        aspectRatio,
        duration: videoParams.durationOverride ?? shot.duration,
        referenceImages,
        workspaceId,
      })
      onVideoReady(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }, [shot, referenceImages, aspectRatio, workspaceId, videoParams, onVideoReady])

  const generateRef = useRef(generate)
  generateRef.current = generate
  useEffect(() => {
    registerGenerate(shot.id, () => generateRef.current())
  }, [shot.id, registerGenerate])

  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <div className="flex">
        {/* Reference images column */}
        <div className="w-28 shrink-0 bg-muted/40 relative flex flex-col">
          {referenceImages.length > 0 ? (
            referenceImages.map((url, i) => (
              <img key={i} src={url} alt="" className="w-full object-cover flex-1" style={{ minHeight: 0 }} />
            ))
          ) : (
            <div className="w-full h-full min-h-[80px] flex items-center justify-center text-muted-foreground text-[10px] p-2 text-center">
              无参考图
            </div>
          )}
        </div>

        <div className="flex-1 p-3 space-y-2 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-muted-foreground shrink-0">{shot.label}</span>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{shot.duration}s</span>
              {shot.cameraMove && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate">{shot.cameraMove}</span>
              )}
            </div>
            <button
              onClick={() => setShowParams(!showParams)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title="展开参数"
            >
              {showParams ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Shot content preview */}
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{shot.content}</p>

          {/* Actions */}
          {videoUrl ? (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setPlaying(!playing)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Play className="w-3 h-3" />
                {playing ? '收起' : '预览'}
              </button>
              <a href={videoUrl} download className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Download className="w-3 h-3" />
                下载
              </a>
              <button onClick={generate} disabled={loading} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                重新生成
              </button>
            </div>
          ) : (
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? '生成中…' : `生成视频 · ${calcVideoCost(shot, videoParams)}积分`}
            </button>
          )}
        </div>
      </div>

      {/* Expandable params panel */}
      {showParams && (
        <div className="border-t bg-muted/30 p-3 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
            <div><span className="font-medium text-foreground">时长</span>　{shot.duration}s</div>
            <div><span className="font-medium text-foreground">比例</span>　{aspectRatio}</div>
            <div><span className="font-medium text-foreground">运镜</span>　{shot.cameraMove || '—'}</div>
            <div><span className="font-medium text-foreground">模型</span>　seedance-2.0</div>
          </div>
          {shot.dialogue && (
            <div>
              <p className="font-medium text-foreground mb-0.5">台词</p>
              <p className="text-muted-foreground leading-relaxed bg-background rounded p-2">{shot.dialogue}</p>
            </div>
          )}
          {shot.characters && shot.characters.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-0.5">出场角色</p>
              <p className="text-muted-foreground">{shot.characters.join('、')}</p>
            </div>
          )}
          {shot.scene && (
            <div>
              <p className="font-medium text-foreground mb-0.5">场景</p>
              <p className="text-muted-foreground">{shot.scene}</p>
            </div>
          )}
          <div>
            <p className="font-medium text-foreground mb-0.5">Prompt</p>
            <p className="text-muted-foreground leading-relaxed bg-background rounded p-2 break-all">{buildPrompt()}</p>
          </div>
          {referenceImages.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-1">参考图 ({referenceImages.length})</p>
              <div className="flex gap-2 flex-wrap">
                {referenceImages.map((url, i) => (
                  <img key={i} src={url} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {playing && videoUrl && (
        <div className="border-t">
          <video src={videoUrl} controls className="w-full max-h-48 bg-black" />
        </div>
      )}
    </div>
  )
}

interface Props {
  shots: Shot[]
  shotImages: Record<string, string>
  shotVideos: Record<string, string>
  describeData: DescribeData
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  onVideoReady: (shotId: string, url: string) => void
  onComplete: () => void
}

export function StepVideo({ shots, shotImages, shotVideos, describeData, characterImages, sceneImages, onVideoReady, onComplete }: Props) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId) ?? ''
  const [showParams, setShowParams] = useState(false)
  const [videoParams, setVideoParams] = useState<VideoParams>(DEFAULT_VIDEO_PARAMS)

  const generateFnsRef = useRef<Record<string, () => Promise<void>>>({})
  const registerGenerate = useCallback((shotId: string, fn: () => Promise<void>) => {
    generateFnsRef.current[shotId] = fn
  }, [])

  // Resolve reference images for a shot: shotImage first, then character/scene images
  const resolveRefs = useCallback((shot: Shot): string[] => {
    const refs: string[] = []
    // Storyboard-assigned shot image takes priority
    if (shotImages[shot.id]) refs.push(shotImages[shot.id])
    // Add character images for characters in this shot
    if (shot.characters) {
      for (const name of shot.characters) {
        const url = characterImages[name]
        if (url && !refs.includes(url)) refs.push(url)
      }
    }
    // Add scene image
    if (shot.scene) {
      const url = sceneImages[shot.scene]
      if (url && !refs.includes(url)) refs.push(url)
    }
    return refs
  }, [shotImages, characterImages, sceneImages])

  const generateAll = useCallback(async () => {
    const pending = shots.filter((s) => !shotVideos[s.id])
    if (pending.length === 0) return
    setBatchRunning(true)
    const fns = pending.map((s) => generateFnsRef.current[s.id]).filter(Boolean)
    const results = await Promise.allSettled(fns.map((fn) => fn()))
    setBatchRunning(false)
    const success = results.filter((r) => r.status === 'fulfilled').length
    if (success > 0) toast.success(`批量生成完成，${success}/${fns.length} 成功`)
  }, [shots, shotVideos])

  const [batchRunning, setBatchRunning] = useState(false)
  const completedCount = shots.filter((s) => shotVideos[s.id]).length
  const allDone = completedCount === shots.length && shots.length > 0
  const pendingCount = shots.length - completedCount

  return (
    <div className="flex h-full">
      <div className="w-[260px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">生成视频</h2>
          <p className="text-xs text-muted-foreground mt-0.5">逐镜头生成视频片段</p>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>{completedCount} / {shots.length} 已完成</p>
          <p>比例 {describeData.aspectRatio}　时长约 {describeData.duration}s</p>
        </div>

        {/* Video params panel */}
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowParams(!showParams)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted transition-colors"
          >
            <span className="text-muted-foreground">生成参数</span>
            <div className="flex items-center gap-2">
              <span className="text-foreground">{VIDEO_MODEL_OPTIONS.find(m => m.value === videoParams.model)?.label}{videoParams.durationOverride ? ` · ${videoParams.durationOverride}s` : ''}</span>
              {showParams ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </div>
          </button>
          {showParams && (
            <div className="border-t p-3 space-y-3 bg-muted/20">
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">模型</p>
                <div className="grid grid-cols-1 gap-1">
                  {VIDEO_MODEL_OPTIONS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setVideoParams((p) => ({ ...p, model: m.value }))}
                      className={`text-left px-2 py-1 rounded text-xs transition-colors ${videoParams.model === m.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      {m.label}
                      <span className="ml-1 opacity-60">{m.creditsPerSec}积分/秒</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">时长覆盖（留空用分镜时长）</p>
                <div className="flex gap-1 flex-wrap">
                  {([null, 4, 5, 6, 8, 10] as const).map((d) => (
                    <button
                      key={d ?? 'auto'}
                      onClick={() => setVideoParams((p) => ({ ...p, durationOverride: d }))}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${videoParams.durationOverride === d ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'}`}
                    >
                      {d === null ? '自动' : `${d}s`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {pendingCount > 0 && (
          <button
            onClick={generateAll}
            disabled={batchRunning}
            className="w-full flex items-center justify-center gap-2 text-xs bg-primary text-primary-foreground py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {batchRunning ? '批量生成中…' : `批量生成 (${pendingCount}) · ${shots.filter((s) => !shotVideos[s.id]).reduce((sum, s) => sum + calcVideoCost(s, videoParams), 0)}积分`}
          </button>
        )}

        {allDone ? (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
          >
            全部完成
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : completedCount > 0 ? (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 text-sm border border-border py-2.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            跳过，完成项目
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 p-5 overflow-y-auto space-y-3">
        {shots.map((shot) => (
          <ShotVideoCard
            key={shot.id}
            shot={shot}
            referenceImages={resolveRefs(shot)}
            videoUrl={shotVideos[shot.id]}
            aspectRatio={describeData.aspectRatio}
            workspaceId={workspaceId}
            videoParams={videoParams}
            onVideoReady={(url) => onVideoReady(shot.id, url)}
            registerGenerate={registerGenerate}
          />
        ))}
      </div>
    </div>
  )
}
