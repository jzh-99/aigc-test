'use client'

import { useCallback, useRef, useState, useEffect } from 'react'
import { AlertCircle, Archive, Check, Download, LayoutGrid, Loader2, Pause, Play, Scissors, X } from 'lucide-react'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { apiGet, apiPost } from '@/lib/api-client'
import type { Shot } from '@/lib/video-studio-api'

interface StepCompleteProps {
  shots: Shot[]
  shotVideos: Record<string, string>
  projectName: string
  onExportToCanvas: () => Promise<void>
  onReturn: () => void
}

export function StepComplete({ shots, shotVideos, projectName, onExportToCanvas, onReturn }: StepCompleteProps) {
  const [zipExporting, setZipExporting] = useState(false)
  const [showSplicePreview, setShowSplicePreview] = useState(true)
  const [showTrimEditor, setShowTrimEditor] = useState(false)
  const [trimPoints, setTrimPoints] = useState<Record<string, { inPoint: number; outPoint: number }>>({})
  const [concatStatus, setConcatStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [concatError, setConcatError] = useState<string | null>(null)
  const completedShots = shots.filter((shot) => shotVideos[shot.id])

  const exportZip = useCallback(async () => {
    setZipExporting(true)
    try {
      const zip = new JSZip()
      await Promise.all(
        completedShots.map(async (shot, i) => {
          const url = shotVideos[shot.id]
          const absUrl = url.startsWith('/') ? `${window.location.origin}${url}` : url
          const res = await fetch(absUrl)
          if (!res.ok) throw new Error(`下载失败: ${shot.label}`)
          const blob = await res.blob()
          zip.file(`${projectName}_${shot.label}_${i + 1}.mp4`, blob)
        })
      )
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `${projectName}_videos.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 导出失败')
    } finally {
      setZipExporting(false)
    }
  }, [completedShots, shotVideos, projectName])

  const startConcatExport = useCallback(async () => {
    setConcatStatus('processing')
    setConcatError(null)
    try {
      const segments = completedShots.map((shot) => ({
        url: shotVideos[shot.id],
        inPoint: trimPoints[shot.id]?.inPoint ?? 0,
        outPoint: trimPoints[shot.id]?.outPoint ?? shot.duration,
      }))
      const { jobId } = await apiPost<{ jobId: string }>('/videos/concat-export', { segments, projectName })
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const result = await apiGet<{ status: string; resultUrl?: string; error?: string }>(`/videos/concat-export/${jobId}`)
        if (result.status === 'done' && result.resultUrl) {
          setConcatStatus('done')
          const a = document.createElement('a')
          a.href = result.resultUrl
          a.download = `${projectName}_final.mp4`
          a.click()
          toast.success('合并导出完成')
          return
        }
        if (result.status === 'failed') {
          const errMsg = result.error ?? '合并失败'
          setConcatStatus('error')
          setConcatError(errMsg)
          toast.error(errMsg)
          return
        }
      }
      const timeoutMsg = '导出超时'
      setConcatStatus('error')
      setConcatError(timeoutMsg)
      toast.error(timeoutMsg)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '导出失败'
      setConcatStatus('error')
      setConcatError(errMsg)
      toast.error(errMsg)
    }
  }, [completedShots, shotVideos, trimPoints, projectName])

  return (
    <div className="relative flex h-full">
      <div className="w-[280px] shrink-0 border-r p-5 space-y-4 overflow-y-auto bg-background">
        <div>
          <h2 className="text-lg font-bold">完成导出</h2>
          <p className="text-xs text-muted-foreground mt-0.5">预览、剪辑并导出视频成品</p>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>{completedShots.length} / {shots.length} 个片段可用</p>
          <p>项目：{projectName}</p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => setShowSplicePreview((v) => !v)}
            disabled={completedShots.length === 0}
            className="w-full flex items-center justify-center gap-2 text-sm bg-primary text-primary-foreground py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {showSplicePreview ? '关闭拼接预览' : '拼接预览'}
          </button>
          <button
            onClick={exportZip}
            disabled={zipExporting || completedShots.length === 0}
            className="w-full flex items-center justify-center gap-2 text-xs border border-border py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
          >
            {zipExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
            {zipExporting ? '打包中…' : '导出全部 ZIP'}
          </button>
          <button
            onClick={() => setShowTrimEditor(true)}
            disabled={completedShots.length === 0}
            className="w-full flex items-center justify-center gap-2 text-xs border border-border py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
          >
            <Scissors className="w-3.5 h-3.5" />
            裁剪 & 导出定稿
          </button>
          <button
            onClick={onExportToCanvas}
            className="w-full flex items-center justify-center gap-2 text-xs border border-border py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            在画布中查看工作流
          </button>
          <button
            onClick={onReturn}
            className="w-full flex items-center justify-center gap-2 text-xs border border-border py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            完成，返回项目列表
          </button>
        </div>
      </div>

      <div className="flex-1 p-5 overflow-y-auto space-y-4">
        {showSplicePreview && <SplicePreview shots={shots} shotVideos={shotVideos} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {shots.map((shot) => {
            const url = shotVideos[shot.id]
            return (
              <div key={shot.id} className="border rounded-xl bg-card overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{shot.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{shot.duration}s · {shot.content}</p>
                  </div>
                  {url && (
                    <a href={url} download className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0">
                      <Download className="w-3 h-3" />
                      下载
                    </a>
                  )}
                </div>
                {url ? (
                  <video src={url} controls className="w-full max-h-48 bg-black" />
                ) : (
                  <div className="h-32 flex items-center justify-center text-xs text-muted-foreground bg-muted/40">未生成</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {showTrimEditor && (
        <TrimEditor
          shots={shots}
          shotVideos={shotVideos}
          trimPoints={trimPoints}
          onTrimChange={(shotId, trim) => setTrimPoints((p) => ({ ...p, [shotId]: trim }))}
          concatStatus={concatStatus}
          concatError={concatError}
          onExport={startConcatExport}
          onClose={() => setShowTrimEditor(false)}
        />
      )}
    </div>
  )
}

function SplicePreview({ shots, shotVideos }: { shots: Shot[]; shotVideos: Record<string, string> }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const orderedShots = shots.filter((shot) => shotVideos[shot.id])
  const orderedUrls = orderedShots.map((shot) => shotVideos[shot.id])
  const currentIdxRef = useRef(currentIdx)
  currentIdxRef.current = currentIdx

  const playFrom = useCallback((idx: number) => {
    const video = videoRef.current
    if (!video || idx >= orderedUrls.length) { setPlaying(false); return }
    setCurrentIdx(idx)
    video.src = orderedUrls[idx]
    video.play().catch(() => {})
  }, [orderedUrls])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = () => playFrom(currentIdxRef.current + 1)
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [playFrom])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
      setPlaying(false)
    } else {
      setPlaying(true)
      if (!video.src) playFrom(0)
      else video.play().catch(() => {})
    }
  }

  if (orderedUrls.length === 0) return null

  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-medium">拼接预览</span>
        <span className="text-xs text-muted-foreground">
          {playing ? `镜头 ${currentIdx + 1} / ${orderedUrls.length}` : `共 ${orderedUrls.length} 个镜头`}
        </span>
      </div>
      <video ref={videoRef} className="w-full bg-black max-h-[420px]" />
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={toggle} className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg">
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {playing ? '暂停' : '播放全部'}
        </button>
        {playing && <span className="text-xs text-muted-foreground">{orderedShots[currentIdx]?.label}</span>}
      </div>
    </div>
  )
}

interface TrimEditorProps {
  shots: Shot[]
  shotVideos: Record<string, string>
  trimPoints: Record<string, { inPoint: number; outPoint: number }>
  onTrimChange: (shotId: string, trim: { inPoint: number; outPoint: number }) => void
  concatStatus: 'idle' | 'processing' | 'done' | 'error'
  concatError: string | null
  onExport: () => void
  onClose: () => void
}

function TrimEditor({ shots, shotVideos, trimPoints, onTrimChange, concatStatus, concatError, onExport, onClose }: TrimEditorProps) {
  const validShots = shots.filter((s) => shotVideos[s.id])
  return (
    <div className="absolute inset-0 z-20 bg-background flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <div>
          <h3 className="text-sm font-bold">裁剪 & 导出定稿</h3>
          <p className="text-xs text-muted-foreground">设置每个镜头的入点和出点，确认后合并导出</p>
        </div>
        <div className="flex items-center gap-2">
          {concatStatus === 'done' ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="w-3.5 h-3.5" /> 导出完成
            </span>
          ) : concatStatus === 'error' ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="w-3.5 h-3.5" />
                {concatError ?? '导出失败'}
              </span>
              <button onClick={onExport} className="flex items-center gap-1 text-xs text-primary hover:underline">重试</button>
            </div>
          ) : (
            <button
              onClick={onExport}
              disabled={concatStatus === 'processing'}
              className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {concatStatus === 'processing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
              {concatStatus === 'processing' ? '合并中…' : '开始合并导出'}
            </button>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {validShots.map((shot) => (
          <TrimShotRow
            key={shot.id}
            shot={shot}
            url={shotVideos[shot.id]}
            trim={trimPoints[shot.id] ?? { inPoint: 0, outPoint: shot.duration }}
            onChange={(trim) => onTrimChange(shot.id, trim)}
          />
        ))}
      </div>
    </div>
  )
}

function TrimShotRow({ shot, url, trim, onChange }: {
  shot: Shot
  url: string
  trim: { inPoint: number; outPoint: number }
  onChange: (trim: { inPoint: number; outPoint: number }) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(shot.duration)
  const trimRef = useRef(trim)
  trimRef.current = trim

  const onLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration)
  }

  const previewTrim = () => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = trimRef.current.inPoint
    v.play().catch(() => {})
    const stop = () => {
      if (v.currentTime >= trimRef.current.outPoint) {
        v.pause()
        v.removeEventListener('timeupdate', stop)
      }
    }
    v.addEventListener('timeupdate', stop)
  }

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold">{shot.label}</span>
        <button onClick={previewTrim} className="text-xs text-primary hover:underline">预览片段</button>
      </div>
      <video ref={videoRef} src={url} onLoadedMetadata={onLoadedMetadata} className="w-full max-h-32 bg-black rounded" />
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="space-y-1">
          <span className="text-muted-foreground">入点 {trim.inPoint.toFixed(1)}s</span>
          <input
            type="range" min={0} max={duration} step={0.1} value={trim.inPoint}
            onChange={(e) => onChange({ ...trim, inPoint: Math.min(+e.target.value, trim.outPoint - 0.1) })}
            className="w-full"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">出点 {trim.outPoint.toFixed(1)}s</span>
          <input
            type="range" min={0} max={duration} step={0.1} value={trim.outPoint}
            onChange={(e) => onChange({ ...trim, outPoint: Math.max(+e.target.value, trim.inPoint + 0.1) })}
            className="w-full"
          />
        </label>
      </div>
    </div>
  )
}
