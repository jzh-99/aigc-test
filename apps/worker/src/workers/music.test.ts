import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MurekaApiError, MurekaClient } from '../lib/mureka.js'
import {
  buildMusicStorageKey,
  downloadMusicFile,
  extensionForMusicContent,
} from '../lib/music-storage.js'
import {
  buildCoverPrompt,
  nextTrackStatusForMode,
  parseMusicBatchParams,
  pickFinalMediaResult,
} from './music-helpers.js'

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

test('MurekaClient maps lyrics endpoint headers and payload', async () => {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
  const client = new MurekaClient({
    baseUrl: 'https://mureka.example',
    apiKey: 'secret-token',
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) })
      return jsonResponse({ lyrics: '星空下的歌' })
    }) as typeof fetch,
  })

  const lyrics = await client.generateLyrics({ prompt: '星空', model: 'mureka-9', voiceGender: 'female' })

  assert.equal(lyrics, '星空下的歌')
  assert.equal(calls[0]?.url, 'https://mureka.example/v1/lyrics/generate')
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, 'Bearer secret-token')
  assert.deepEqual(calls[0]?.body, {
    model: 'mureka-9',
    prompt: '星空',
    voice_gender: 'female',
    stream: true,
  })
})

test('MurekaClient maps song, instrumental and voice clone endpoints', async () => {
  const urls: string[] = []
  const client = new MurekaClient({
    baseUrl: 'https://mureka.example/',
    apiKey: 'secret-token',
    fetchImpl: (async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/v1/song/vocal-clone')) return jsonResponse({ voice_id: 'voice_123', status: 'ready' })
      return jsonResponse({ task_id: 'task_123', stream_url: 'https://cdn.example/stream.m3u8' })
    }) as typeof fetch,
  })

  const song = await client.generateSong({ lyrics: 'la', model: 'mureka-8', voiceId: 'voice_123', styles: ['流行'] })
  const instrumental = await client.generateInstrumental({ prompt: 'dance', model: 'mureka-9' })
  const voice = await client.cloneVoice({ audioUrl: 'https://cdn.example/a.mp3', name: '我的音色' })

  assert.equal(song.task_id, 'task_123')
  assert.equal(instrumental.stream_url, 'https://cdn.example/stream.m3u8')
  assert.equal(voice.voice_id, 'voice_123')
  assert.deepEqual(urls, [
    'https://mureka.example/v1/song/generate',
    'https://mureka.example/v1/instrumental/generate',
    'https://mureka.example/v1/song/vocal-clone',
  ])
})

test('MurekaClient throws status without exposing API key', async () => {
  const client = new MurekaClient({
    baseUrl: 'https://mureka.example',
    apiKey: 'secret-token',
    fetchImpl: (async () => jsonResponse({ error: 'bad request' }, { status: 400 })) as typeof fetch,
  })

  await assert.rejects(
    () => client.generateInstrumental({ prompt: 'x', model: 'mureka-8' }),
    (err) => {
      assert.ok(err instanceof MurekaApiError)
      assert.equal(err.status, 400)
      assert.match(err.message, /bad request/)
      assert.doesNotMatch(err.message, /secret-token/)
      return true
    },
  )
})

test('music storage helpers generate scoped keys and infer extensions', () => {
  const key = buildMusicStorageKey('audio', 'track_123', 'mp3')
  assert.match(key, /^music\/audio\/track_123\/\d+-[0-9a-f-]+\.mp3$/)
  assert.equal(extensionForMusicContent('audio/flac'), 'flac')
  assert.equal(extensionForMusicContent('image/webp'), 'webp')
})

test('downloadMusicFile rejects oversized files before buffering', async () => {
  await assert.rejects(
    () => downloadMusicFile('https://cdn.example/song.mp3', 'audio', {
      maxBytes: 10,
      fetchImpl: (async () => new Response('too large', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '11' },
      })) as typeof fetch,
    }),
    /超过大小限制/,
  )
})

test('downloadMusicFile rejects non-audio content for audio transfer', async () => {
  await assert.rejects(
    () => downloadMusicFile('https://cdn.example/song.mp3', 'audio', {
      fetchImpl: (async () => new Response('not audio', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch,
    }),
    /文件类型不支持/,
  )
})

test('music worker helpers parse batch params and status transitions', () => {
  assert.deepEqual(parseMusicBatchParams('{"mode":"custom","voice_id":"voice_123","styles":["R&B"]}'), {
    mode: 'custom',
    voice_id: 'voice_123',
    styles: ['R&B'],
  })
  assert.equal(nextTrackStatusForMode('inspiration', 'song'), 'lyrics_generating')
  assert.equal(nextTrackStatusForMode('custom', 'song'), 'song_generating')
  assert.match(buildCoverPrompt({
    title: '星空来信',
    prompt: '星空与思念',
    type: 'song',
    styles: ['流行'],
  }), /无文字，无水印/)
})

test('pickFinalMediaResult rejects failed Mureka result', () => {
  assert.throws(() => pickFinalMediaResult({ status: 'failed', error_message: 'bad song' }), /bad song/)
  assert.equal(pickFinalMediaResult({ status: 'processing', task_id: 'task_1' }).task_id, 'task_1')
})
