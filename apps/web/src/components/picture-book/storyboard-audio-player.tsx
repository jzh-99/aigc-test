'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StoryboardAudioPlayerProps {
  label: string
  src?: string | null
  loading?: boolean
  variant?: 'compact' | 'preview'
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

export function StoryboardAudioPlayer({ label, src, loading, variant = 'compact' }: StoryboardAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  useEffect(() => {
    setPlaying(false)
    setDuration(0)
    setCurrentTime(0)
  }, [src])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio || !src) return

    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }

    audio.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false))
  }

  const seek = (time: number) => {
    const audio = audioRef.current
    if (!audio || !src) return
    audio.currentTime = time
    setCurrentTime(time)
  }

  if (variant === 'preview') {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 shadow-inner shadow-primary/10">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/25 hover:bg-primary/90 hover:text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
            disabled={!src || loading}
            onClick={toggle}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </Button>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-foreground">{label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              disabled={!src}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: `linear-gradient(to right, hsl(var(--primary)) ${progress}%, hsl(var(--muted)) ${progress}%)` }}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </div>
        </div>
        {src ? (
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0 rounded-full"
        disabled={!src || loading}
        onClick={toggle}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <span className="w-8 shrink-0 rounded border bg-background px-1 text-center font-medium text-muted-foreground">{label}</span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        disabled={!src}
        className="h-1 min-w-0 flex-1 accent-primary disabled:opacity-40"
        onChange={(event) => seek(Number(event.target.value))}
      />
      <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground">{formatTime(duration)}</span>
      {src ? (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />
      ) : null}
    </div>
  )
}
