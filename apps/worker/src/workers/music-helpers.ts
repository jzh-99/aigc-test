import type { MusicMode, MusicTrackStatus, MusicTrackType, MusicVoiceGender } from '@aigc/types'
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

export function pickFinalMediaResult(result: MurekaMediaResult): MurekaMediaResult {
  if (result.url || result.flac_url || result.wav_url || result.stream_url) return result
  if (result.status && ['failed', 'error', 'canceled', 'cancelled'].includes(result.status.toLowerCase())) {
    throw new Error(result.error_message ?? 'Mureka 音乐生成失败')
  }
  return result
}

export function nextTrackStatusForMode(mode: MusicMode, type: MusicTrackType): MusicTrackStatus {
  if (mode === 'inspiration' && type === 'song') return 'lyrics_generating'
  return 'song_generating'
}

