'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { MusicPlayer } from '@/components/music/music-player'
import { useMusicAdjacent, useMusicTrack, useMusicTrackEvents } from '@/hooks/use-music'
import type { MusicLyricWord, MusicLyricsSection } from '@aigc/types'

function displayLyrics(value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized) return '暂无歌词'
  return normalized
    .split(/\r?\n/)
    .map((line) => line.replace(/\s*\[(?:前奏|间奏|尾奏|主歌|副歌|桥段|导歌|预副歌|Intro|Verse|Chorus|Bridge|Outro)\]\s*/gi, '').trim())
    .filter(Boolean)
    .join('\n')
}

function displayLyricLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

interface TimelineLyricLine {
  start: number
  end: number
  text: string
  words: MusicLyricWord[]
}

function normalizeTimelineTime(value: number, shouldConvertMilliseconds: boolean) {
  return shouldConvertMilliseconds ? value / 1000 : value
}

function timelineLines(sections: MusicLyricsSection[] | null | undefined): TimelineLyricLine[] {
  if (!sections?.length) return []
  const maxTime = Math.max(
    0,
    ...sections.flatMap((section) => [
      section.start,
      section.end,
      ...section.lines.flatMap((line) => [line.start, line.end]),
    ]),
  )
  const shouldConvertMilliseconds = maxTime > 600
  return sections
    .flatMap((section) => section.lines.map((line) => ({
      start: normalizeTimelineTime(line.start, shouldConvertMilliseconds),
      end: normalizeTimelineTime(line.end, shouldConvertMilliseconds),
      text: line.text.trim(),
      words: (line.words ?? []).map((word) => ({
        start: normalizeTimelineTime(word.start, shouldConvertMilliseconds),
        end: normalizeTimelineTime(word.end, shouldConvertMilliseconds),
        text: word.text,
      })).filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end)),
    })))
    .filter((line) => line.text && Number.isFinite(line.start) && Number.isFinite(line.end) && line.end >= line.start)
    .sort((a, b) => a.start - b.start)
}

function activeTimelineWordIndex(currentTime: number, line: TimelineLyricLine | undefined) {
  if (!line?.words.length || !Number.isFinite(currentTime)) return -1
  const directIndex = line.words.findIndex((word) => currentTime >= word.start && currentTime < word.end)
  if (directIndex >= 0) return directIndex
  for (let index = line.words.length - 1; index >= 0; index -= 1) {
    if (currentTime >= line.words[index].start) return index
  }
  return -1
}

function LyricLineText({
  line,
  active,
  activeWordIndex,
}: {
  line: string | TimelineLyricLine
  active: boolean
  activeWordIndex: number
}) {
  if (typeof line === 'string' || !line.words.length) return <>{typeof line === 'string' ? line : line.text}</>
  return (
    <>
      {line.words.map((word, index) => (
        <span
          key={`${word.text}-${index}`}
          className={active && index <= activeWordIndex
            ? 'text-white drop-shadow-[0_0_16px_rgba(22,200,230,0.34)]'
            : active
              ? 'text-[#b8aaff]/52'
              : 'text-current'
          }
        >
          {word.text}
        </span>
      ))}
    </>
  )
}

function activeTimelineLyricIndex(currentTime: number, lines: TimelineLyricLine[]) {
  if (!lines.length || !Number.isFinite(currentTime)) return -1
  const directIndex = lines.findIndex((line) => currentTime >= line.start && currentTime < line.end)
  if (directIndex >= 0) return directIndex
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (currentTime >= lines[index].start) return index
  }
  return 0
}

