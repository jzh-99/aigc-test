'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MusicTrackResponse } from '@aigc/types'

interface Props {
  track: MusicTrackResponse
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'default'
  compact?: boolean
  className?: string
}

function safeDownloadName(title: string | null | undefined, extension: string): string {
  const base = (title ?? 'Toby AI 音乐')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 60) || 'Toby AI 音乐'
  return `${base}.${extension}`
}

export function MusicDownloadMenu({ track, variant = 'outline', size = 'default', compact = false, className }: Props) {
  const options = [
    { label: '普通下载', extension: 'mp3', url: track.audio_url },
    { label: '无损FLAC格式', extension: 'flac', url: track.flac_url },
    { label: '无损WAV格式', extension: 'wav', url: track.wav_url },
  ]
  const available = track.status === 'completed' && options.some((option) => Boolean(option.url))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={!available}
          className={className}
          title={available ? '下载音乐' : '生成成功后可下载'}
          aria-label={available ? '下载音乐' : '生成成功后可下载'}
        >
          <Download className={compact ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />
          {!compact && '下载'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((option) => option.url ? (
          <DropdownMenuItem key={option.extension} asChild>
            <a href={option.url} download={safeDownloadName(track.title, option.extension)} target="_blank" rel="noreferrer">
              {option.label}
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem key={option.extension} disabled>
            {option.label} 暂无
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
