'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Loader2, Play, Download, ArrowRight, ChevronDown, ChevronUp, Check, Link2, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { apiPost } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { Fragment } from '@/lib/video-studio-api'
import type { DescribeData } from '@/hooks/video-studio/use-wizard-state'
import { usePendingBatchWatcher } from '@/hooks/video-studio/use-pending-batch-watcher'
import { VIDEO_PER_SECOND_CREDITS } from '@/lib/credits'

type VideoModel = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-1.5-pro'

interface VideoParams {
  model: VideoModel
  durationOverride: number | null
  style: string
}

const VIDEO_MODEL_OPTIONS: Array<{ value: VideoModel; label: string; creditsPerSec: number }> = [
  { value: 'seedance-2.0',      label: 'Seedance 2.0',      creditsPerSec: VIDEO_PER_SECOND_CREDITS['seedance-2.0'] },
  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', creditsPerSec: VIDEO_PER_SECOND_CREDITS['seedance-2.0-fast'] },
  { value: 'seedance-1.5-pro',  label: 'Seedance 1.5 Pro',  creditsPerSec: VIDEO_PER_SECOND_CREDITS['seedance-1.5-pro'] },
]

const DEFAULT_VIDEO_PARAMS: Omit<VideoParams, 'style'> = { model: 'seedance-2.0', durationOverride: null }
const VIDEO_PROMPT_SUFFIX = '画面稳定流畅，面部清晰不变形，人体结构正常，无文字伪影，无多余手指。视频需要有台词和音效，不要有字幕和bgm。'

function calcVideoCost(fragment: Fragment, params: VideoParams): number {
  const dur = Math.min(Math.max(Math.round(params.durationOverride ?? fragment.duration), 4), 15)
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
    generate_audio: true,
    ...(params.referenceImages.length > 0 ? { reference_images: params.referenceImages } : {}),
    ...(params.tailFrameUrl ? { images: [params.tailFrameUrl] } : {}),
    ...(params.projectId ? { video_studio_project_id: params.projectId } : {}),
  })
  return batch.id
}

interface FragmentVideoCardProps {
  fragment: Fragment
  referenceImages: string[]
  labelMap: Record<string, string>
  voiceMap: Record<string, string>
  videoUrl: string | undefined
  videoHistory: string[]
  aspectRatio: string
  workspaceId: string
  projectId: string
  videoParams: VideoParams
  tailFrameUrl?: string
  sequentialMode: boolean
  isLocked: boolean
  isPending: boolean
  onVideoReady: (url: string) => void
  onSelectVideo: (url: string) => void
  onBatchSubmitted: (batchId: string) => void
  onConfirm: () => void
  onTailFrameExtracted: (fragmentId: string, dataUrl: string) => void
  registerGenerate: (fragmentId: string, fn: () => Promise<void>) => void
}

