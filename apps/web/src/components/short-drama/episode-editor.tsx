'use client'

import { useState, useCallback } from 'react'
import { randomUUID } from 'crypto'
import { toast } from 'sonner'
import type { ShortDramaState, ShortDramaEpisode, ShortDramaSegment } from '@aigc/types'
import { SegmentList } from './segment-list'
import { AssetLibraryPanel } from './asset-library-panel'
import { EpisodePreviewPanel } from './episode-preview-panel'
import {
  saveShortDramaProject,
  generateShortDramaSegmentVideo,
  exportShortDramaEpisode,
} from '@/lib/short-drama/api'

interface EpisodeEditorProps {
  projectId: string
  episode: ShortDramaEpisode
  state: ShortDramaState
  onStateChange: () => void
}

export function EpisodeEditor({ projectId, episode, state, onStateChange }: EpisodeEditorProps) {
  const [generatingSegmentId, setGeneratingSegmentId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const handleSegmentUpdate = useCallback(async (index: number, updated: ShortDramaSegment) => {
    const newSegments = [...episode.segments]
    newSegments[index] = updated
    const newEpisodes = state.episodes.items.map(ep =>
      ep.episodeNumber === episode.episodeNumber
        ? { ...ep, segments: newSegments }
        : ep
    )
    try {
      await saveShortDramaProject(projectId, {
        state: { ...state, episodes: { ...state.episodes, items: newEpisodes } },
      })
      onStateChange()
    } catch (err) {
      toast.error('保存失败')
    }
  }, [projectId, episode, state, onStateChange])

  const handleSegmentAdd = useCallback(async () => {
    const newSegment: ShortDramaSegment = {
      id: crypto.randomUUID(),
      order: episode.segments.length,
      title: `分镜 ${episode.segments.length + 1}`,
      prompt: '',
      mentionRefs: [],
      durationSeconds: 4,
      videoUrl: null,
      status: 'idle',
    }
    const newSegments = [...episode.segments, newSegment]
    const newEpisodes = state.episodes.items.map(ep =>
      ep.episodeNumber === episode.episodeNumber
        ? { ...ep, segments: newSegments }
        : ep
    )
    try {
      await saveShortDramaProject(projectId, {
        state: { ...state, episodes: { ...state.episodes, items: newEpisodes } },
      })
      onStateChange()
    } catch (err) {
      toast.error('添加失败')
    }
  }, [projectId, episode, state, onStateChange])

  const handleSegmentDelete = useCallback(async (index: number) => {
    const newSegments = episode.segments.filter((_, i) => i !== index)
    const newEpisodes = state.episodes.items.map(ep =>
      ep.episodeNumber === episode.episodeNumber
        ? { ...ep, segments: newSegments }
        : ep
    )
    try {
      await saveShortDramaProject(projectId, {
        state: { ...state, episodes: { ...state.episodes, items: newEpisodes } },
      })
      onStateChange()
    } catch (err) {
      toast.error('删除失败')
    }
  }, [projectId, episode, state, onStateChange])

  const handleSegmentMove = useCallback(async (from: number, to: number) => {
    if (to < 0 || to >= episode.segments.length) return
    const newSegments = [...episode.segments]
    const [moved] = newSegments.splice(from, 1)
    newSegments.splice(to, 0, moved)
    const reordered = newSegments.map((s, i) => ({ ...s, order: i }))
    const newEpisodes = state.episodes.items.map(ep =>
      ep.episodeNumber === episode.episodeNumber
        ? { ...ep, segments: reordered }
        : ep
    )
    try {
      await saveShortDramaProject(projectId, {
        state: { ...state, episodes: { ...state.episodes, items: newEpisodes } },
      })
      onStateChange()
    } catch (err) {
      toast.error('移动失败')
    }
  }, [projectId, episode, state, onStateChange])

  const handleGenerateVideo = useCallback(async (segmentId: string) => {
    setGeneratingSegmentId(segmentId)
    try {
      await generateShortDramaSegmentVideo(projectId, episode.episodeNumber, segmentId)
      onStateChange()
      toast.success('视频生成已提交')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingSegmentId(null)
    }
  }, [projectId, episode.episodeNumber, onStateChange])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      await exportShortDramaEpisode(projectId, episode.episodeNumber)
      onStateChange()
      toast.success('导出已提交')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }, [projectId, episode.episodeNumber, onStateChange])

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-3">
        <AssetLibraryPanel assets={state.assets.items} episodeNumber={episode.episodeNumber} />
      </div>

      <div className="col-span-6">
        <SegmentList
          segments={episode.segments}
          assets={state.assets.items}
          onSegmentUpdate={handleSegmentUpdate}
          onSegmentAdd={handleSegmentAdd}
          onSegmentDelete={handleSegmentDelete}
          onSegmentMove={handleSegmentMove}
          onGenerateVideo={handleGenerateVideo}
          generatingSegmentId={generatingSegmentId}
        />
      </div>

      <div className="col-span-3">
        <EpisodePreviewPanel
          episode={episode}
          state={state}
          onExport={handleExport}
          exporting={exporting}
        />
      </div>
    </div>
  )
}
