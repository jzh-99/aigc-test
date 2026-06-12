'use client'

import Link from 'next/link'
import { AlertCircle, Music2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MusicDownloadMenu } from './music-download-menu'
import type { MusicTrackResponse } from '@aigc/types'
import { useNavigationStore } from '@/stores/navigation-store'

interface Props {
  tracks: MusicTrackResponse[]
  isLoading?: boolean
  /** 当前页码 */
  page: number
  /** 总页数 */
  totalPages: number
  /** 每页数量 */
  pageSize: number
  /** 页码变化回调 */
  onPageChange: (page: number) => void
  /** 每页数量变化回调 */
  onPageSizeChange: (pageSize: number) => void
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

/** Mureka 官方错误码 → 用户友好中文提示 */
function friendlyErrorMessage(message: string): string {
  const msg = message.toLowerCase()
  if (msg.includes('451') || msg.includes('legal') || msg.includes('安审')) {
    return '内容未通过安全审核，请修改后重试'
  }
  if (msg.includes('429') && (msg.includes('quota') || msg.includes('billing'))) {
    return 'API 配额已用尽，请联系管理员'
  }
  if (msg.includes('429') || msg.includes('rate limit')) {
    return '请求过于频繁，请稍后重试'
  }
  if (msg.includes('400') || msg.includes('invalid request')) {
    return '请求参数异常，请检查输入内容'
  }
  if (msg.includes('401') || msg.includes('authentication')) {
    return 'API 认证失效，请联系管理员'
  }
  if (msg.includes('403') || msg.includes('forbidden')) {
    return '地区访问受限，请联系管理员'
  }
  if (msg.includes('500') || msg.includes('server error')) {
    return 'AI 服务暂时异常，请稍后重试'
  }
  if (msg.includes('503') || msg.includes('overloaded')) {
    return 'AI 服务繁忙，请稍后重试'
  }
  // 轮询超时等内部错误
  if (msg.includes('超时') || msg.includes('timeout')) {
    return '生成超时，请稍后重试'
  }
  // 封面生成失败但音乐已生成
  if (msg.includes('封面')) {
    return '封面生成失败，音乐已保存'
  }
  return message
}

export function MusicTrackList({
  tracks,
  isLoading,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const startNavigation = useNavigationStore((s) => s.startNavigation)
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
      <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
        {tracks.map((track) => (
          <div
            key={track.id}
            className="grid grid-cols-[76px_1fr_auto] items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/70"
          >
          <Link href={`/toby-studio/music/${track.id}`} className="aspect-square overflow-hidden rounded-lg bg-muted" onClick={() => startNavigation(`/toby-studio/music/${track.id}`)}>
            {track.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.cover_url} alt={track.title ?? '音乐封面'} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center"><Music2 className="h-6 w-6 text-muted-foreground" /></div>
            )}
          </Link>
          <Link href={`/toby-studio/music/${track.id}`} className="min-w-0" onClick={() => startNavigation(`/toby-studio/music/${track.id}`)}>
            <div className="truncate font-medium">{track.title ?? '未命名音乐'}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {trackTypeText(track.track_type)} · {track.voice_name ?? 'Toby AI'} · {creatorText(track.track_type)}
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {track.status === 'failed' && track.error_message && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="h-4 w-4 shrink-0 cursor-help text-destructive" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p>{friendlyErrorMessage(track.error_message)}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Badge variant={track.status === 'failed' ? 'destructive' : track.status === 'completed' ? 'default' : 'secondary'}>
              {statusText(track.status)}
            </Badge>
            <MusicDownloadMenu track={track} variant="ghost" size="sm" compact className="h-8 w-8 p-0" />
          </div>
          </div>
        ))}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  )
}