function appendPromptSuffix(prompt: string) {
  return prompt.includes('不要有字幕') ? prompt : `${prompt}${prompt.endsWith('。') ? '' : '。'}${VIDEO_PROMPT_SUFFIX}`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolvePromptPlaceholders(prompt: string, labelMap: Record<string, string>, voiceMap: Record<string, string>) {
  let result = prompt
  const entries = Object.entries(labelMap).sort((a, b) => b[0].length - a[0].length)
  for (const [name, label] of entries) {
    result = result.replaceAll(`[${name}]`, label)
  }
  for (const [name, label] of entries) {
    result = result.replace(new RegExp(`${escapeRegExp(name)}(?=说|：|:)`, 'g'), label)
  }
  for (const [name, voice] of Object.entries(voiceMap)) {
    result = result.replaceAll(`【${name}音色】`, `音色：${voice}；`)
  }
  return result
}

function extractImagePlaceholders(prompt: string) {
  return Array.from(prompt.matchAll(/\[([^\[\]]+)]/g), (match) => match[1].trim()).filter(Boolean)
}

function buildFragmentPrompt(fragment: Fragment, style: string, labelMap: Record<string, string>, voiceMap: Record<string, string>) {
  const shots = fragment.shots ?? []
  const body = shots.map((shot, index) => {
    const prompt = resolvePromptPlaceholders(shot.visualPrompt ?? shot.content, labelMap, voiceMap)
    return `分镜${index + 1}（${shot.duration}秒）: ${prompt}`
  }).join('\n')
  const transition = fragment.transition ? `\n分镜过渡: ${fragment.transition}` : ''
  return appendPromptSuffix(`画面风格和类型: ${style}\n生成一个由以下${shots.length}个分镜组成的视频:${transition}\n${body}`)
}

function FragmentVideoCard({ fragment, referenceImages, labelMap, voiceMap, videoUrl, videoHistory, aspectRatio, workspaceId, projectId, videoParams, tailFrameUrl, sequentialMode, isLocked, isPending, onVideoReady, onSelectVideo, onBatchSubmitted, onConfirm, onTailFrameExtracted, registerGenerate }: FragmentVideoCardProps) {
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
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

  const buildPrompt = useCallback(() => buildFragmentPrompt(fragment, videoParams.style, labelMap, voiceMap), [fragment, videoParams.style, labelMap, voiceMap])

  const generate = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const batchId = await submitVideoBatch({
        prompt: buildPrompt(),
        model: videoParams.model,
        aspectRatio,
        duration: videoParams.durationOverride ?? fragment.duration,
        referenceImages,
        tailFrameUrl: sequentialMode ? tailFrameUrl : undefined,
        workspaceId,
        projectId,
      })
      onBatchSubmitted(batchId)
      toast.success(`${fragment.label}：任务已提交`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败'
      setErrorMessage(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [fragment, referenceImages, tailFrameUrl, sequentialMode, aspectRatio, workspaceId, projectId, videoParams, onBatchSubmitted, buildPrompt])

  const handleConfirm = useCallback(async () => {
    setConfirmed(true)
    if (sequentialMode && videoUrl) {
      try {
        const dataUrl = await extractTailFrame()
        onTailFrameExtracted(fragment.id, dataUrl)
      } catch {
        // tail frame extraction failed — next fragment just won't have it
      }
    }
    onConfirm()
  }, [sequentialMode, videoUrl, extractTailFrame, onTailFrameExtracted, onConfirm, fragment.id])

  const generateRef = useRef(generate)
  generateRef.current = generate
  useEffect(() => {
    registerGenerate(fragment.id, () => generateRef.current())
  }, [fragment.id, registerGenerate])

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
              <span className="text-xs font-bold text-muted-foreground shrink-0">{fragment.label}</span>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{fragment.duration}s · {fragment.shots.length} 分镜</span>
              {videoUrl && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />}
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
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{fragment.shots.map((shot) => shot.content).join(' / ')}</p>

          {/* History thumbnails */}
          {videoHistory.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {videoHistory.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setLightboxUrl(url)}
                  className={`relative w-14 h-10 rounded overflow-hidden border-2 transition-colors group/thumb ${
                    videoUrl === url ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40'
                  }`}
                  title={`历史版本 ${i + 1}`}
                >
                  <video src={url} className="w-full h-full object-cover" muted preload="metadata" />
                  {videoUrl === url && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <CheckCircle2 className="w-3 h-3 text-primary" />
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/60 text-white leading-tight py-0.5">{i + 1}</span>
                </button>
              ))}
            </div>
          )}

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
              {loading || isPending ? '生成中…' : `生成视频 · ${calcVideoCost(fragment, videoParams)}积分`}
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
            <div><span className="font-medium text-foreground">时长</span>　{fragment.duration}s</div>
            <div><span className="font-medium text-foreground">比例</span>　{aspectRatio}</div>
            <div><span className="font-medium text-foreground">模型</span>　{videoParams.model}</div>
          </div>
          {fragment.shots.some((shot) => shot.characters?.length) && (
            <div>
              <p className="font-medium text-foreground mb-0.5">出场角色</p>
              <p className="text-muted-foreground">{Array.from(new Set(fragment.shots.flatMap((shot) => shot.characters ?? []))).join('、')}</p>
            </div>
          )}
          {fragment.shots.some((shot) => shot.scene) && (
            <div>
              <p className="font-medium text-foreground mb-0.5">场景</p>
              <p className="text-muted-foreground">{Array.from(new Set(fragment.shots.map((shot) => shot.scene).filter(Boolean))).join('、')}</p>
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

      {/* Lightbox for history browsing and 定稿 selection */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative max-w-2xl w-full bg-card rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-3 right-3 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            {videoHistory.length > 1 && (
              <>
                <button
                  onClick={() => {
                    const idx = videoHistory.indexOf(lightboxUrl)
                    if (idx > 0) setLightboxUrl(videoHistory[idx - 1])
                  }}
                  disabled={videoHistory.indexOf(lightboxUrl) === 0}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const idx = videoHistory.indexOf(lightboxUrl)
                    if (idx < videoHistory.length - 1) setLightboxUrl(videoHistory[idx + 1])
                  }}
                  disabled={videoHistory.indexOf(lightboxUrl) === videoHistory.length - 1}
                  className="absolute right-12 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-colors disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            <video src={lightboxUrl} controls autoPlay className="w-full max-h-[65vh] bg-black" />
            <div className="p-4 flex items-center justify-between">
              <p className="text-sm font-medium">
                {fragment.label}
                {videoHistory.length > 1 && (
                  <span className="ml-2 text-xs text-muted-foreground">版本 {videoHistory.indexOf(lightboxUrl) + 1} / {videoHistory.length}</span>
                )}
              </p>
              <button
                onClick={() => {
                  onSelectVideo(lightboxUrl)
                  setLightboxUrl(null)
                }}
                className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg transition-colors ${
                  videoUrl === lightboxUrl
                    ? 'bg-green-600 text-white cursor-default'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                {videoUrl === lightboxUrl ? '已选为定稿' : '选为定稿'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  fragments: Fragment[]
  shotImages: Record<string, string>
  shotVideos: Record<string, string>
  shotVideoHistory: Record<string, string[]>
  describeData: DescribeData
  characters?: Array<{ name: string; voiceDescription?: string }>
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  projectId: string
  projectName: string
  pendingVideoBatches: Record<string, string>
  onAddPendingVideoBatch: (batchId: string, shotId: string) => void
  onClearPendingVideoBatch: (batchId: string) => void
  onVideoReady: (shotId: string, url: string) => void
  refreshFromServer?: () => Promise<void>
  onComplete: () => void
}

export function StepVideo({ fragments, shotImages, shotVideos, shotVideoHistory, describeData, characters, characterImages, sceneImages, projectId, projectName, pendingVideoBatches, onAddPendingVideoBatch, onClearPendingVideoBatch, onVideoReady, refreshFromServer, onComplete }: Props) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId) ?? ''
  const [showParams, setShowParams] = useState(false)
  const [videoParams, setVideoParams] = useState<VideoParams>(() => ({ ...DEFAULT_VIDEO_PARAMS, style: describeData.style }))
  const [sequentialMode, setSequentialMode] = useState(false)
  const [confirmedFragments, setConfirmedFragments] = useState<Set<string>>(new Set())
  const [tailFrames, setTailFrames] = useState<Record<string, string>>({})
  const voiceMap = Object.fromEntries((characters ?? []).filter((character) => character.voiceDescription).map((character) => [character.name, character.voiceDescription as string]))

  const generateFnsRef = useRef<Record<string, () => Promise<void>>>({})
  useEffect(() => {
    void refreshFromServer?.()
  }, [refreshFromServer])

  const registerGenerate = useCallback((fragmentId: string, fn: () => Promise<void>) => {
    generateFnsRef.current[fragmentId] = fn
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

  const pendingFragmentIds = useMemo(() => new Set(Object.values(pendingVideoBatches ?? {})), [pendingVideoBatches])
  const videoHistoryByFragment = useMemo(() => Object.fromEntries(fragments.map((fragment) => {
    const history = shotVideoHistory?.[fragment.id] ?? []
    const selected = shotVideos[fragment.id]
    return [fragment.id, selected && !history.includes(selected) ? [...history, selected] : history]
  })), [fragments, shotVideoHistory, shotVideos])

  const resolveRefs = useCallback((fragment: Fragment): { refs: string[]; labelMap: Record<string, string> } => {
    const refs: string[] = []
    const nameToLabel: Record<string, string> = {}
    const addRef = (url: string, name: string) => {
      if (nameToLabel[name]) return
      const existingIndex = refs.indexOf(url)
      if (existingIndex >= 0) {
        nameToLabel[name] = `图${existingIndex + 1}`
        return
      }
      refs.push(url)
      nameToLabel[name] = `图${refs.length}`
    }
    const addNamedRef = (name: string) => {
      const url = characterImages[name] ?? sceneImages[name]
      if (url) addRef(url, name)
    }
    for (const shot of fragment.shots) {
      if (shotImages[shot.id]) addRef(shotImages[shot.id], `__shot_${shot.id}`)
      for (const name of shot.characters ?? []) addNamedRef(name)
      if (shot.scene) addNamedRef(shot.scene)
      for (const name of extractImagePlaceholders(shot.visualPrompt ?? shot.content)) addNamedRef(name)
    }
    return { refs, labelMap: nameToLabel }
  }, [shotImages, characterImages, sceneImages])

  const generateAll = useCallback(async () => {
    const pending = fragments.filter((fragment) => !shotVideos[fragment.id] && !pendingFragmentIds.has(fragment.id))
    if (pending.length === 0) return
    setBatchRunning(true)
    const fns = pending.map((fragment) => generateFnsRef.current[fragment.id]).filter(Boolean)
    const results = await Promise.allSettled(fns.map((fn) => fn()))
    setBatchRunning(false)
    const success = results.filter((r) => r.status === 'fulfilled').length
    if (success > 0) toast.success(`批量生成完成，${success}/${fns.length} 成功`)
  }, [fragments, shotVideos, pendingFragmentIds])

  const [batchRunning, setBatchRunning] = useState(false)
  const completedCount = fragments.filter((fragment) => shotVideos[fragment.id]).length
  const allDone = completedCount === fragments.length && fragments.length > 0
  const pendingCount = fragments.length - completedCount

  const handleConfirmFragment = useCallback((fragmentId: string) => {
    setConfirmedFragments((prev) => new Set([...prev, fragmentId]))
  }, [])

  const handleTailFrameExtracted = useCallback((fragmentId: string, dataUrl: string) => {
    setTailFrames((prev) => ({ ...prev, [fragmentId]: dataUrl }))
  }, [])

  return (
    <div className="flex h-full">
      <div className="w-[260px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">生成视频</h2>
          <p className="text-xs text-muted-foreground mt-0.5">逐片段生成视频</p>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>{completedCount} / {fragments.length} 已完成</p>
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
              <span className="text-foreground">{VIDEO_MODEL_OPTIONS.find(m => m.value === videoParams.model)?.label} · 有声{videoParams.durationOverride ? ` · ${videoParams.durationOverride}s` : ''}</span>
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
            title={sequentialMode ? '顺序生成模式下请逐片段生成' : undefined}
          >
            {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {batchRunning ? '批量生成中…' : `批量生成 (${pendingCount}) · ${fragments.filter((fragment) => !shotVideos[fragment.id]).reduce((sum, fragment) => sum + calcVideoCost(fragment, videoParams), 0)}积分`}
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
        {fragments.map((fragment, i) => {
          const prevFragment = fragments[i - 1]
          const isLocked = sequentialMode && i > 0 && !confirmedFragments.has(prevFragment?.id ?? '')
          const { refs: resolvedRefs, labelMap } = resolveRefs(fragment)
          const tailFrameUrl = sequentialMode && prevFragment ? tailFrames[prevFragment.id] : undefined
          return (
            <FragmentVideoCard
              key={fragment.id}
              fragment={fragment}
              referenceImages={resolvedRefs}
              labelMap={labelMap}
              voiceMap={voiceMap}
              videoUrl={shotVideos[fragment.id]}
              videoHistory={videoHistoryByFragment[fragment.id] ?? []}
              aspectRatio={describeData.aspectRatio}
              workspaceId={workspaceId}
              projectId={projectId}
              videoParams={videoParams}
              onVideoReady={(url) => onVideoReady(fragment.id, url)}
              onSelectVideo={(url) => onVideoReady(fragment.id, url)}
              onBatchSubmitted={(batchId) => onAddPendingVideoBatch(batchId, fragment.id)}
              registerGenerate={registerGenerate}
              sequentialMode={sequentialMode}
              isLocked={isLocked}
              isPending={pendingFragmentIds.has(fragment.id)}
              tailFrameUrl={tailFrameUrl}
              onConfirm={() => handleConfirmFragment(fragment.id)}
              onTailFrameExtracted={handleTailFrameExtracted}
            />
          )
        })}
      </div>
    </div>
  )
}