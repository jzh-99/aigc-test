'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Loader2, Play, Download, ArrowRight, ChevronDown, ChevronUp, Check, Link2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { apiPost, apiGet } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { Shot } from '@/lib/video-studio-api'
import type { DescribeData } from '@/hooks/video-studio/use-wizard-state'
import { usePendingBatchWatcher } from '@/hooks/video-studio/use-pending-batch-watcher'
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

async function submitVideoBatch(params: {
  prompt: string
  model: VideoModel
  aspectRatio: string
  duration: number
  referenceImages: string[]
  tailFrameUrl?: string
  workspaceId: string
  projectId: string
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
    ...(params.tailFrameUrl ? { images: [params.tailFrameUrl] } : {}),
    ...(params.projectId ? { video_studio_project_id: params.projectId } : {}),
  })
  return batch.id
}

interface ShotVideoCardProps {
  shot: Shot
  referenceImages: string[]
  labelMap: Record<string, string>
  videoUrl: string | undefined
  aspectRatio: string
  workspaceId: string
  projectId: string
  videoParams: VideoParams
  tailFrameUrl?: string
  sequentialMode: boolean
  isLocked: boolean
  isPending: boolean
  onVideoReady: (url: string) => void
  onBatchSubmitted: (batchId: string) => void
  onConfirm: () => void
  onTailFrameExtracted: (shotId: string, dataUrl: string) => void
  registerGenerate: (shotId: string, fn: () => Promise<void>) => void
}

