'use client'

import Link from 'next/link'
import { Music2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { MusicTrackResponse } from '@aigc/types'

interface Props {
  tracks: MusicTrackResponse[]
  isLoading?: boolean
  onLoadMore?: () => void
  hasMore?: boolean
}

function statusText(status: MusicTrackResponse['status']) {
  const map: Record<MusicTrackResponse['status'], string> = {
    pending: '排队中',
    lyrics_generating: '生成歌词',
    song_generating: '生成音乐',
    cover_generating: '生成封面',
    transferring: '转存中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status]
}

function trackTypeText(trackType: MusicTrackResponse['track_type']) {
  return trackType === 'instrumental' ? '纯音乐' : '歌曲'
}

function creatorText(trackType: MusicTrackResponse['track_type']) {
  return trackType === 'instrumental' ? '作曲' : '作词作曲'
}

export function MusicTrackList({ tracks, isLoading, onLoadMore, hasMore }: Props) {
  if (!isLoading && tracks.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border bg-card text-center text-muted-foreground">
        <Music2 className="mb-3 h-10 w-10" />
        <div className="text-base">还没有音乐哦，快去创作吧</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tracks.map((track) => (
        <Link
          key={track.id}
          href={`/toby-studio/music/${track.id}`}
          className="grid grid-cols-[76px_1fr_auto] items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/70"
        >
          <div className="aspect-square overflow-hidden rounded-lg bg-muted">
            {track.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.cover_url} alt={track.title ?? '音乐封面'} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center"><Music2 className="h-6 w-6 text-muted-foreground" /></div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{track.title ?? '未命名音乐'}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {trackTypeText(track.track_type)} · {track.voice_name ?? 'Toby AI'} · {creatorText(track.track_type)}
            </div>
          </div>
          <Badge variant={track.status === 'failed' ? 'destructive' : track.status === 'completed' ? 'default' : 'secondary'}>
            {statusText(track.status)}
          </Badge>
        </Link>
      ))}
      {hasMore && (
        <Button type="button" variant="outline" className="w-full" onClick={onLoadMore} disabled={isLoading}>
          {isLoading ? '加载中...' : '加载更多'}
        </Button>
      )}
    </div>
  )
}
