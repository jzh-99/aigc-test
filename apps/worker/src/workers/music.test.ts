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
  buildMurekaGenerationPrompt,
  hasMurekaDownloadableMediaUrl,
  hasMurekaMediaUrl,
  nextTrackStatusForMode,
  parseMusicBatchParams,
  pickFinalMediaResult,
  normalizeMurekaLyricsSections,
  resolveMurekaPollTaskId,
  shouldUseMurekaVoiceOptions,
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
      return jsonResponse({ title: '星空来信', lyrics: '星空下的歌' })
    }) as typeof fetch,
  })

  const result = await client.generateLyrics({ prompt: '星空', model: 'mureka-9' })

  assert.deepEqual(result, { title: '星空来信', lyrics: '星空下的歌' })
  assert.equal(calls[0]?.url, 'https://mureka.example/v1/lyrics/generate')
  assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), 'Bearer secret-token')
  assert.deepEqual(calls[0]?.body, {
    model: 'mureka-9',
    prompt: '星空',
    stream: true,
  })
})

test('MurekaClient maps song, instrumental and voice clone endpoints', async () => {
  const urls: string[] = []
  const bodies: unknown[] = []
  const formEntries: Record<string, unknown> = {}
  let voiceCloneContentType: string | null = null
  const client = new MurekaClient({
    baseUrl: 'https://mureka.example/',
    apiKey: 'secret-token',
    fetchImpl: (async (url, init) => {
      urls.push(String(url))
      if (String(url) === 'https://cdn.example/a.mp3') {
        return new Response(Buffer.from([0x49, 0x44, 0x33, 0x04]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '4' },
        })
      }
      if (init?.body instanceof FormData) {
        formEntries.description = init.body.get('description')
        formEntries.file = init.body.get('file')
        voiceCloneContentType = new Headers(init.headers).get('content-type')
      } else if (init?.body) {
        bodies.push(JSON.parse(String(init.body)))
      }
      if (String(url).endsWith('/v1/song/vocal-clone')) return jsonResponse({ id: 'voice_123', status: 'ready' })
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
    'https://cdn.example/a.mp3',
    'https://mureka.example/v1/song/vocal-clone',
  ])
  assert.deepEqual((bodies[0] as Record<string, unknown>).vocal_id, 'voice_123')
  assert.equal((bodies[0] as Record<string, unknown>).voice_gender, undefined)
  assert.equal((bodies[1] as Record<string, unknown>).voice_gender, undefined)
  assert.equal(formEntries.description, '我的音色')
  assert.ok(formEntries.file instanceof Blob)
  assert.notEqual(voiceCloneContentType, 'application/json')
})

test('MurekaClient parses official choices media response', async () => {
  const client = new MurekaClient({
    baseUrl: 'https://mureka.example',
    apiKey: 'secret-token',
    fetchImpl: (async (url) => {
      if (String(url).endsWith('/v1/song/query/song_123')) {
        return jsonResponse({
          id: 'song_123',
          status: 'succeeded',
          failed_reason: '',
          choices: [{
            index: 0,
            id: 'choice_1',
            url: 'https://cdn.example/song.mp3',
            flac_url: 'https://cdn.example/song.flac',
            wav_url: 'https://cdn.example/song.wav',
            stream_url: 'https://cdn.example/song.m3u8',
            duration: 161,
            lyrics_sections: [{
              section_type: 'verse',
              start: 0,
              end: 3.2,
              lines: [{
                start: 0,
                end: 3.2,
                text: 'hello world',
                words: [{ start: 0, end: 1, text: 'hello' }],
              }],
            }],
          }],
        })
      }
      return jsonResponse({
        id: 'song_123',
        status: 'preparing',
        choices: [],
      })
    }) as typeof fetch,
  })

  const initial = await client.generateSong({ lyrics: 'la', model: 'mureka-8' })
  assert.equal(initial.id, 'song_123')
  assert.equal(initial.status, 'preparing')
  assert.equal(initial.url, null)

  const completed = await client.pollSongResult('song_123', { intervalMs: 1, timeoutMs: 100 })
  assert.equal(completed.id, 'song_123')
  assert.equal(completed.status, 'succeeded')
  assert.equal(completed.url, 'https://cdn.example/song.mp3')
  assert.equal(completed.flac_url, 'https://cdn.example/song.flac')
  assert.equal(completed.wav_url, 'https://cdn.example/song.wav')
  assert.equal(completed.stream_url, 'https://cdn.example/song.m3u8')
  assert.equal(completed.duration, 161)
  assert.deepEqual(completed.lyrics_sections, [{
    section_type: 'verse',
    start: 0,
    end: 3.2,
    lines: [{
      start: 0,
      end: 3.2,
      text: 'hello world',
      words: [{ start: 0, end: 1, text: 'hello' }],
    }],
  }])
})

test('MurekaClient polls instrumental result from instrumental query endpoint', async () => {
  const urls: string[] = []
  const client = new MurekaClient({
    baseUrl: 'https://mureka.example',
    apiKey: 'secret-token',
    fetchImpl: (async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/v1/instrumental/query/instrumental_123')) {
        return jsonResponse({
          id: 'instrumental_123',
          status: 'succeeded',
          choices: [{
            id: 'choice_1',
            url: 'https://cdn.example/instrumental.mp3',
            stream_url: 'https://cdn.example/instrumental.m3u8',
          }],
        })
      }
      return jsonResponse({ error: 'wrong endpoint' }, { status: 400 })
    }) as typeof fetch,
  })

  const completed = await client.pollInstrumentalResult('instrumental_123', { intervalMs: 1, timeoutMs: 100 })

  assert.equal(completed.id, 'instrumental_123')
  assert.equal(completed.url, 'https://cdn.example/instrumental.mp3')
  assert.deepEqual(urls, ['https://mureka.example/v1/instrumental/query/instrumental_123'])
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

test('MurekaClient reads nested Mureka error message', async () => {
  const client = new MurekaClient({
    baseUrl: 'https://mureka.example',
    apiKey: 'secret-token',
    fetchImpl: (async () => jsonResponse({
      error: { message: 'Invalid Authentication' },
      trace_id: 'trace_123',
    }, { status: 401 })) as typeof fetch,
  })

  await assert.rejects(
    () => client.generateLyrics({ prompt: 'x', model: 'mureka-9' }),
    (err) => {
      assert.ok(err instanceof MurekaApiError)
      assert.equal(err.status, 401)
      assert.equal(err.message, 'Invalid Authentication')
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
  assert.equal(shouldUseMurekaVoiceOptions('song'), true)
  assert.equal(shouldUseMurekaVoiceOptions('instrumental'), false)
  assert.match(buildCoverPrompt({
    title: '星空来信',
    prompt: '星空与思念',
    type: 'song',
    styles: ['流行'],
  }), /无文字，无水印/)
})

test('buildMurekaGenerationPrompt wraps custom, inspiration and instrumental prompts', () => {
  assert.equal(buildMurekaGenerationPrompt({
    mode: 'custom',
    type: 'song',
    title: '落日玫瑰',
    prompt: null,
    lyrics: '夜风已冷',
    styles: ['R&B', '流行'],
    voiceGender: 'female',
  }), '以《落日玫瑰》为题，风格是 R&B、流行。请使用女声。歌词要求是：夜风已冷。请生成一首完整歌曲。')

  assert.equal(buildMurekaGenerationPrompt({
    mode: 'inspiration',
    type: 'song',
    title: null,
    prompt: '关于星空与思念',
    lyrics: null,
    styles: [],
    voiceGender: 'male',
  }), '请根据以下灵感创作歌曲：关于星空与思念。请使用男声。请生成一首完整歌曲。')

  assert.equal(buildMurekaGenerationPrompt({
    mode: 'inspiration',
    type: 'instrumental',
    title: null,
    prompt: '赛博城市夜跑',
    lyrics: null,
    styles: ['电子'],
    voiceGender: 'auto',
  }), '请根据以下灵感创作纯音乐：赛博城市夜跑。风格是 电子。不要生成歌词，以旋律、编曲和情绪表达为主。')
})

test('pickFinalMediaResult rejects failed Mureka result', () => {
  assert.throws(() => pickFinalMediaResult({ status: 'failed', error_message: 'bad song' }), /bad song/)
  assert.equal(pickFinalMediaResult({ status: 'processing', task_id: 'task_1' }).task_id, 'task_1')
})

test('Mureka media helpers use id as fallback polling task id', () => {
  const preparing = { id: '140686842134531', status: 'preparing' }
  assert.equal(resolveMurekaPollTaskId(preparing), '140686842134531')
  assert.equal(hasMurekaMediaUrl(preparing), false)
  assert.equal(hasMurekaDownloadableMediaUrl(preparing), false)

  const streamOnly = { id: 'task_1', stream_url: 'https://cdn.example/stream.m3u8' }
  assert.equal(hasMurekaMediaUrl(streamOnly), true)
  assert.equal(hasMurekaDownloadableMediaUrl(streamOnly), false)
})

test('normalizeMurekaLyricsSections converts official millisecond timeline to seconds', () => {
  assert.deepEqual(normalizeMurekaLyricsSections([{
    section_type: 'verse',
    start: 1200,
    end: 5200,
    lines: [{
      start: 1200,
      end: 2800,
      text: '第一句',
      words: [{ start: 1200, end: 1800, text: '第一' }],
    }],
  }]), [{
    section_type: 'verse',
    start: 1.2,
    end: 5.2,
    lines: [{
      start: 1.2,
      end: 2.8,
      text: '第一句',
      words: [{ start: 1.2, end: 1.8, text: '第一' }],
    }],
  }])

  assert.deepEqual(normalizeMurekaLyricsSections([{
    section_type: 'chorus',
    start: 1.5,
    end: 4.5,
    lines: [{ start: 1.5, end: 4.5, text: '副歌' }],
  }]), [{
    section_type: 'chorus',
    start: 1.5,
    end: 4.5,
    lines: [{ start: 1.5, end: 4.5, text: '副歌', words: [] }],
  }])
})
