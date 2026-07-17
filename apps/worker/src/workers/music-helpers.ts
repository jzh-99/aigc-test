import type { MusicLyricsSection, MusicMode, MusicTrackStatus, MusicTrackType, MusicVoiceGender } from '@aigc/types'
import type { MurekaMediaResult } from '../lib/mureka.js'

export interface MusicBatchParams {
  mode: MusicMode
  track_type: MusicTrackType
  title: string | null
  lyrics: string | null
  styles: string[]
  voice_gender: MusicVoiceGender
  voice_clone_id: string | null
  voice_id: string | null
}

export function parseMusicBatchParams(value: unknown): Partial<MusicBatchParams> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return parseMusicBatchParams(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Partial<MusicBatchParams> : {}
}

export function buildCoverPrompt(input: {
  title: string
  prompt?: string | null
  lyrics?: string | null
  styles?: string[]
  type: MusicTrackType
}): string {
  const styleText = input.styles?.length ? `风格：${input.styles.join('、')}。` : ''
  const theme = input.prompt ?? input.lyrics?.slice(0, 160) ?? input.title
  return [
    `为音乐作品《${input.title}》创作一张精致专辑封面。`,
    input.type === 'instrumental' ? '作品类型：纯音乐。' : '作品类型：歌曲。',
    styleText,
    `主题：${theme}`,
    '画面应适合作为方形音乐封面，质感高级，无文字，无水印。',
  ].filter(Boolean).join('')
}

function voiceGenderText(value: MusicVoiceGender): string {
  if (value === 'male') return '男声'
  if (value === 'female') return '女声'
  return ''
}

export function buildMurekaGenerationPrompt(input: {
  mode: MusicMode
  type: MusicTrackType
  title?: string | null
  prompt?: string | null
  lyrics?: string | null
  styles?: string[]
  voiceGender: MusicVoiceGender
}): string {
  const voiceText = input.type === 'song' ? voiceGenderText(input.voiceGender) : ''
  const voiceSentence = voiceText ? `请使用${voiceText}。` : ''
  const styleText = input.styles?.length ? `，风格是 ${input.styles.join('、')}` : ''
  if (input.type === 'instrumental') {
    const inspiration = input.prompt?.trim() || input.title?.trim() || '一段有完整起承转合的音乐'
    const styleSentence = input.styles?.length ? `风格是 ${input.styles.join('、')}。` : ''
    return `请根据以下灵感创作纯音乐：${inspiration}。${styleSentence}不要生成歌词，以旋律、编曲和情绪表达为主。`
  }

  if (input.mode === 'custom') {
    const title = input.title?.trim() || '未命名歌曲'
    return `以《${title}》为题${styleText}。${voiceSentence}请根据已提供的 lyrics 生成一首完整歌曲。`
  }

  const inspiration = input.prompt?.trim() || input.lyrics?.trim() || input.title?.trim() || '创作一首完整歌曲'
  const styleSentence = input.styles?.length ? `风格是 ${input.styles.join('、')}。` : ''
  return `请根据以下灵感创作歌曲：${inspiration}。${styleSentence}${voiceSentence}请生成一首完整歌曲。`
}

export function pickFinalMediaResult(result: MurekaMediaResult): MurekaMediaResult {
  if (result.url || result.flac_url || result.wav_url || result.stream_url) return result
  if (result.status && ['failed', 'error', 'canceled', 'cancelled'].includes(result.status.toLowerCase())) {
    throw new Error(result.error_message ?? 'Mureka 音乐生成失败')
  }
  return result
}

export function hasMurekaMediaUrl(result: MurekaMediaResult): boolean {
  return Boolean(result.url || result.flac_url || result.wav_url || result.stream_url)
}

export function hasMurekaDownloadableMediaUrl(result: MurekaMediaResult): boolean {
  return Boolean(result.url || result.flac_url || result.wav_url)
}

export function resolveMurekaPollTaskId(result: MurekaMediaResult): string | null {
  return result.task_id ?? result.id ?? null
}

export function nextTrackStatusForMode(mode: MusicMode, type: MusicTrackType): MusicTrackStatus {
  if (mode === 'inspiration' && type === 'song') return 'lyrics_generating'
  return 'song_generating'
}

export function shouldUseMurekaVoiceOptions(type: MusicTrackType): boolean {
  return type === 'song'
}

function normalizeTimelineValue(value: number, shouldConvertMilliseconds: boolean): number {
  return shouldConvertMilliseconds ? value / 1000 : value
}

export function normalizeMurekaLyricsSections(sections: MusicLyricsSection[] | null | undefined): MusicLyricsSection[] {
  if (!sections?.length) return []
  const maxTime = Math.max(
    0,
    ...sections.flatMap((section) => [
      section.start,
      section.end,
      ...section.lines.flatMap((line) => [
        line.start,
        line.end,
        ...(line.words ?? []).flatMap((word) => [word.start, word.end]),
      ]),
    ]),
  )
  const shouldConvertMilliseconds = maxTime > 600

  return sections.map((section) => ({
    section_type: section.section_type,
    start: normalizeTimelineValue(section.start, shouldConvertMilliseconds),
    end: normalizeTimelineValue(section.end, shouldConvertMilliseconds),
    lines: section.lines.map((line) => ({
      start: normalizeTimelineValue(line.start, shouldConvertMilliseconds),
      end: normalizeTimelineValue(line.end, shouldConvertMilliseconds),
      text: line.text,
      words: (line.words ?? []).map((word) => ({
        start: normalizeTimelineValue(word.start, shouldConvertMilliseconds),
        end: normalizeTimelineValue(word.end, shouldConvertMilliseconds),
        text: word.text,
      })),
    })),
  }))
}
