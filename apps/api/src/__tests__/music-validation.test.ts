import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  mapMusicTrackResponse,
  validateMusicGeneratePayload,
  validateVoiceClonePayload,
} from '../routes/music/_shared.js'

describe('music validation helpers', () => {
  test('voice_id 入参会被拒绝，避免和内部 voice_clone_id 混用', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'inspiration',
        track_type: 'song',
        model: 'mureka-8',
        prompt: '写一首轻快的歌',
        voice_id: 'provider-voice-1',
      }),
      /请使用 voice_clone_id/,
    )
  })

  test('自定义模式标题超过 20 字会报错', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'custom',
        track_type: 'song',
        model: 'mureka-8',
        title: '一二三四五六七八九十一二三四五六七八九十一',
        lyrics: '这是一段歌词',
      }),
      /标题不能超过 20 字/,
    )
  })

  test('voice clone description 超过 1024 字会报错', () => {
    assert.throws(
      () => validateVoiceClonePayload({
        name: '测试音色',
        description: '描'.repeat(1025),
      }),
      /描述不能超过 1024 字/,
    )
  })

  test('inspiration prompt 超过 1024 字会失败', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'inspiration',
        track_type: 'song',
        model: 'mureka-8',
        prompt: '灵'.repeat(1025),
      }),
      /灵感描述不能超过 1024 字/,
    )
  })

  test('custom lyrics 超过 3000 字会失败', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'custom',
        track_type: 'song',
        model: 'mureka-9',
        title: '测试歌名',
        lyrics: '啦'.repeat(3001),
      }),
      /歌词不能超过 3000 字/,
    )
  })

  test('styles 数量超过 12 项会失败', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'inspiration',
        track_type: 'song',
        model: 'mureka-8',
        prompt: '写一首轻快的歌',
        styles: Array.from({ length: 13 }, (_, index) => `style-${index}`),
      }),
      /styles 最多 12 项/,
    )
  })

  test('styles 单项超过 24 字会失败', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'inspiration',
        track_type: 'song',
        model: 'mureka-8',
        prompt: '写一首轻快的歌',
        styles: ['流行'.repeat(13)],
      }),
      /styles 单项不能超过 24 字/,
    )
  })

  test('custom + instrumental 会被拒绝', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'custom',
        track_type: 'instrumental',
        model: 'mureka-8',
        title: '测试歌名',
        lyrics: '这是一段歌词',
      }),
      /custom 模式不支持 instrumental/,
    )
  })

  test('mapMusicTrackResponse 会输出 voice_name 和存储/播放 URL 字段', async () => {
    const response = await mapMusicTrackResponse(
      {
        id: 'track-1',
        workspace_id: 'workspace-1',
        user_id: 'user-1',
        team_id: 'team-1',
        batch_id: 'batch-1',
        task_id: 'task-1',
        type: 'song',
        mode: 'custom',
        title: '测试歌',
        prompt: null,
        lyrics: '歌词',
        styles: ['pop'],
        voice_clone_id: 'voice-clone-1',
        voice_gender: 'female',
        model: 'mureka-8',
        cover_url: 'https://cdn.example.com/cover.jpg',
        cover_storage_url: 'tos://bucket/cover.jpg',
        stream_url: 'https://stream.example.com/track.m3u8',
        audio_url: 'https://cdn.example.com/track.mp3',
        audio_storage_url: 'tos://bucket/track.mp3',
        flac_url: 'https://cdn.example.com/track.flac',
        flac_storage_url: 'tos://bucket/track.flac',
        wav_url: 'https://cdn.example.com/track.wav',
        wav_storage_url: 'tos://bucket/track.wav',
        external_task_id: 'external-1',
        status: 'completed',
        error_message: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:01:00.000Z'),
      },
      { name: '克隆音色' },
      async (url) => `/signed/${encodeURIComponent(url)}`,
    )

    assert.equal(response.voice_name, '克隆音色')
    assert.equal(response.cover_url, '/signed/tos%3A%2F%2Fbucket%2Fcover.jpg')
    assert.equal(response.cover_storage_url, '/signed/tos%3A%2F%2Fbucket%2Fcover.jpg')
    assert.equal(response.stream_url, 'https://stream.example.com/track.m3u8')
    assert.equal(response.audio_url, '/signed/tos%3A%2F%2Fbucket%2Ftrack.mp3')
    assert.equal(response.audio_storage_url, '/signed/tos%3A%2F%2Fbucket%2Ftrack.mp3')
    assert.equal(response.flac_url, '/signed/tos%3A%2F%2Fbucket%2Ftrack.flac')
    assert.equal(response.flac_storage_url, '/signed/tos%3A%2F%2Fbucket%2Ftrack.flac')
    assert.equal(response.wav_url, '/signed/tos%3A%2F%2Fbucket%2Ftrack.wav')
    assert.equal(response.wav_storage_url, '/signed/tos%3A%2F%2Fbucket%2Ftrack.wav')
  })

  test('mapMusicTrackResponse 在没有 storage URL 时 fallback provider URL', async () => {
    const response = await mapMusicTrackResponse(
      {
        id: 'track-1',
        workspace_id: 'workspace-1',
        user_id: 'user-1',
        team_id: 'team-1',
        batch_id: 'batch-1',
        task_id: 'task-1',
        type: 'song',
        mode: 'custom',
        title: '测试歌',
        prompt: null,
        lyrics: '歌词',
        styles: ['pop'],
        voice_clone_id: null,
        voice_gender: 'auto',
        model: 'mureka-8',
        cover_url: 'https://cdn.example.com/cover.jpg',
        cover_storage_url: null,
        stream_url: null,
        audio_url: 'https://cdn.example.com/track.mp3',
        audio_storage_url: null,
        flac_url: null,
        flac_storage_url: null,
        wav_url: null,
        wav_storage_url: null,
        external_task_id: 'external-1',
        status: 'completed',
        error_message: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:01:00.000Z'),
      },
      null,
      async (url) => `/signed/${encodeURIComponent(url)}`,
    )

    assert.equal(response.cover_url, 'https://cdn.example.com/cover.jpg')
    assert.equal(response.audio_url, 'https://cdn.example.com/track.mp3')
  })
})
