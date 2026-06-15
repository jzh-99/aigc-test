'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Loader2, Download, Play, Film, RotateCcw, CheckSquare, Square, X } from 'lucide-react'
import { useNavigationStore } from '@/stores/navigation-store'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ShortDramaState } from '@aigc/types'
import { translateError } from '@/lib/error-messages'
import { exportShortDramaBatch, generateShortDramaEpisodeSegments } from '@/lib/short-drama/api'

interface StepEpisodesProps {
  projectId: string
  state: ShortDramaState
  onStateChange: () => void
}

const POLL_INTERVAL = 3_000

export function StepEpisodes({ projectId, state, onStateChange }: StepEpisodesProps) {
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  const [exporting, setExporting] = useState(false)
  const [generatingEpisodeNumber, setGeneratingEpisodeNumber] = useState<number | null>(null)
  const [generatedCount, setGeneratedCount] = useState(0)
  const [generateTotalCount, setGenerateTotalCount] = useState(0)
  const [failedEpisodeErrors, setFailedEpisodeErrors] = useState<Record<number, string>>({})
  const [selectingSegments, setSelectingSegments] = useState(false)
  const [selectedEpisodeNumbers, setSelectedEpisodeNumbers] = useState<number[]>([])
  const [confirmGenerateEpisodes, setConfirmGenerateEpisodes] = useState<number[] | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const episodes = state.episodes.items
  const selectedEpisodeSet = useMemo(() => new Set(selectedEpisodeNumbers), [selectedEpisodeNumbers])

  // 包含后端持久化的 generating 状态，刷新后可从 state 恢复
  const serverGeneratingEpisodes = useMemo(
    () => episodes.filter(ep => ep.status === 'generating').map(ep => ep.episodeNumber),
    [episodes]
  )
  const isServerGenerating = serverGeneratingEpisodes.length > 0
  const isLocalGenerating = generatingEpisodeNumber !== null
  const isGeneratingSegments = isLocalGenerating || isServerGenerating

  const remainingSegmentEpisodes = useMemo(
    () => episodes
      .filter(ep =>
        ep.status !== 'generating' &&
        (
          ep.segments.length === 0 ||
          ep.status === 'failed' ||
          Boolean(failedEpisodeErrors[ep.episodeNumber])
        )
      )
      .map(ep => ep.episodeNumber),
    [episodes, failedEpisodeErrors]
  )
  const generatedEpisodeCount = episodes.filter(ep => ep.segments.length > 0).length
  const ungeneratedEpisodeCount = episodes.length - generatedEpisodeCount
  const recentFailedEpisodeCount = episodes.filter(ep =>
    ep.status === 'failed' || failedEpisodeErrors[ep.episodeNumber]
  ).length
  const exportableCount = episodes.filter(ep =>
    ep.segments.length > 0 && ep.segments.every(s => !!s.videoUrl)
  ).length

  // 后端正在生成时轮询刷新，直到生成完成
  useEffect(() => {
    if (!isServerGenerating || isLocalGenerating) {
      if (pollRef.current) {
        clearTimeout(pollRef.current)
        pollRef.current = null
      }
      return
    }

    let cancelled = false

    const schedulePoll = () => {
      if (cancelled || pollRef.current) return
      pollRef.current = setTimeout(() => {
        pollRef.current = null
        onStateChange()
      }, POLL_INTERVAL)
    }

    schedulePoll()

    return () => {
      cancelled = true
      if (pollRef.current) {
        clearTimeout(pollRef.current)
        pollRef.current = null
      }
    }
  }, [isServerGenerating, isLocalGenerating, onStateChange])

  const generateSelectedSegments = async (episodeNumbers: number[]) => {
    if (episodeNumbers.length === 0) return

    setSelectingSegments(false)
    setSelectedEpisodeNumbers([])
    setGeneratedCount(0)
    setGenerateTotalCount(episodeNumbers.length)

    try {
      for (const episodeNumber of episodeNumbers) {
        setGeneratingEpisodeNumber(episodeNumber)
        setFailedEpisodeErrors(current => {
          const next = { ...current }
          delete next[episodeNumber]
          return next
        })

        try {
          await generateShortDramaEpisodeSegments(projectId, episodeNumber)
          setGeneratedCount(count => count + 1)
        } catch (err) {
          const message = translateError(err instanceof Error ? err.message : 'AI 生成失败，请稍后重试')
          setFailedEpisodeErrors(current => ({ ...current, [episodeNumber]: message }))
          toast.error(message)
          break
        }
      }
    } finally {
      setGeneratingEpisodeNumber(null)
      setGenerateTotalCount(0)
      onStateChange()
    }
  }

  const requestGenerateSegments = (episodeNumbers: number[]) => {
    if (isGeneratingSegments) return
    if (episodeNumbers.length === 0) {
      toast.info('请先选择要生成的集')
      return
    }

    const orderedEpisodeNumbers = episodes
      .map(ep => ep.episodeNumber)
      .filter(episodeNumber => episodeNumbers.includes(episodeNumber))
    const hasGeneratedEpisodes = orderedEpisodeNumbers.some(episodeNumber => {
      const episode = episodes.find(ep => ep.episodeNumber === episodeNumber)
      return Boolean(episode && episode.segments.length > 0)
    })

    if (hasGeneratedEpisodes) {
      setConfirmGenerateEpisodes(orderedEpisodeNumbers)
      return
    }

    void generateSelectedSegments(orderedEpisodeNumbers)
  }

  const toggleEpisodeSelection = (episodeNumber: number) => {
    setSelectedEpisodeNumbers(current =>
      current.includes(episodeNumber)
        ? current.filter(item => item !== episodeNumber)
        : [...current, episodeNumber]
    )
  }

  const selectAllEpisodes = () => {
    setSelectedEpisodeNumbers(episodes.map(ep => ep.episodeNumber))
  }

  const selectRemainingEpisodes = () => {
    setSelectedEpisodeNumbers(remainingSegmentEpisodes)
  }

  const cancelSegmentSelection = () => {
    setSelectingSegments(false)
    setSelectedEpisodeNumbers([])
  }

  const handleBatchExport = async () => {
    const exportable = episodes
      .filter(ep => ep.segments.length > 0 && ep.segments.every(s => !!s.videoUrl))
      .map(ep => ep.episodeNumber)

    if (exportable.length === 0) {
      toast.info('没有可导出的集')
      return
    }

    setExporting(true)
    try {
      await exportShortDramaBatch(projectId, exportable)
      onStateChange()
      toast.success(`已提交 ${exportable.length} 集导出`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex h-6 items-center">
            共 {episodes.length} 集 · 已生成 {generatedEpisodeCount} · 未生成 {ungeneratedEpisodeCount} · 可导出 {exportableCount}
          </span>
          {recentFailedEpisodeCount > 0 && (
            <span className="inline-flex h-6 items-center gap-1 text-amber-700">
              <AlertCircle className="h-3.5 w-3.5" />
              最近失败 {recentFailedEpisodeCount}
            </span>
          )}
          {isGeneratingSegments && (
            <span className="inline-flex h-6 items-center gap-1 text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {isLocalGenerating
                ? `正在生成第 ${generatingEpisodeNumber} 集（${generatedCount}/${generateTotalCount}）`
                : `第 ${serverGeneratingEpisodes.join('、')} 集生成中...`}
            </span>
          )}
        </div>
        <div className="flex min-h-9 shrink-0 items-center gap-2">
          {selectingSegments && (
            <>
              <Button size="sm" variant="ghost" onClick={selectAllEpisodes} disabled={isGeneratingSegments}>
                全部
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="ghost" onClick={selectRemainingEpisodes} disabled={isGeneratingSegments}>
                      剩余
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    勾选将会选择剩余未生成和生成失败的全部集数
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button size="sm" variant="ghost" onClick={cancelSegmentSelection} disabled={isGeneratingSegments}>
                <X className="w-3.5 h-3.5 mr-1" />
                取消
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!selectingSegments) {
                setSelectingSegments(true)
                setSelectedEpisodeNumbers([])
                return
              }
              requestGenerateSegments(selectedEpisodeNumbers)
            }}
            disabled={isGeneratingSegments || (selectingSegments && selectedEpisodeNumbers.length === 0)}
          >
            {isGeneratingSegments ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Film className="w-3.5 h-3.5 mr-1" />}
            {selectingSegments
              ? `确认生成 (${selectedEpisodeNumbers.length})`
              : '批量生成片段脚本'}
          </Button>
          {exportableCount > 0 && (
            <Button size="sm" onClick={handleBatchExport} disabled={exporting}>
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}
              批量导出 ({exportableCount})
            </Button>
          )}
        </div>
      </div>

      {episodes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          暂无分集数据
        </div>
      ) : (
        <div className="max-h-[560px] space-y-3 overflow-y-auto pr-2">
          {episodes.map(episode => {
            const segmentCount = episode.segments.length
            const completedSegments = episode.segments.filter(s => s.status === 'completed').length
            const isCurrentGenerating = generatingEpisodeNumber === episode.episodeNumber || episode.status === 'generating'
            const failureMessage = failedEpisodeErrors[episode.episodeNumber] ?? episode.errorMessage ?? 'AI 生成失败，请稍后重试'
            const isSelected = selectedEpisodeSet.has(episode.episodeNumber)
            const isFailed = episode.status === 'failed' || !!failedEpisodeErrors[episode.episodeNumber]
            const canGenerateEpisode = !isGeneratingSegments && !isCurrentGenerating
            const generateButtonLabel = segmentCount > 0 || isFailed ? '重新生成' : '生成片段脚本'
            const failureDisplayMessage = segmentCount > 0
              ? `最近一次重新生成失败，已保留原片段脚本（${segmentCount} 个片段）`
              : failureMessage

            return (
              <div
                key={episode.episodeNumber}
                className={`p-4 rounded-lg border bg-card transition ${
                  isFailed
                    ? segmentCount > 0
                      ? 'border-amber-500/35 bg-amber-500/10'
                      : 'border-destructive/35 bg-destructive/10'
                    : isSelected
                      ? 'border-primary/45 bg-primary/10'
                      : 'border-border/70 hover:border-primary/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectingSegments ? (
                      <button
                        type="button"
                        onClick={() => toggleEpisodeSelection(episode.episodeNumber)}
                        disabled={isGeneratingSegments}
                        className="text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={isSelected ? `取消选择第${episode.episodeNumber}集` : `选择第${episode.episodeNumber}集`}
                      >
                        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>
                    ) : isFailed ? (
                      <AlertCircle className={`w-4 h-4 ${segmentCount > 0 ? 'text-amber-600' : 'text-destructive'}`} />
                    ) : (
                      <Film className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="font-medium text-sm">
                        第 {episode.episodeNumber} 集：{episode.title}
                      </div>
                      <div className={`text-xs mt-0.5 ${isFailed ? (segmentCount > 0 ? 'text-amber-700' : 'text-destructive') : 'text-muted-foreground'}`}>
                        {isCurrentGenerating
                          ? '片段脚本生成中...'
                          : isFailed
                            ? (
                              <span className="inline-flex items-center gap-1 font-medium">
                                <AlertCircle className="h-3.5 w-3.5" />
                                {failureDisplayMessage}
                              </span>
                            )
                            : `${segmentCount} 个片段 · ${completedSegments} 已完成`}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={segmentCount > 0 || isFailed ? 'outline' : 'default'}
                      onClick={() => requestGenerateSegments([episode.episodeNumber])}
                      disabled={!canGenerateEpisode}
                    >
                      {isCurrentGenerating ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      ) : segmentCount > 0 || isFailed ? (
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      ) : (
                        <Film className="w-3.5 h-3.5 mr-1" />
                      )}
                      {isCurrentGenerating ? '生成中' : generateButtonLabel}
                    </Button>
                    <Link
                      href={`/toby-studio/short-drama/${projectId}/episodes/${episode.episodeNumber}`}
                      onClick={() => startNavigation(`/toby-studio/short-drama/${projectId}/episodes/${episode.episodeNumber}`)}
                    >
                      <Button size="sm" variant="outline">
                        <Play className="w-3.5 h-3.5 mr-1" />
                        编辑
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Dialog open={Boolean(confirmGenerateEpisodes)} onOpenChange={(open) => {
        if (!open) setConfirmGenerateEpisodes(null)
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认重新生成片段脚本</DialogTitle>
            <DialogDescription>
              已选择的集里包含已经生成过片段脚本的内容。确认后会重新生成并覆盖这些集的片段脚本，原有片段脚本和相关视频状态可能不再保留。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-300">
            将生成第 {confirmGenerateEpisodes?.join('、')} 集，共 {confirmGenerateEpisodes?.length ?? 0} 集。
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmGenerateEpisodes(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                const episodeNumbers = confirmGenerateEpisodes ?? []
                setConfirmGenerateEpisodes(null)
                void generateSelectedSegments(episodeNumbers)
              }}
            >
              确认生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