export default function MusicDetailPage() {
  const params = useParams<{ id: string }>()
  const track = useMusicTrack(params.id)
  const adjacent = useMusicAdjacent(params.id)
  const lyricScrollRef = useRef<HTMLDivElement>(null)
  const lyricLineRefs = useRef<Array<HTMLParagraphElement | null>>([])
  const [playback, setPlayback] = useState({ currentTime: 0, duration: 0, playing: false })

  const handleEvent = useCallback((event: { track?: typeof track.data }) => {
    if (event.track) {
      track.mutate(event.track, { revalidate: false })
      return
    }
    track.mutate()
  }, [track])

  useMusicTrackEvents(params.id, handleEvent)

  const lyrics = track.data?.track_type === 'instrumental'
    ? '暂无歌词'
    : displayLyrics(track.data?.lyrics)
  const exactLyricLines = useMemo(() => timelineLines(track.data?.lyrics_sections), [track.data?.lyrics_sections])
  const fallbackLyricLines = useMemo(() => displayLyricLines(lyrics), [lyrics])
  const lyricLines = exactLyricLines.length ? exactLyricLines : fallbackLyricLines
  const currentLyricIndex = activeTimelineLyricIndex(playback.currentTime, exactLyricLines)
  const currentWordIndex = activeTimelineWordIndex(playback.currentTime, exactLyricLines[currentLyricIndex])
  const handlePlaybackChange = useCallback((state: { currentTime: number; duration: number; playing: boolean }) => {
    setPlayback(state)
  }, [])

  useEffect(() => {
    if (currentLyricIndex < 0) return
    const container = lyricScrollRef.current
    const activeLine = lyricLineRefs.current[currentLyricIndex]
    if (!container || !activeLine) return
    // 仅滚动歌词容器自身：scrollIntoView 会向上传播到页面根滚动容器，导致左侧播放器跟随滚动
    const containerRect = container.getBoundingClientRect()
    const lineRect = activeLine.getBoundingClientRect()
    const offset = lineRect.top - containerRect.top - (container.clientHeight - lineRect.height) / 2
    container.scrollTo({ top: container.scrollTop + offset, behavior: 'smooth' })
  }, [currentLyricIndex])

  if (track.error) {
    return <div className="rounded-xl border bg-card p-8 text-destructive">加载音乐详情失败</div>
  }

  if (!track.data) {
    return <div className="rounded-xl border bg-card p-8 text-muted-foreground">加载中...</div>
  }

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-5.25rem)] bg-[#070615] text-[#eeeaf8] md:-mx-6 md:-mt-6">
      <div className="sticky top-[-1rem] z-30 flex h-16 items-center border-b border-[#201b49] bg-[#0d1938] px-5 backdrop-blur md:top-[-1.5rem] md:px-8">
        <Link href="/toby-studio/music" className="inline-flex items-center gap-2 text-sm font-medium text-[#b8aaff] transition-colors hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          返回列表
        </Link>
      </div>

      <div className="grid min-h-[calc(100vh-9.25rem)] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="min-w-0 p-4 md:p-6">
          <MusicPlayer
            track={track.data}
            previousId={adjacent.data?.previous_id}
            nextId={adjacent.data?.next_id}
            onPlaybackChange={handlePlaybackChange}
          />

          <section className="mt-4 rounded-xl border border-[#201b49] bg-[#090817] p-5 shadow-sm">
            <p className="text-sm leading-7 text-[#9c94c4]">{track.data.prompt ?? '由 Toby AI 创作生成'}</p>
          </section>
        </div>

        <aside className="border-t border-[#201b49] bg-[#090817] lg:border-l lg:border-t-0">
          <div className="sticky top-0 flex max-h-[calc(100vh-5.25rem)] min-h-[calc(100vh-5.25rem)] flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_18%,rgba(22,200,230,0.12),transparent_28%),radial-gradient(circle_at_18%_8%,rgba(106,92,255,0.22),transparent_30%),linear-gradient(180deg,#151133_0%,#090817_48%,#05040d_100%)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-40 bg-gradient-to-b from-[#151133] via-[#151133]/82 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-44 bg-gradient-to-t from-[#05040d] via-[#05040d]/82 to-transparent" />
            <div className="relative z-20 px-8 pt-16 text-center">
              <h2 className="truncate text-2xl font-semibold tracking-normal text-[#f5f2ff]">{track.data.title ?? '未命名音乐'}</h2>
              <p className="mt-2 truncate text-base font-medium text-[#9c94c4]">{track.data.voice_name ?? 'Toby AI'}</p>
            </div>
            <div ref={lyricScrollRef} className="relative z-0 mt-8 flex-1 overflow-y-auto scroll-smooth px-5 pb-32 pt-24 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="mx-auto flex max-w-[32rem] flex-col items-center gap-9 text-center text-[22px] font-semibold leading-[1.45] tracking-normal text-[#8f88b8]">
              {lyricLines.map((line, index) => {
                const text = typeof line === 'string' ? line : line.text
                const active = index === currentLyricIndex
                const distance = currentLyricIndex >= 0 ? Math.abs(index - currentLyricIndex) : 2
                return (
                <p
                  key={`${text}-${index}`}
                  ref={(node) => {
                    lyricLineRefs.current[index] = node
                  }}
                  className={active
                    ? 'max-w-full scale-110 px-2 text-[30px] font-bold leading-[1.35] text-[#f7f4ff] drop-shadow-[0_0_24px_rgba(22,200,230,0.18)] transition-all duration-500'
                    : distance === 1
                      ? 'max-w-full px-2 text-[#b8aaff]/68 transition-all duration-500'
                      : 'max-w-full px-2 text-[#8178aa]/36 transition-all duration-500'
                  }
                >
                  <LyricLineText line={line} active={active} activeWordIndex={currentWordIndex} />
                </p>
                )
              })}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
