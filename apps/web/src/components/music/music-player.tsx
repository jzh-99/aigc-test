'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { MusicDownloadMenu } from './music-download-menu'
import type { MusicTrackResponse } from '@aigc/types'

interface Props {
  track: MusicTrackResponse
  previousId?: string | null
  nextId?: string | null
  onPlaybackChange?: (state: { currentTime: number; duration: number; playing: boolean }) => void
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

export function MusicPlayer({ track, previousId, nextId, onPlaybackChange }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const src = track.audio_url ?? track.stream_url ?? null
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const canSeek = track.status === 'completed' && Boolean(src) && duration > 0
  const metaItems = track.track_type === 'instrumental'
    ? ['作曲：Toby AI']
    : ['作曲：Toby AI', `演唱：${track.voice_name ?? 'Toby AI'}`]

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    onPlaybackChange?.({ currentTime: 0, duration: 0, playing: false })
  }, [onPlaybackChange, track.id])

  useEffect(() => {
    onPlaybackChange?.({ currentTime, duration, playing })
  }, [currentTime, duration, onPlaybackChange, playing])

  async function toggle() {
    const audio = audioRef.current
    if (!audio || !src) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    await audio.play()
    setPlaying(true)
  }

  function seek(percent: number) {
    const audio = audioRef.current
    if (!audio || !canSeek) return
    const nextTime = duration * Math.min(1, Math.max(0, percent))
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  return (
    <section className="relative flex min-h-[620px] flex-col items-center justify-center overflow-hidden rounded-xl border bg-card px-5 py-10 text-center shadow-sm sm:px-8 lg:min-h-[calc(100vh-9.5rem)] dark:border-white/10 dark:bg-[#090817] dark:shadow-[0_24px_90px_rgba(0,0,0,0.28)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(107,163,245,0.14),transparent_32%),linear-gradient(180deg,rgba(200,155,236,0.10),transparent_38%)] dark:bg-[radial-gradient(circle_at_center,rgba(72,63,156,0.24),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_38%)]" />
      <div className="relative flex w-full max-w-[560px] flex-col items-center">
        <div className="relative mb-9 h-56 w-56 overflow-hidden rounded-full border-[6px] border-primary/25 bg-muted shadow-[0_22px_70px_rgba(107,163,245,0.18)] sm:h-64 sm:w-64 dark:border-[#221f59] dark:bg-[#141128] dark:shadow-[0_22px_70px_rgba(31,28,88,0.58)]">
          {track.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.cover_url} alt={track.title ?? '音乐封面'} className={playing ? 'h-full w-full object-cover motion-safe:animate-spin motion-safe:[animation-duration:18s]' : 'h-full w-full object-cover'} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground dark:text-[#d8d4e8]/70">Toby AI</div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,transparent_0_50%,rgba(0,0,0,0.20)_70%)]" />
          <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-card/85 shadow-inner dark:border-white/15 dark:bg-[#090817]/85" />
        </div>

        <h1 className="max-w-xl text-balance text-2xl font-semibold leading-tight tracking-normal text-foreground sm:text-3xl dark:text-white">{track.title ?? '未命名音乐'}</h1>
        <p className="mt-4 text-base font-medium text-muted-foreground dark:text-[#d8d4e8]/85">{metaItems.join('   ')}</p>

        <audio
          ref={audioRef}
          src={src ?? undefined}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onEnded={() => setPlaying(false)}
        />

        <button type="button" className="group mt-10 w-full py-2 disabled:cursor-not-allowed" disabled={!canSeek} aria-label={canSeek ? '拖动播放进度' : '生成完成后可拖动播放进度'} onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          seek((event.clientX - rect.left) / rect.width)
        }}>
          <Progress value={progress} className="h-1.5 bg-muted transition-all group-hover:h-2 [&>div]:bg-[linear-gradient(90deg,#6ba3f5,#c89bec)] dark:bg-[#201a52] dark:[&>div]:bg-[linear-gradient(90deg,#6654ff,#16c8e6)]" />
        </button>

        <div className="mt-2 flex w-full justify-between text-sm text-muted-foreground dark:text-[#d8d4e8]/80">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="mt-7 flex items-center justify-center gap-7">
          <Button variant="outline" size="icon" disabled={!previousId} asChild={Boolean(previousId)} title="上一首" aria-label="上一首" className="h-14 w-14 rounded-full bg-card text-foreground shadow-sm hover:bg-accent disabled:opacity-40 dark:border-[#2b2667] dark:bg-[#11102a]/85 dark:text-[#d8d4e8] dark:hover:bg-[#191642] dark:hover:text-white">
            {previousId ? <Link href={`/toby-studio/music/${previousId}`}><SkipBack className="h-5 w-5" /></Link> : <SkipBack className="h-5 w-5" />}
          </Button>
          <Button
            size="lg"
            className="h-20 w-20 rounded-full bg-[linear-gradient(135deg,#6a5cff,#10c7df)] text-white shadow-[0_18px_45px_rgba(18,190,224,0.26)] hover:brightness-110 disabled:shadow-none"
            disabled={!src}
            onClick={toggle}
            title={src ? playing ? '暂停' : '播放' : '暂无可播放音频'}
            aria-label={src ? playing ? '暂停' : '播放' : '暂无可播放音频'}
          >
            {playing ? <Pause className="h-9 w-9" /> : <Play className="ml-1 h-9 w-9 fill-current" />}
          </Button>
          <Button variant="outline" size="icon" disabled={!nextId} asChild={Boolean(nextId)} title="下一首" aria-label="下一首" className="h-14 w-14 rounded-full bg-card text-foreground shadow-sm hover:bg-accent disabled:opacity-40 dark:border-[#2b2667] dark:bg-[#11102a]/85 dark:text-[#d8d4e8] dark:hover:bg-[#191642] dark:hover:text-white">
            {nextId ? <Link href={`/toby-studio/music/${nextId}`}><SkipForward className="h-5 w-5" /></Link> : <SkipForward className="h-5 w-5" />}
          </Button>
        </div>

        <p className="mt-4 min-h-5 text-xs text-muted-foreground dark:text-[#d8d4e8]/55">{src ? playing ? '正在播放' : '准备播放' : '暂无可播放音频'}</p>

        <MusicDownloadMenu track={track} className="mt-5 rounded-full border-primary/25 bg-card/70 shadow-sm hover:border-primary/45 hover:bg-primary/10 dark:border-[#2b2667] dark:bg-[#11102a]/85 dark:text-[#d8d4e8] dark:hover:bg-[#191642]" />
      </div>
    </section>
  )
}
