'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { MusicTrackResponse } from '@aigc/types'

interface Props {
  track: MusicTrackResponse
  previousId?: string | null
  nextId?: string | null
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

export function MusicPlayer({ track, previousId, nextId }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const src = track.audio_url ?? track.stream_url ?? null
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const bars = useMemo(() => Array.from({ length: 36 }, (_, index) => 18 + ((index * 19) % 52)), [])

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [track.id])

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
    if (!audio || !duration) return
    audio.currentTime = duration * percent
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="aspect-square overflow-hidden rounded-xl bg-muted">
          {track.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.cover_url} alt={track.title ?? '音乐封面'} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">Toby AI</div>
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-center">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-normal">{track.title ?? '未命名音乐'}</h1>
            <p className="text-sm text-muted-foreground">
              作曲 Toby AI · 作词 {track.track_type === 'instrumental' ? '无歌词' : 'Toby AI'} · {track.model}
            </p>
          </div>

          <div className="my-8 flex h-20 items-center gap-1 overflow-hidden rounded-lg border bg-background px-4">
            {bars.map((height, index) => (
              <span key={index} className={playing ? 'w-1 rounded-full bg-primary/80 transition-all' : 'w-1 rounded-full bg-muted-foreground/35'} style={{ height }} />
            ))}
          </div>

          <audio
            ref={audioRef}
            src={src ?? undefined}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
            onEnded={() => setPlaying(false)}
          />

          <button type="button" className="w-full py-2" disabled={!src} onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            seek((event.clientX - rect.left) / rect.width)
          }}>
            <Progress value={progress} className="h-2" />
          </button>

          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <Button variant="outline" size="icon" disabled={!previousId} asChild={Boolean(previousId)}>
              {previousId ? <Link href={`/music/${previousId}`}><SkipBack className="h-4 w-4" /></Link> : <SkipBack className="h-4 w-4" />}
            </Button>
            <Button size="lg" className="h-14 w-14 rounded-full" disabled={!src} onClick={toggle}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button variant="outline" size="icon" disabled={!nextId} asChild={Boolean(nextId)}>
              {nextId ? <Link href={`/music/${nextId}`}><SkipForward className="h-4 w-4" /></Link> : <SkipForward className="h-4 w-4" />}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {track.audio_url && <span className="rounded-full border px-2 py-1">标准音质</span>}
            {track.flac_url && <span className="rounded-full border px-2 py-1">FLAC</span>}
            {track.wav_url && <span className="rounded-full border px-2 py-1">WAV</span>}
            {track.stream_url && !track.audio_url && <span className="rounded-full border px-2 py-1">生成中可播放</span>}
          </div>
        </div>
      </div>
    </section>
  )
}

