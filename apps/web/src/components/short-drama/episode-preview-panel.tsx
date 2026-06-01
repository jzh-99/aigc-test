'use client'

import { Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ShortDramaEpisode, ShortDramaState } from '@aigc/types'

interface EpisodePreviewPanelProps {
  episode: ShortDramaEpisode
  state: ShortDramaState
  onExport: () => void
  exporting: boolean
  onBatchGenerateVideos: () => void
  batchGenerating: boolean
}

export function EpisodePreviewPanel({
  episode,
  state,
  onExport,
  exporting,
  onBatchGenerateVideos,
  batchGenerating,
}: EpisodePreviewPanelProps) {
  const segments = episode.segments
  const completedSegments = segments.filter(s => !!s.videoUrl)
  const pendingVideoCount = segments.filter(s => !s.videoUrl && s.status !== 'pending' && s.status !== 'generating').length
  const missingCount = segments.length - completedSegments.length

  const exportBatch = state.exports.batches.find(b =>
    b.episodeNumbers.includes(episode.episodeNumber)
  )
  const episodeExport = exportBatch?.exports.find(e => e.episodeNumber === episode.episodeNumber)

  return (
    <aside className="rounded-2xl border bg-card/80 p-3">
      <h3 className="text-sm font-semibold">预览与导出</h3>

      <div className="mt-4 space-y-2">
        {completedSegments.length > 0 ? (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {completedSegments.map((segment, i) => (
              <div key={segment.id} className="overflow-hidden rounded-xl border bg-background/50">
                <video
                  src={segment.videoUrl!}
                  className="w-full aspect-video bg-black"
                  controls
                  preload="metadata"
                />
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  分镜 {i + 1}: {segment.title}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂无已完成的视频</p>
        )}
      </div>

      {missingCount > 0 && (
        <p className="text-xs text-amber-600">
          还有 {missingCount} 个分镜未生成视频
        </p>
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

      {episodeExport && (
        <div className="text-xs space-y-1">
          <div>导出状态：{episodeExport.status}</div>
          {episodeExport.videoUrl && (
            <a
              href={episodeExport.videoUrl}
              download
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" />下载导出视频
            </a>
          )}
          {episodeExport.errorMessage && (
            <p className="text-red-500">{episodeExport.errorMessage}</p>
          )}
        </div>
      )}

      {missingCount === 0 && segments.length > 0 && (
        <Button size="sm" onClick={onExport} disabled={exporting} className="w-full">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}
          导出本集
        </Button>
      )}
    </aside>
  )
}
