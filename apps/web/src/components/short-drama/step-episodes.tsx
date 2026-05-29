'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Download, Play, Film } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ShortDramaState } from '@aigc/types'
import { exportShortDramaBatch } from '@/lib/short-drama/api'

interface StepEpisodesProps {
  projectId: string
  state: ShortDramaState
  onStateChange: () => void
}

export function StepEpisodes({ projectId, state, onStateChange }: StepEpisodesProps) {
  const [exporting, setExporting] = useState(false)

  const episodes = state.episodes.items
  const completedCount = episodes.filter(ep => ep.status === 'completed').length
  const exportableCount = episodes.filter(ep =>
    ep.segments.length > 0 && ep.segments.every(s => !!s.videoUrl)
  ).length

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
          共 {episodes.length} 集 · 已完成 {completedCount} · 可导出 {exportableCount}
        </div>
        {exportableCount > 0 && (
          <Button size="sm" onClick={handleBatchExport} disabled={exporting}>
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}
            批量导出 ({exportableCount})
          </Button>
        )}
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
            const hasAllVideos = segmentCount > 0 && episode.segments.every(s => !!s.videoUrl)

            return (
              <div key={episode.episodeNumber} className="p-4 rounded-lg border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Film className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-sm">
                        第 {episode.episodeNumber} 集：{episode.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {segmentCount} 个分镜 · {completedSegments} 已完成
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
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