function ShotVideoCard({ shot, referenceImages, labelMap, videoUrl, aspectRatio, workspaceId, projectId, videoParams, tailFrameUrl, sequentialMode, isLocked, isPending, onVideoReady, onBatchSubmitted, onConfirm, onTailFrameExtracted, registerGenerate }: ShotVideoCardProps) {
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const extractTailFrame = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current
      if (!video || !videoUrl) { reject(new Error('no video')); return }
      const seekTo = Math.max(0, video.duration - 0.1)
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')!.drawImage(video, 0, 0)
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('canvas toBlob failed')); return }
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        }, 'image/jpeg', 0.92)
      }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = seekTo
    })
  }, [videoUrl])

  const buildPrompt = useCallback(() => {
    let base = shot.visualPrompt ?? shot.content
    for (const [name, label] of Object.entries(labelMap)) {
      base = base.replaceAll(`[${name}]`, label)
    }
    if (!shot.visualPrompt && shot.cameraMove) base += `。运镜：${shot.cameraMove}。`
    if (!base.includes('不要有字幕')) base += '视频需要有台词和音效，不要有字幕和bgm。'
    return base
  }, [shot, labelMap])

  const generate = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      let base = shot.visualPrompt ?? shot.content
      for (const [name, label] of Object.entries(labelMap)) {
        base = base.replaceAll(`[${name}]`, label)
      }
      if (!shot.visualPrompt && shot.cameraMove) base += `。运镜：${shot.cameraMove}。`
      if (!base.includes('不要有字幕')) base += '视频需要有台词和音效，不要有字幕和bgm。'
      const batchId = await submitVideoBatch({
        prompt: base,
        model: videoParams.model,
        aspectRatio,
        duration: videoParams.durationOverride ?? shot.duration,
        referenceImages,
        tailFrameUrl: sequentialMode ? tailFrameUrl : undefined,
        workspaceId,
        projectId,
      })
      onBatchSubmitted(batchId)
      toast.success(`${shot.label}：任务已提交`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败'
      setErrorMessage(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [shot, labelMap, referenceImages, tailFrameUrl, sequentialMode, aspectRatio, workspaceId, projectId, videoParams, onBatchSubmitted])

  const handleConfirm = useCallback(async () => {
    setConfirmed(true)
    if (sequentialMode && videoUrl) {
      try {
        const dataUrl = await extractTailFrame()
        onTailFrameExtracted(shot.id, dataUrl)
      } catch {
        // tail frame extraction failed — next shot just won't have it
      }
    }
    onConfirm()
  }, [sequentialMode, videoUrl, extractTailFrame, onTailFrameExtracted, onConfirm, shot.id])

  const generateRef = useRef(generate)
  generateRef.current = generate
  useEffect(() => {
    registerGenerate(shot.id, () => generateRef.current())
  }, [shot.id, registerGenerate])

  return (
    <div className={`border rounded-xl bg-card overflow-hidden transition-opacity ${isLocked ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex">
        {/* Reference images column */}
        <div className="w-28 shrink-0 bg-muted/40 relative flex flex-col">
          {tailFrameUrl && sequentialMode ? (
            <div className="flex flex-col h-full">
              {referenceImages.length > 0 && (
                <img src={referenceImages[0]} alt="" className="w-full object-cover" style={{ flex: 1, minHeight: 0 }} />
              )}
              <div className="relative">
                <img src={tailFrameUrl} alt="上一镜头尾帧" className="w-full object-cover" style={{ flex: 1, minHeight: 0 }} />
                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center bg-black/60 text-white py-0.5">尾帧参考</span>
              </div>
            </div>
          ) : referenceImages.length > 0 ? (
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
              {confirmed && <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />}
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
            <div className="flex gap-2 flex-wrap items-center">
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
              <button onClick={generate} disabled={loading || isPending} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                {loading || isPending ? '生成中…' : '重新生成'}
              </button>
              {sequentialMode && !confirmed && (
                <button
                  onClick={handleConfirm}
                  className="flex items-center gap-1 text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700 transition-colors ml-auto"
                >
                  <Check className="w-3 h-3" />
                  确认定稿
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={generate}
              disabled={loading || isPending}
              className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {(loading || isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading || isPending ? '生成中…' : `生成视频 · ${calcVideoCost(shot, videoParams)}积分`}
            </button>
          )}

          {errorMessage && (
            <div className="flex items-start gap-1.5 text-xs text-red-500 bg-red-50 rounded-lg px-2.5 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
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
            <div><span className="font-medium text-foreground">模型</span>　{videoParams.model}</div>
          </div>
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
          <video ref={videoRef} src={videoUrl} controls className="w-full max-h-48 bg-black" />
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
  projectId: string
  projectName: string
  pendingVideoBatches: Record<string, string>
  onAddPendingVideoBatch: (batchId: string, shotId: string) => void
  onClearPendingVideoBatch: (batchId: string) => void
  onVideoReady: (shotId: string, url: string) => void
  onComplete: () => void
}

export function StepVideo({ shots, shotImages, shotVideos, describeData, characterImages, sceneImages, projectId, projectName, pendingVideoBatches, onAddPendingVideoBatch, onClearPendingVideoBatch, onVideoReady, onComplete }: Props) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId) ?? ''
  const [showParams, setShowParams] = useState(false)
  const [videoParams, setVideoParams] = useState<VideoParams>(DEFAULT_VIDEO_PARAMS)
  const [sequentialMode, setSequentialMode] = useState(false)
  const [confirmedShots, setConfirmedShots] = useState<Set<string>>(new Set())
  const [tailFrames, setTailFrames] = useState<Record<string, string>>({})

  const generateFnsRef = useRef<Record<string, () => Promise<void>>>({})
  const registerGenerate = useCallback((shotId: string, fn: () => Promise<void>) => {
    generateFnsRef.current[shotId] = fn
  }, [])

  usePendingBatchWatcher({
    pendingBatches: pendingVideoBatches ?? {},
    intervalMs: 5000,
    failureMessage: '视频生成失败',
    emptyMessage: '视频生成完成但未返回URL',
    onCompleted: (shotId, urls) => {
      onVideoReady(shotId, urls[0])
    },
    onClear: onClearPendingVideoBatch,
  })

  const pendingShotIds = new Set(Object.values(pendingVideoBatches ?? {}))

  // Resolve reference images for a shot, returns ordered list + name→label map
  const resolveRefs = useCallback((shot: Shot): { refs: string[]; labelMap: Record<string, string> } => {
    const refs: string[] = []
    const nameToLabel: Record<string, string> = {}
    const addRef = (url: string, name: string) => {
      if (!refs.includes(url)) {
        refs.push(url)
        nameToLabel[name] = `图${refs.length}`
      }
    }
    if (shotImages[shot.id]) addRef(shotImages[shot.id], `__shot_${shot.id}`)
    if (shot.characters) {
      for (const name of shot.characters) {
        const url = characterImages[name]
        if (url) addRef(url, name)
      }
    }
    if (shot.scene) {
      const url = sceneImages[shot.scene]
      if (url) addRef(url, shot.scene)
    }
    return { refs, labelMap: nameToLabel }
  }, [shotImages, characterImages, sceneImages])

  const generateAll = useCallback(async () => {
    const pending = shots.filter((s) => !shotVideos[s.id] && !pendingShotIds.has(s.id))
    if (pending.length === 0) return
    setBatchRunning(true)
    const fns = pending.map((s) => generateFnsRef.current[s.id]).filter(Boolean)
    const results = await Promise.allSettled(fns.map((fn) => fn()))
    setBatchRunning(false)
    const success = results.filter((r) => r.status === 'fulfilled').length
    if (success > 0) toast.success(`批量生成完成，${success}/${fns.length} 成功`)
  }, [shots, shotVideos, pendingShotIds])

  const [batchRunning, setBatchRunning] = useState(false)
  const completedCount = shots.filter((s) => shotVideos[s.id]).length
  const allDone = completedCount === shots.length && shots.length > 0
  const pendingCount = shots.length - completedCount

  const handleConfirmShot = useCallback((shotId: string) => {
    setConfirmedShots((prev) => new Set([...prev, shotId]))
  }, [])

  const handleTailFrameExtracted = useCallback((shotId: string, dataUrl: string) => {
    setTailFrames((prev) => ({ ...prev, [shotId]: dataUrl }))
  }, [])

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

        {/* Sequential mode toggle */}
        <button
          onClick={() => setSequentialMode((v) => !v)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${sequentialMode ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
        >
          <div className="flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            顺序生成 + 尾帧参考
          </div>
          <div className={`w-8 h-4 rounded-full transition-colors relative ${sequentialMode ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${sequentialMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
        </button>

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
            disabled={batchRunning || sequentialMode}
            className="w-full flex items-center justify-center gap-2 text-xs bg-primary text-primary-foreground py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            title={sequentialMode ? '顺序生成模式下请逐镜头生成' : undefined}
          >
            {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {batchRunning ? '批量生成中…' : `批量生成 (${pendingCount}) · ${shots.filter((s) => !shotVideos[s.id]).reduce((sum, s) => sum + calcVideoCost(s, videoParams), 0)}积分`}
          </button>
        )}

        {allDone ? (
          <div className="space-y-2">
            <button
              onClick={() => onComplete()}
              className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
            >
              下一步：完成导出
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : completedCount > 0 ? (
          <button
            onClick={() => onComplete()}
            className="w-full flex items-center justify-center gap-2 text-sm border border-border py-2.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            跳过，进入导出
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 p-5 overflow-y-auto space-y-3">
        {shots.map((shot, i) => {
          const prevShot = shots[i - 1]
          const isLocked = sequentialMode && i > 0 && !confirmedShots.has(prevShot?.id ?? '')
          const { refs: resolvedRefs, labelMap } = resolveRefs(shot)
          const tailFrameUrl = sequentialMode && prevShot ? tailFrames[prevShot.id] : undefined
          return (
            <ShotVideoCard
              key={shot.id}
              shot={shot}
              referenceImages={resolvedRefs}
              labelMap={labelMap}
              videoUrl={shotVideos[shot.id]}
              aspectRatio={describeData.aspectRatio}
              workspaceId={workspaceId}
              projectId={projectId}
              videoParams={videoParams}
              onVideoReady={(url) => onVideoReady(shot.id, url)}
              onBatchSubmitted={(batchId) => onAddPendingVideoBatch(batchId, shot.id)}
              registerGenerate={registerGenerate}
              sequentialMode={sequentialMode}
              isLocked={isLocked}
              isPending={pendingShotIds.has(shot.id)}
              tailFrameUrl={tailFrameUrl}
              onConfirm={() => handleConfirmShot(shot.id)}
              onTailFrameExtracted={handleTailFrameExtracted}
            />
          )
        })}
      </div>
    </div>
  )
}