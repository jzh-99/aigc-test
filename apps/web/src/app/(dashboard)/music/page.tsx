'use client'

import { useState } from 'react'
import { MusicCreatePanel } from '@/components/music/music-create-panel'
import { MusicTrackList } from '@/components/music/music-track-list'
import { MusicVoiceUploadDialog } from '@/components/music/music-voice-upload-dialog'
import { useMusicTracks, useMusicVoiceClones } from '@/hooks/use-music'
import { useAuthStore } from '@/stores/auth-store'

export default function MusicPage() {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false)
  const tracks = useMusicTracks()
  const voices = useMusicVoiceClones()
  const lastPage = tracks.data?.[tracks.data.length - 1]

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
      <MusicCreatePanel
        voices={voices.data?.data ?? []}
        onOpenVoiceDialog={() => setVoiceDialogOpen(true)}
        onCreated={() => tracks.mutate()}
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

      {workspaceId && (
        <MusicVoiceUploadDialog
          open={voiceDialogOpen}
          workspaceId={workspaceId}
          onOpenChange={setVoiceDialogOpen}
          onCreated={() => voices.mutate()}
        />
      )}
    </div>
  )
}

