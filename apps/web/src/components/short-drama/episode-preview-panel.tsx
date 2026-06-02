'use client'

import { ChevronLeft, ChevronRight, Download, Film, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ShortDramaEpisode, ShortDramaExportStatus, ShortDramaState } from '@aigc/types'

const EXPORT_STATUS_LABELS: Record<ShortDramaExportStatus, string> = {
  idle: '未导出',
  pending: '等待导出',
  exporting: '导出中',
  completed: '已完成',
  failed: '导出失败',
}

interface EpisodePreviewPanelProps {
  episode: ShortDramaEpisode
  state: ShortDramaState
  onExport: () => void
  exporting: boolean
  onBatchGenerateVideos: () => void
  batchGenerating: boolean
  selectedSegmentIndex: number
  onSelectSegment: (index: number) => void
}

export function EpisodePreviewPanel({
  episode,
  state,
  onExport,
  exporting,
  onBatchGenerateVideos,
  batchGenerating,
  selectedSegmentIndex,
  onSelectSegment,
}: EpisodePreviewPanelProps) {
  const segments = episode.segments
  const completedSegments = segments.filter(s => !!s.videoUrl)
  const pendingVideoCount = segments.filter(s => !s.videoUrl && s.status !== 'pending' && s.status !== 'generating').length
  const missingCount = segments.length - completedSegments.length
  const previewFrameClass = state.settings.aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'
  const completedCount = completedSegments.length
  const selectedSafeIndex = segments.length > 0
    ? Math.min(Math.max(selectedSegmentIndex, 0), segments.length - 1)
    : 0
  const selectedSegment = segments[selectedSafeIndex] ?? null

  const exportBatch = [...state.exports.batches].reverse().find(b =>
    b.episodeNumbers.includes(episode.episodeNumber)
  )
  const episodeExport = exportBatch?.exports.find(e => e.episodeNumber === episode.episodeNumber)
  const visibleEpisodeExport = exporting
    ? {
        episodeNumber: episode.episodeNumber,
        status: 'pending' as const,
        videoUrl: null,
        errorMessage: null,
      }
    : episodeExport
  const canDownloadExport = !!visibleEpisodeExport?.videoUrl && visibleEpisodeExport.status === 'completed'
  const exportInProgress = exporting || visibleEpisodeExport?.status === 'pending' || visibleEpisodeExport?.status === 'exporting'
  const canGoPrev = selectedSafeIndex > 0
  const canGoNext = selectedSafeIndex < segments.length - 1

  return (
    <aside className="space-y-4 rounded-2xl border bg-card/80 p-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">预览与导出</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {completedCount}/{segments.length}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${segments.length > 0 ? (completedCount / segments.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectSegment(selectedSafeIndex - 1)}
            disabled={!canGoPrev}
            className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="上一个片段"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 text-center">
            <div className="text-[11px] font-medium text-muted-foreground">
              片段 {segments.length > 0 ? selectedSafeIndex + 1 : 0}/{segments.length}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectSegment(selectedSafeIndex + 1)}
            disabled={!canGoNext}
            className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="下一个片段"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
          <div className={`${previewFrameClass} bg-black`}>
            {selectedSegment?.videoUrl ? (
              <video
                src={selectedSegment.videoUrl}
                className="h-full w-full bg-black object-contain"
                controls
                preload="metadata"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/40 px-4 text-center text-xs text-muted-foreground">
                <Film className="h-5 w-5" />
                <span>暂未生成视频</span>
              </div>
            )}
          </div>
          <div className="space-y-1 px-3 py-2">
            <div className="line-clamp-2 text-xs font-medium leading-5 text-foreground">
              {selectedSegment?.title ?? '暂无片段'}
            </div>
          </div>
        </div>

        {segments.length > 1 && (
          <div className="flex justify-center gap-1.5">
            {segments.map((segment, index) => (
              <button
                key={segment.id}
                type="button"
                onClick={() => onSelectSegment(index)}
                className={`h-1.5 rounded-full transition-all ${
                  index === selectedSafeIndex ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/45'
                }`}
                aria-label={`切换到片段 ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t pt-3">
        {missingCount > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            还有 {missingCount} 个片段未生成视频
          </div>
        )}

        {pendingVideoCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onBatchGenerateVideos}
            disabled={batchGenerating}
            className="w-full"
          >
            {batchGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            批量生成视频 ({pendingVideoCount})
          </Button>
        )}
      </div>

      {visibleEpisodeExport && (
        <div className="space-y-1 rounded-lg border bg-background/60 p-3 text-xs">
          <div>导出状态：{EXPORT_STATUS_LABELS[visibleEpisodeExport.status]}</div>
          {visibleEpisodeExport.videoUrl && (
            <a
              href={visibleEpisodeExport.videoUrl}
              download
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" />下载导出视频
            </a>
          )}
          {visibleEpisodeExport.errorMessage && (
            <p className="text-red-500">{visibleEpisodeExport.errorMessage}</p>
          )}
        </div>
      )}

      {missingCount === 0 && segments.length > 0 && (
        canDownloadExport ? (
          <Button size="sm" asChild className="w-full">
            <a href={visibleEpisodeExport.videoUrl ?? '#'} download>
              <Download className="w-3.5 h-3.5 mr-1" />
              下载本集
            </a>
          </Button>
        ) : (
          <Button size="sm" onClick={onExport} disabled={exportInProgress} className="w-full">
            {exportInProgress ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}
            {exportInProgress ? '导出中' : '导出本集'}
          </Button>
        )
      )}
    </aside>
  )
}
