'use client'

import { useCallback } from 'react'
import { useParams } from 'next/navigation'
import { MusicPlayer } from '@/components/music/music-player'
import { Badge } from '@/components/ui/badge'
import { useMusicAdjacent, useMusicTrack, useMusicTrackEvents } from '@/hooks/use-music'

export default function MusicDetailPage() {
  const params = useParams<{ id: string }>()
  const track = useMusicTrack(params.id)
  const adjacent = useMusicAdjacent(params.id)

  const handleEvent = useCallback(() => {
    track.mutate()
  }, [track])

  useMusicTrackEvents(params.id, handleEvent)

  if (track.error) {
    return <div className="rounded-xl border bg-card p-8 text-destructive">加载音乐详情失败</div>
  }

  if (!track.data) {
    return <div className="rounded-xl border bg-card p-8 text-muted-foreground">加载中...</div>
  }

  const lyrics = track.data.track_type === 'instrumental'
    ? '暂无歌词'
    : track.data.lyrics?.trim() || '暂无歌词'

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <MusicPlayer
          track={track.data}
          previousId={adjacent.data?.previous_id}
          nextId={adjacent.data?.next_id}
        />
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge variant="secondary">{track.data.track_type === 'instrumental' ? '纯音乐' : '歌曲'}</Badge>
            <Badge variant="secondary">{track.data.voice_name ?? 'Toby AI'}</Badge>
            {track.data.styles.map((style) => <Badge key={style} variant="outline">{style}</Badge>)}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{track.data.prompt ?? '由 Toby AI 创作生成'}</p>
        </section>
      </div>

      <aside className="rounded-xl border bg-card p-5 xl:sticky xl:top-5 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">歌词</h2>
          <Badge variant={track.data.status === 'completed' ? 'default' : 'secondary'}>{track.data.status}</Badge>
        </div>
        <div className="whitespace-pre-line text-sm leading-8 text-muted-foreground">
          {lyrics}
        </div>
      </aside>
    </div>
  )
}

