'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { MusicCreatePanel } from '@/components/music/music-create-panel'
import { MusicTrackList } from '@/components/music/music-track-list'
import { MusicVoiceUploadDialog } from '@/components/music/music-voice-upload-dialog'
import { useMusicTrackEvents, useMusicTracks, useMusicVoiceCloneEvents, useMusicVoiceClones, type MusicVoiceCloneSseEvent } from '@/hooks/use-music'
import { useAuthStore } from '@/stores/auth-store'
import type { MusicSseEvent, MusicTrackResponse } from '@aigc/types'
import type { MusicTrackListResponse } from '@/lib/music/api'

/** 默认每页数量 */
const DEFAULT_PAGE_SIZE = 10

interface VoiceCloneWatchItem {
  id: string
  name: string
}

interface MusicTrackWatchItem {
  id: string
  title: string
}

/** 更新当前页中指定 track，或将其插入到首页顶部 */
function upsertTrackInPage(
  data: MusicTrackListResponse | undefined,
  track: MusicTrackResponse,
): MusicTrackListResponse | undefined {
  if (!data) return data
  const exists = data.data.some((item) => item.id === track.id)
  const nextData = exists
    ? data.data.map((item) => (item.id === track.id ? track : item))
    : [track, ...data.data]
  return { ...data, data: nextData, total: data.total + (exists ? 0 : 1) }
}

function MusicTrackWatcher({
  id,
  title,
  onEvent,
}: {
  id: string
  title: string
  onEvent: (event: MusicSseEvent) => void
}) {
  const handleEvent = useCallback((event: MusicSseEvent) => {
    if (event.event === 'completed') toast.success(`音乐「${title}」生成完成`)
    if (event.event === 'failed') toast.error(`音乐「${title}」生成失败：${event.error_message ?? '请稍后重试'}`)
    onEvent(event)
  }, [onEvent, title])

  useMusicTrackEvents(id, handleEvent)
  return null
}

function MusicVoiceCloneWatcher({
  id,
  name,
  onDone,
}: {
  id: string
  name: string
  onDone: (id: string) => void
}) {
  const handleEvent = useCallback((event: MusicVoiceCloneSseEvent) => {
    if (event.event === 'ready') {
      toast.success(`音色「${name}」克隆完成`)
      onDone(id)
    } else if (event.event === 'failed') {
      toast.error(`音色「${name}」克隆失败：${event.error_message ?? '请稍后重试'}`)
      onDone(id)
    }
  }, [id, name, onDone])

  useMusicVoiceCloneEvents(id, handleEvent)
  return null
}

export default function MusicPage() {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false)
  const [watchedVoiceCloneIds, setWatchedVoiceCloneIds] = useState<string[]>([])

  // 分页状态
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const tracks = useMusicTracks(page, pageSize)
  const voices = useMusicVoiceClones()
  const mutateVoices = voices.mutate

  const voiceCloneWatchItems = useMemo(() => {
    const voiceMap = new Map<string, VoiceCloneWatchItem>()
    for (const voice of voices.data?.data ?? []) {
      if (voice.status === 'pending' || voice.status === 'processing' || watchedVoiceCloneIds.includes(voice.id)) {
        voiceMap.set(voice.id, { id: voice.id, name: voice.name })
      }
    }
    for (const id of watchedVoiceCloneIds) {
      if (!voiceMap.has(id)) voiceMap.set(id, { id, name: '我的音色' })
    }
    return [...voiceMap.values()]
  }, [voices.data?.data, watchedVoiceCloneIds])

  const activeTrackWatchItems = useMemo(() => {
    const terminal = new Set(['completed', 'failed'])
    return tracks.tracks
      .filter((track) => !terminal.has(track.status))
      .map((track): MusicTrackWatchItem => ({ id: track.id, title: track.title ?? '未命名音乐' }))
  }, [tracks.tracks])

  const handleVoiceCloneDone = useCallback((id: string) => {
    setWatchedVoiceCloneIds((current) => current.filter((item) => item !== id))
    mutateVoices()
  }, [mutateVoices])

  const handleTrackEvent = useCallback((event: MusicSseEvent) => {
    if (event.track) {
      tracks.mutate(
        (data) => upsertTrackInPage(data, event.track as MusicTrackResponse),
        { revalidate: false },
      )
    }
    if (event.event === 'completed' || event.event === 'failed') {
      tracks.mutate()
    }
  }, [tracks])

  /** 切换页码 */
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  /** 切换每页数量时重置到第一页 */
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1)
  }, [])

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      {voiceCloneWatchItems.map((voice) => (
        <MusicVoiceCloneWatcher
          key={voice.id}
          id={voice.id}
          name={voice.name}
          onDone={handleVoiceCloneDone}
        />
      ))}
      {activeTrackWatchItems.map((track) => (
        <MusicTrackWatcher
          key={track.id}
          id={track.id}
          title={track.title}
          onEvent={handleTrackEvent}
        />
      ))}

      <div className="sticky top-[-1rem] z-30 flex h-16 items-center border-b bg-card/95 px-5 backdrop-blur md:top-[-1.5rem] md:px-8 dark:bg-card/95">
        <Link href="/toby-studio" className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回列表
        </Link>
      </div>

      <div className="grid gap-5 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
        <MusicCreatePanel
          voices={voices.data?.data ?? []}
          onOpenVoiceDialog={() => setVoiceDialogOpen(true)}
          onCreated={(track) => {
            tracks.mutate(
              (data) => upsertTrackInPage(data, track),
              { revalidate: false },
            )
          }}
        />

        <section className="rounded-xl border bg-background p-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">我的音乐作品</h2>
              <p className="mt-1 text-sm text-muted-foreground">点击封面进入详情页播放与查看歌词</p>
            </div>
          </div>
          <MusicTrackList
            tracks={tracks.tracks}
            isLoading={tracks.isLoadingInitial || tracks.isValidating}
            page={page}
            totalPages={tracks.totalPages}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </section>
      </div>

      {workspaceId && (
        <MusicVoiceUploadDialog
          open={voiceDialogOpen}
          workspaceId={workspaceId}
          onOpenChange={setVoiceDialogOpen}
          onCreated={(voiceClone) => {
            setWatchedVoiceCloneIds((current) => current.includes(voiceClone.id) ? current : [...current, voiceClone.id])
            mutateVoices()
          }}
        />
      )}
    </div>
  )
}
