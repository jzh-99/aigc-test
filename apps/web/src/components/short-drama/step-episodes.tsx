'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Loader2, Download, Play, Film, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ShortDramaState } from '@aigc/types'
import { exportShortDramaBatch, generateShortDramaEpisodeSegments } from '@/lib/short-drama/api'

interface StepEpisodesProps {
  projectId: string
  state: ShortDramaState
  onStateChange: () => void
}

export function StepEpisodes({ projectId, state, onStateChange }: StepEpisodesProps) {
  const [exporting, setExporting] = useState(false)
  const [generatingEpisodeNumber, setGeneratingEpisodeNumber] = useState<number | null>(null)
  const [generatedCount, setGeneratedCount] = useState(0)
  const [generateTotalCount, setGenerateTotalCount] = useState(0)
  const [failedEpisodeErrors, setFailedEpisodeErrors] = useState<Record<number, string>>({})
  const autoGenerateKeyRef = useRef<string | null>(null)

  const episodes = state.episodes.items
  const pendingSegmentEpisodes = useMemo(
    () => episodes
      .filter(ep => ep.segments.length === 0 && ep.status !== 'failed' && ep.status !== 'generating' && !failedEpisodeErrors[ep.episodeNumber])
      .map(ep => ep.episodeNumber),
    [episodes, failedEpisodeErrors]
  )
  const generatedEpisodeCount = episodes.filter(ep => ep.segments.length > 0).length
  const failedEpisodeCount = episodes.filter(ep =>
    ep.segments.length === 0 && (ep.status === 'failed' || failedEpisodeErrors[ep.episodeNumber])
  ).length
  const exportableCount = episodes.filter(ep =>
    ep.segments.length > 0 && ep.segments.every(s => !!s.videoUrl)
  ).length
  const isGeneratingSegments = generatingEpisodeNumber !== null

  const generateMissingSegments = async (episodeNumbers: number[]) => {
    if (episodeNumbers.length === 0) return

    setGeneratedCount(0)
    setGenerateTotalCount(episodeNumbers.length)
    let successCount = 0

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
          successCount += 1
          setGeneratedCount(count => count + 1)
          onStateChange()
        } catch (err) {
          const message = err instanceof Error ? err.message : 'AI 生成失败，请稍后重试'
          setFailedEpisodeErrors(current => ({ ...current, [episodeNumber]: message }))
          onStateChange()
          toast.error(message)
          break
        }
      }
    } finally {
      setGeneratingEpisodeNumber(null)
      setGenerateTotalCount(0)
    }

    if (successCount > 0) {
      toast.success(`已生成 ${successCount} 集片段脚本`)
    }
  }

  const retryEpisodeSegments = async (episodeNumber: number) => {
    if (isGeneratingSegments) return
    await generateMissingSegments([episodeNumber])
  }

  useEffect(() => {
    if (pendingSegmentEpisodes.length === 0 || failedEpisodeCount > 0 || isGeneratingSegments) return

    const autoGenerateKey = `${projectId}:${pendingSegmentEpisodes.join(',')}`
    if (autoGenerateKeyRef.current === autoGenerateKey) return
    autoGenerateKeyRef.current = autoGenerateKey

    void generateMissingSegments(pendingSegmentEpisodes)
  }, [projectId, pendingSegmentEpisodes, failedEpisodeCount, isGeneratingSegments])

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
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          共 {episodes.length} 集 · 已生成 {generatedEpisodeCount} · 可导出 {exportableCount}
          {failedEpisodeCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {failedEpisodeCount} 集生成失败
            </span>
          )}
          {isGeneratingSegments && (
            <span className="ml-2 inline-flex items-center gap-1 text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在生成第 {generatingEpisodeNumber} 集（{generatedCount}/{generateTotalCount}）
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pendingSegmentEpisodes.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => generateMissingSegments(pendingSegmentEpisodes)}
              disabled={isGeneratingSegments}
            >
              {isGeneratingSegments ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Film className="w-3.5 h-3.5 mr-1" />}
              生成片段脚本 ({pendingSegmentEpisodes.length})
            </Button>
          )}
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
        <div className="space-y-3">
          {episodes.map(episode => {
            const segmentCount = episode.segments.length
            const completedSegments = episode.segments.filter(s => s.status === 'completed').length
            const isCurrentGenerating = generatingEpisodeNumber === episode.episodeNumber
            const failureMessage = failedEpisodeErrors[episode.episodeNumber] ?? episode.errorMessage ?? 'AI 生成失败，请稍后重试'
            const isFailed = segmentCount === 0 && (episode.status === 'failed' || !!failedEpisodeErrors[episode.episodeNumber])

            return (
              <div
                key={episode.episodeNumber}
                className={`p-4 rounded-lg border ${isFailed ? 'border-destructive/30 bg-destructive/5' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isFailed ? (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    ) : (
                      <Film className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="font-medium text-sm">
                        第 {episode.episodeNumber} 集：{episode.title}
                      </div>
                      <div className={`text-xs mt-0.5 ${isFailed ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {isCurrentGenerating
                          ? '片段脚本生成中...'
                          : isFailed
                            ? failureMessage
                            : `${segmentCount} 个片段 · ${completedSegments} 已完成`}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {isFailed && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retryEpisodeSegments(episode.episodeNumber)}
                        disabled={isGeneratingSegments}
                      >
                        {isCurrentGenerating ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        )}
                        重新生成
                      </Button>
                    )}
                    <Link href={`/toby-studio/short-drama/${projectId}/episodes/${episode.episodeNumber}`}>
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
    </div>
  )
}
