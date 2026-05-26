export const MUSIC_MODE_VALUES = ['inspiration', 'custom'] as const
export type MusicMode = typeof MUSIC_MODE_VALUES[number]

export const MUSIC_TRACK_TYPE_VALUES = ['song', 'instrumental'] as const
export type MusicTrackType = typeof MUSIC_TRACK_TYPE_VALUES[number]

export const MUSIC_MODEL_VALUES = ['mureka-8', 'mureka-9'] as const
export type MusicModel = typeof MUSIC_MODEL_VALUES[number]

export const MUSIC_VOICE_GENDER_VALUES = ['auto', 'male', 'female'] as const
export type MusicVoiceGender = typeof MUSIC_VOICE_GENDER_VALUES[number]

export const MUSIC_TRACK_STATUS_VALUES = [
  'pending',
  'lyrics_generating',
  'song_generating',
  'cover_generating',
  'transferring',
  'completed',
  'failed',
] as const
export type MusicTrackStatus = typeof MUSIC_TRACK_STATUS_VALUES[number]

export const MUSIC_VOICE_CLONE_STATUS_VALUES = ['pending', 'processing', 'ready', 'failed'] as const
export type MusicVoiceCloneStatus = typeof MUSIC_VOICE_CLONE_STATUS_VALUES[number]

export const MUSIC_PROMPT_MAX_LENGTH = 1024
export const MUSIC_LYRICS_MAX_LENGTH = 3000
export const MUSIC_CUSTOM_TITLE_MAX_LENGTH = 20
export const MUSIC_VOICE_DESCRIPTION_MAX_LENGTH = 1024

export function isMusicModel(value: unknown): value is MusicModel {
  return typeof value === 'string' && MUSIC_MODEL_VALUES.includes(value as MusicModel)
}

export function isMusicVoiceGender(value: unknown): value is MusicVoiceGender {
  return typeof value === 'string' && MUSIC_VOICE_GENDER_VALUES.includes(value as MusicVoiceGender)
}

function countTextLength(value: string): number {
  return [...value].length
}

export function normalizeMusicTitle(value: string): string {
  const title = value.trim()
  if (!title) {
    throw new Error('标题不能为空')
  }
  if (countTextLength(title) > MUSIC_CUSTOM_TITLE_MAX_LENGTH) {
    throw new Error(`标题不能超过 ${MUSIC_CUSTOM_TITLE_MAX_LENGTH} 字`)
  }
  return title
}

export function normalizeVoiceCloneDescription(value?: string | null): string | null {
  if (value == null) return null

  const description = value.trim()
  if (!description) return null
  if (countTextLength(description) > MUSIC_VOICE_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`描述不能超过 ${MUSIC_VOICE_DESCRIPTION_MAX_LENGTH} 字`)
  }
  return description
}

export interface MusicGenerateRequest {
  idempotency_key?: string
  workspace_id: string
  mode: MusicMode
  track_type: MusicTrackType
  model: MusicModel
  prompt?: string
  lyrics?: string
  title?: string
  styles?: string[]
  voice_clone_id?: string | null
  voice_gender?: MusicVoiceGender
  params?: Record<string, unknown>
  canvas_id?: string
  canvas_node_id?: string
}

export interface MusicTrackResponse {
  id: string
  batch_id: string
  task_id: string
  user_id: string
  workspace_id: string
  mode: MusicMode
  track_type: MusicTrackType
  model: MusicModel
  status: MusicTrackStatus
  title: string | null
  prompt: string | null
  lyrics: string | null
  styles: string[]
  voice_clone_id: string | null
  voice_gender: MusicVoiceGender
  voice_name: string | null
  stream_url: string | null
  audio_url: string | null
  audio_storage_url?: string | null
  flac_url: string | null
  flac_storage_url?: string | null
  wav_url: string | null
  wav_storage_url?: string | null
  cover_url: string | null
  cover_storage_url?: string | null
  duration_seconds: number | null
  error_message: string | null
  estimated_credits: number
  credits_cost: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface MusicVoiceCloneResponse {
  id: string
  voice_id: string | null
  user_id: string
  workspace_id: string
  name: string
  gender: MusicVoiceGender
  description: string | null
  status: MusicVoiceCloneStatus
  demo_audio_url: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type MusicSseEvent =
  | { event: 'status'; status: MusicTrackStatus; message?: string }
  | { event: 'lyrics_delta'; delta: string; lyrics: string }
  | { event: 'stream_url'; stream_url: string }
  | { event: 'completed'; track?: MusicTrackResponse; track_id?: string }
  | { event: 'failed'; error_message: string }
