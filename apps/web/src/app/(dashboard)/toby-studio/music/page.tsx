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

interface VoiceCloneWatchItem {
  id: string
  name: string
}

interface MusicTrackWatchItem {
  id: string
  title: string
}

function upsertTrackPages(
  pages: MusicTrackListResponse[] | undefined,
  track: MusicTrackResponse,
): MusicTrackListResponse[] | undefined {
  if (!pages?.length) return pages
  let found = false
  const nextPages = pages.map((page, pageIndex) => {
    const nextData = page.data.map((item) => {
      if (item.id !== track.id) return item
      found = true
      return track
    })
    if (!found && pageIndex === 0) {
      return { ...page, data: [track, ...nextData] }
    }
    return { ...page, data: nextData }
  })
  return nextPages
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
  const tracks = useMusicTracks()
  const voices = useMusicVoiceClones()
  const mutateVoices = voices.mutate
  const lastPage = tracks.data?.[tracks.data.length - 1]
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
      tracks.mutate((pages) => upsertTrackPages(pages, event.track as MusicTrackResponse), { revalidate: false })
    }
    if (event.event === 'completed' || event.event === 'failed') {
      tracks.mutate()
    }
  }, [tracks])

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
            tracks.mutate((pages) => upsertTrackPages(pages, track), { revalidate: false })
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
            hasMore={Boolean(lastPage?.cursor)}
            onLoadMore={() => tracks.setSize(tracks.size + 1)}
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
