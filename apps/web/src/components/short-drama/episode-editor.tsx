'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
  videoModel: string
  videoResolution: '720p' | '1080p'
  onStateChange: (state?: ShortDramaState) => void | Promise<unknown>
}

export function EpisodeEditor({
  projectId,
  episode,
  state,
  videoModel,
  videoResolution,
  onStateChange,
}: EpisodeEditorProps) {
  const [generatingSegmentId, setGeneratingSegmentId] = useState<string | null>(null)
  const [batchGeneratingVideos, setBatchGeneratingVideos] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0)

  // 收集当前集所有分镜中引用的素材 ID，用于"本集"过滤
  const episodeMentionedAssetIds = useMemo(() => {
    const ids = new Set<string>()
    for (const segment of episode.segments) {
      for (const ref of segment.mentionRefs) {
        ids.add(ref.assetId)
      }
    }
    return ids
  }, [episode.segments])

  const buildStateWithSegmentStatuses = useCallback((segmentIds: string[], status: ShortDramaSegment['status']) => {
    const segmentIdSet = new Set(segmentIds)
    const now = new Date().toISOString()
    const nextEpisodes = state.episodes.items.map(ep => {
      if (ep.episodeNumber !== episode.episodeNumber) return ep
      return {
        ...ep,
        status: status === 'generating' || status === 'pending' ? 'generating' as const : ep.status,
        updatedAt: now,
        segments: ep.segments.map(segment =>
          segmentIdSet.has(segment.id)
            ? { ...segment, videoUrl: null, status }
            : segment
        ),
      }
    })
    return {
      ...state,
      episodes: {
        ...state.episodes,
        status: status === 'generating' || status === 'pending' ? 'generating' as const : state.episodes.status,
        items: nextEpisodes,
      },
    }
  }, [episode.episodeNumber, state])

  useEffect(() => {
    if (selectedSegmentIndex >= episode.segments.length) {
      setSelectedSegmentIndex(Math.max(0, episode.segments.length - 1))
    }
  }, [episode.segments.length, selectedSegmentIndex])

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
      setSelectedSegmentIndex(index)
      onStateChange()
    } catch (err) {
      toast.error('保存失败')
    }
  }, [projectId, episode, state, onStateChange])

  const handleSegmentAdd = useCallback(async (afterIndex?: number) => {
    const insertAt = afterIndex !== undefined ? afterIndex + 1 : episode.segments.length
    const newSegment: ShortDramaSegment = {
      id: crypto.randomUUID(),
      order: insertAt,
      title: `分镜 ${episode.segments.length + 1}`,
      prompt: '',
      mentionRefs: [],
      durationSeconds: 10,
      videoUrl: null,
      status: 'idle',
    }
    const newSegments = [
      ...episode.segments.slice(0, insertAt),
      newSegment,
      ...episode.segments.slice(insertAt),
    ].map((s, i) => ({ ...s, order: i }))
    const newEpisodes = state.episodes.items.map(ep =>
      ep.episodeNumber === episode.episodeNumber
        ? { ...ep, segments: newSegments }
        : ep
    )
    try {
      await saveShortDramaProject(projectId, {
        state: { ...state, episodes: { ...state.episodes, items: newEpisodes } },
      })
      setSelectedSegmentIndex(insertAt)
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
      setSelectedSegmentIndex(prev => Math.min(prev, Math.max(0, newSegments.length - 1)))
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
      setSelectedSegmentIndex(to)
      onStateChange()
    } catch (err) {
      toast.error('移动失败')
    }
  }, [projectId, episode, state, onStateChange])

  const handleGenerateVideo = useCallback(async (segmentId: string) => {
    setGeneratingSegmentId(segmentId)
    await Promise.resolve(onStateChange(buildStateWithSegmentStatuses([segmentId], 'generating')))
    try {
      const result = await generateShortDramaSegmentVideo(projectId, episode.episodeNumber, segmentId, {
        model: videoModel,
        resolution: videoResolution,
      })
      await Promise.resolve(onStateChange(result.state))
      toast.success('视频生成已提交')
    } catch (err) {
      await Promise.resolve(onStateChange(buildStateWithSegmentStatuses([segmentId], 'failed')))
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingSegmentId(null)
    }
  }, [projectId, episode.episodeNumber, videoModel, videoResolution, buildStateWithSegmentStatuses, onStateChange])

  const handleBatchGenerateVideos = useCallback(async () => {
    const targets = episode.segments.filter(segment =>
      !segment.videoUrl &&
      segment.status !== 'pending' &&
      segment.status !== 'generating'
    )

    if (targets.length === 0) {
      toast.info('没有需要生成的视频')
      return
    }

    setBatchGeneratingVideos(true)
    await Promise.resolve(onStateChange(buildStateWithSegmentStatuses(targets.map(segment => segment.id), 'pending')))
    let submittedCount = 0
    const failedSegmentIds: string[] = []
    try {
      for (const segment of targets) {
        setGeneratingSegmentId(segment.id)
        try {
          const result = await generateShortDramaSegmentVideo(projectId, episode.episodeNumber, segment.id, {
            model: videoModel,
            resolution: videoResolution,
          })
          submittedCount += 1
          await Promise.resolve(onStateChange(result.state))
        } catch {
          failedSegmentIds.push(segment.id)
        }
      }

      if (failedSegmentIds.length > 0) {
        await Promise.resolve(onStateChange(buildStateWithSegmentStatuses(failedSegmentIds, 'failed')))
      }
      if (submittedCount > 0) {
        toast.success(`已提交 ${submittedCount} 个分镜视频生成`)
      }
      if (failedSegmentIds.length > 0) {
        toast.error(`${failedSegmentIds.length} 个分镜视频提交失败，请稍后重试`)
      }
    } finally {
      setGeneratingSegmentId(null)
      setBatchGeneratingVideos(false)
    }
  }, [projectId, episode.episodeNumber, episode.segments, videoModel, videoResolution, buildStateWithSegmentStatuses, onStateChange])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      await exportShortDramaEpisode(projectId, episode.episodeNumber)
      await Promise.resolve(onStateChange())
      toast.success('导出已提交')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }, [projectId, episode.episodeNumber, onStateChange])

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 lg:col-span-3">
        <AssetLibraryPanel
          assets={state.assets.items}
          episodeNumber={episode.episodeNumber}
          projectId={projectId}
          episodeMentionedAssetIds={episodeMentionedAssetIds}
          onStateChange={() => onStateChange()}
        />
      </div>

      <div className="col-span-12 lg:col-span-6">
        <SegmentList
          segments={episode.segments}
          assets={state.assets.items}
          aspectRatio={state.settings.aspectRatio}
          selectedIndex={selectedSegmentIndex}
          onSelectSegment={setSelectedSegmentIndex}
          onSegmentUpdate={handleSegmentUpdate}
          onSegmentAdd={handleSegmentAdd}
          onSegmentDelete={handleSegmentDelete}
          onSegmentMove={handleSegmentMove}
          onGenerateVideo={handleGenerateVideo}
          generatingSegmentId={generatingSegmentId}
        />
      </div>

      <div className="col-span-12 lg:col-span-3">
        <EpisodePreviewPanel
          episode={episode}
          state={state}
          onExport={handleExport}
          exporting={exporting}
          onBatchGenerateVideos={handleBatchGenerateVideos}
          batchGenerating={batchGeneratingVideos}
          selectedSegmentIndex={selectedSegmentIndex}
          onSelectSegment={setSelectedSegmentIndex}
        />
      </div>
    </div>
  )
}
