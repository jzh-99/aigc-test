import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { __setQueuesForTest, closeQueues } from '../lib/queue.js'
import {
  assertVoiceCloneAudioDuration,
  assertVoiceCloneReadyForWorkspace,
  buildMusicAdjacentResponse,
  assertWorkspaceAccess,
  createMusicSseCleanup,
  decodeMusicTrackCursor,
  encodeMusicTrackCursor,
  markMusicQueueDeliveryFailed,
  mapMusicVoiceCloneResponse,
  mapMusicTrackResponse,
  createMusicTrackSsePayload,
  MusicRouteError,
  resolveMusicCredits,
  resolveVoiceCloneCredits,
  validateVoiceCloneAudioUpload,
  validateMusicGeneratePayload,
  validateVoiceClonePayload,
} from '../routes/music/_shared.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface FakeQueryCall {
  table: string
  joins: string[]
  selects: unknown[]
  wheres: unknown[][]
}

interface FakeUpdateCall {
  table: string
  setValue: unknown
  wheres: unknown[][]
}

function createFakeDb(resultsByTable: Record<string, unknown[]>) {
  const calls: FakeQueryCall[] = []

  return {
    calls,
    db: {
      selectFrom(table: string) {
        const call: FakeQueryCall = { table, joins: [], selects: [], wheres: [] }
        calls.push(call)

        const joinBuilder = {
          onRef() {
            return joinBuilder
          },
        }

        const builder = {
          innerJoin(joinTable: string, joinCallback?: unknown) {
            call.joins.push(joinTable)
            if (typeof joinCallback === 'function') joinCallback(joinBuilder)
            return builder
          },
          select(selection: unknown) {
            call.selects.push(selection)
            return builder
          },
          where(...args: unknown[]) {
            call.wheres.push(args)
            return builder
          },
          async executeTakeFirst() {
            return resultsByTable[table]?.shift()
          },
        }

        return builder
      },
    },
  }
}

function createFakeTransactionalDb() {
  const updates: FakeUpdateCall[] = []

  const makeUpdateBuilder = (table: string) => {
    const call: FakeUpdateCall = { table, setValue: null, wheres: [] }
    updates.push(call)

    const builder = {
      set(value: unknown) {
        call.setValue = value
        return builder
      },
      where(...args: unknown[]) {
        call.wheres.push(args)
        return builder
      },
      async execute() {
        return []
      },
    }
    return builder
  }

  const trx = {
    updateTable: makeUpdateBuilder,
  }

  return {
    updates,
    db: {
      transaction() {
        return {
          async execute(callback: (trxArg: unknown) => Promise<unknown>) {
            return callback(trx)
          },
        }
      },
    },
  }
}

async function assertRejectsMusicRouteError(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof MusicRouteError)
    assert.equal(error.statusCode, statusCode)
    assert.equal(error.code, code)
    return true
  })
}

function makeVoiceCloneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'voice-clone-1',
    voice_id: 'provider-voice-1',
    user_id: 'user-1',
    workspace_id: 'workspace-1',
    name: '测试音色',
    gender: 'auto',
    description: null,
    status: 'ready',
    source_audio_url: 'https://cdn.example.com/source.wav',
    source_audio_storage_url: null,
    error_message: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:01:00.000Z'),
    completed_at: null,
    ...overrides,
  }
}

function makeMp3Buffer(seconds: number): Buffer {
  const sampleRate = 44100
  const bitrate = 128000
  const samplesPerFrame = 1152
  const frameSize = Math.floor((144 * bitrate) / sampleRate)
  const frameCount = Math.ceil((seconds * sampleRate) / samplesPerFrame)
  const frame = Buffer.alloc(frameSize, 0)
  frame[0] = 0xff
  frame[1] = 0xfb
  frame[2] = 0x90
  frame[3] = 0x64
  return Buffer.concat(Array.from({ length: frameCount }, () => frame))
}

describe('music validation helpers', () => {
  test('validateVoiceCloneAudioUpload 拒绝空音频文件', () => {
    assert.throws(
      () => validateVoiceCloneAudioUpload('empty.mp3', Buffer.alloc(0), 'audio/mpeg'),
      (error) => {
        assert.ok(error instanceof MusicRouteError)
        assert.equal(error.statusCode, 400)
        assert.equal(error.code, 'BAD_REQUEST')
        assert.match(error.message, /不能为空/)
        return true
      },
    )
  })

  test('validateVoiceCloneAudioUpload 拒绝 MIME 与文件头明显不匹配的音频', () => {
    const wavHeader = Buffer.from('524946460000000057415645', 'hex')

    assert.throws(
      () => validateVoiceCloneAudioUpload('voice.mp3', wavHeader, 'audio/mpeg'),
      (error) => {
        assert.ok(error instanceof MusicRouteError)
        assert.equal(error.statusCode, 400)
        assert.equal(error.code, 'BAD_REQUEST')
        assert.match(error.message, /音频格式/)
        return true
      },
    )
  })

  test('validateVoiceCloneAudioUpload 拒绝非 MP3/M4A 音频', () => {
    const wavHeader = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')])

    assert.throws(
      () => validateVoiceCloneAudioUpload('voice.wav', wavHeader, 'audio/wav'),
      (error) => {
        assert.ok(error instanceof MusicRouteError)
        assert.equal(error.statusCode, 400)
        assert.equal(error.code, 'BAD_REQUEST')
        assert.match(error.message, /mp3\/m4a/)
        return true
      },
    )
  })

  test('validateVoiceCloneAudioUpload 拒绝超过 10MB 的音频', () => {
    assert.throws(
      () => validateVoiceCloneAudioUpload('voice.mp3', Buffer.alloc((10 * 1024 * 1024) + 1, 0xff), 'audio/mpeg'),
      (error) => {
        assert.ok(error instanceof MusicRouteError)
        assert.equal(error.statusCode, 413)
        assert.equal(error.code, 'PAYLOAD_TOO_LARGE')
        assert.match(error.message, /10 MB/)
        return true
      },
    )
  })

  test('validateVoiceCloneAudioUpload 接受常见 m4a 文件头和 MIME', () => {
    const m4aHeader = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(16)])

    const result = validateVoiceCloneAudioUpload('voice.m4a', m4aHeader, 'audio/mp4')

    assert.deepEqual(result, { ext: 'm4a', contentType: 'audio/mp4' })
  })

  test('assertVoiceCloneAudioDuration 拒绝不足 15 秒的音频', () => {
    assert.throws(
      () => assertVoiceCloneAudioDuration(makeMp3Buffer(10), 'mp3'),
      (error) => {
        assert.ok(error instanceof MusicRouteError)
        assert.equal(error.statusCode, 400)
        assert.equal(error.code, 'BAD_REQUEST')
        assert.match(error.message, /至少需要 15 秒/)
        return true
      },
    )
  })

  test('assertVoiceCloneAudioDuration 接受 15 秒以上音频', () => {
    const duration = assertVoiceCloneAudioDuration(makeMp3Buffer(16), 'mp3')

    assert.ok(duration >= 15)
  })

  test('music track cursor 使用 created_at + id 稳定编解码并兼容旧时间字符串', () => {
    const cursor = encodeMusicTrackCursor({
      id: 'track-1',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    })

    assert.deepEqual(decodeMusicTrackCursor(cursor), {
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 'track-1',
    })

    assert.deepEqual(decodeMusicTrackCursor('2026-01-02T00:00:00.000Z'), {
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      id: null,
    })
  })

  test('createMusicSseCleanup 取消订阅、关闭 Redis、移除 close listener 时保持幂等', async () => {
    const events: string[] = []
    const requestRaw = {
      on(event: string, listener: () => void) {
        events.push(`on:${event}`)
        assert.equal(typeof listener, 'function')
        return requestRaw
      },
      off(event: string) {
        events.push(`off:${event}`)
        return requestRaw
      },
    }
    const raw = {
      end() {
        events.push('end')
      },
    }
    const subscriber = {
      async unsubscribe(channel: string) {
        events.push(`unsubscribe:${channel}`)
      },
      async quit() {
        events.push('quit')
      },
    }

    const cleanup = createMusicSseCleanup({
      requestRaw,
      raw,
      subscriber,
      channel: 'sse:music_track:track-1',
      logger: { error() {} },
    })

    cleanup()
    cleanup()
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(events, [
      'on:close',
      'off:close',
      'unsubscribe:sse:music_track:track-1',
      'quit',
      'end',
    ])
    assert.equal(cleanup.isCleaned(), true)
  })

  test('createMusicSseCleanup 已清理后注册 heartbeat 会立即清理 interval', async () => {
    const originalClearInterval = globalThis.clearInterval
    const clearedIntervals: unknown[] = []
    let heartbeat: NodeJS.Timeout | null = null

    globalThis.clearInterval = ((interval: Parameters<typeof clearInterval>[0]) => {
      clearedIntervals.push(interval)
      return originalClearInterval(interval)
    }) as typeof clearInterval

    try {
      const requestRaw = {
        on() {
          return requestRaw
        },
        off() {
          return requestRaw
        },
      }
      const raw = {
        end() {},
      }
      const subscriber = {
        async unsubscribe() {},
        async quit() {},
      }

      const cleanup = createMusicSseCleanup({
        requestRaw,
        raw,
        subscriber,
        channel: 'sse:music_track:track-1',
        logger: { error() {} },
      })

      cleanup({ endRaw: false })
      heartbeat = setInterval(() => {}, 15_000)
      cleanup.setHeartbeat(heartbeat)

      assert.equal(cleanup.isCleaned(), true)
      assert.deepEqual(clearedIntervals, [heartbeat])
    } finally {
      if (heartbeat) originalClearInterval(heartbeat)
      globalThis.clearInterval = originalClearInterval
    }
  })

  test('markMusicQueueDeliveryFailed 会把 batch、task、track 标记为 failed', async () => {
    const { db, updates } = createFakeTransactionalDb()

    await markMusicQueueDeliveryFailed(db as never, {
      batchId: 'batch-1',
      taskId: 'task-1',
      trackId: 'track-1',
      errorMessage: '任务投递失败，请稍后重试',
    })

    assert.deepEqual(updates.map((call) => call.table), ['task_batches', 'tasks', 'music_tracks'])
    assert.deepEqual(updates.map((call) => call.wheres[0]), [
      ['id', '=', 'batch-1'],
      ['id', '=', 'task-1'],
      ['id', '=', 'track-1'],
    ])
    assert.match(JSON.stringify(updates.map((call) => call.setValue)), /任务投递失败/)
  })

  test('markMusicQueueDeliveryFailed 支持把 voice clone 标记为 failed', async () => {
    const { db, updates } = createFakeTransactionalDb()

    await markMusicQueueDeliveryFailed(db as never, {
      batchId: 'batch-1',
      taskId: 'task-1',
      voiceCloneId: 'voice-clone-1',
      errorMessage: '任务投递失败，请稍后重试',
    })

    assert.deepEqual(updates.map((call) => call.table), ['task_batches', 'tasks', 'music_voice_clones'])
    assert.deepEqual(updates[2]?.wheres[0], ['id', '=', 'voice-clone-1'])
    assert.match(JSON.stringify(updates[2]?.setValue), /任务投递失败/)
  })


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

  test('validateVoiceClonePayload 不要求音色克隆模型', () => {
    const payload = validateVoiceClonePayload({
      name: '我的音色',
      description: '温暖明亮',
      gender: 'auto',
    })

    assert.deepEqual(payload, {
      name: '我的音色',
      description: '温暖明亮',
      gender: 'auto',
    })
  })

  test('resolveVoiceCloneCredits 优先使用后台费用配置', async () => {
    const previous = process.env.MUSIC_VOICE_CLONE_CREDITS
    process.env.MUSIC_VOICE_CLONE_CREDITS = '7'
    const { db, calls } = createFakeDb({
      system_cost_configs: [{ credit_cost: 9 }],
    })

    const credits = await resolveVoiceCloneCredits(db as never, 'team-1')

    assert.equal(credits.providerModelId, null)
    assert.equal(credits.providerCode, 'mureka')
    assert.equal(credits.estimatedCredits, 9)
    assert.deepEqual(credits.unitPrices, { voice_clone: 9 })
    assert.deepEqual(calls.map((call) => call.table), ['system_cost_configs'])
    if (previous === undefined) delete process.env.MUSIC_VOICE_CLONE_CREDITS
    else process.env.MUSIC_VOICE_CLONE_CREDITS = previous
  })

  test('resolveVoiceCloneCredits 后台费用缺失时回退环境变量', async () => {
    const previous = process.env.MUSIC_VOICE_CLONE_CREDITS
    process.env.MUSIC_VOICE_CLONE_CREDITS = '7'
    const { db, calls } = createFakeDb({})

    const credits = await resolveVoiceCloneCredits(db as never, 'team-1')

    assert.equal(credits.providerModelId, null)
    assert.equal(credits.providerCode, 'mureka')
    assert.equal(credits.estimatedCredits, 7)
    assert.deepEqual(credits.unitPrices, { voice_clone: 7 })
    assert.deepEqual(calls.map((call) => call.table), ['system_cost_configs'])
    if (previous === undefined) delete process.env.MUSIC_VOICE_CLONE_CREDITS
    else process.env.MUSIC_VOICE_CLONE_CREDITS = previous
  })

  test('resolveMusicCredits 按三种业务模式读取 params_pricing 单价', async () => {
    const baseModel = {
      modelId: 'model-1',
      providerCode: 'mureka',
      providerId: 'provider-1',
      params_pricing: [
        { resolution: 'inspiration_song', model: 'mureka-9', unit_price: 18 },
        { resolution: 'instrumental', model: 'mureka-9', unit_price: 15 },
        { resolution: 'custom_song', model: 'mureka-9', unit_price: 15 },
      ],
    }
    const { db } = createFakeDb({
      provider_models: [baseModel, { ...baseModel }, { ...baseModel }],
    })

    const inspirationSong = await resolveMusicCredits(db as never, 'team-1', 'mureka-9', 'song', 'inspiration')
    const instrumental = await resolveMusicCredits(db as never, 'team-1', 'mureka-9', 'instrumental', 'inspiration')
    const customSong = await resolveMusicCredits(db as never, 'team-1', 'mureka-9', 'song', 'custom')

    assert.equal(inspirationSong.estimatedCredits, 18)
    assert.deepEqual(inspirationSong.unitPrices, { inspiration_song: 18 })
    assert.equal(instrumental.estimatedCredits, 15)
    assert.deepEqual(instrumental.unitPrices, { instrumental: 15 })
    assert.equal(customSong.estimatedCredits, 15)
    assert.deepEqual(customSong.unitPrices, { custom_song: 15 })
  })

  test('resolveMusicCredits 缺少业务模式价格时不回退旧拆分项', async () => {
    const { db } = createFakeDb({
      provider_models: [{
        modelId: 'model-1',
        providerCode: 'mureka',
        providerId: 'provider-1',
        params_pricing: [
          { resolution: 'lyrics', model: 'mureka-9', unit_price: 3 },
          { resolution: 'song', model: 'mureka-9', unit_price: 12 },
          { resolution: 'cover', model: 'mureka-9', unit_price: 1 },
          { resolution: 'transfer', model: 'mureka-9', unit_price: 2 },
        ],
      }],
    })

    await assert.rejects(
      () => resolveMusicCredits(db as never, 'team-1', 'mureka-9', 'song', 'inspiration'),
      (error) => error instanceof MusicRouteError && error.code === 'MUSIC_PRICE_NOT_CONFIGURED',
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

  test('inspiration 模式保留音色克隆', () => {
    const payload = validateMusicGeneratePayload({
      workspace_id: 'workspace-1',
      mode: 'inspiration',
      track_type: 'song',
      model: 'mureka-8',
      prompt: '写一首轻快的歌',
      voice_clone_id: 'voice-clone-1',
      voice_gender: 'auto',
    })

    assert.equal(payload.voice_clone_id, 'voice-clone-1')
    assert.equal(payload.voice_gender, 'auto')
  })

  test('音色克隆和音色性别不能同时选择', () => {
    assert.throws(
      () => validateMusicGeneratePayload({
        workspace_id: 'workspace-1',
        mode: 'inspiration',
        track_type: 'song',
        model: 'mureka-8',
        prompt: '写一首轻快的歌',
        voice_clone_id: 'voice-clone-1',
        voice_gender: 'female',
      }),
      /音色和音色性别不能同时选择/,
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
        lyrics_sections: [{
          section_type: 'verse',
          start: 0,
          end: 2,
          lines: [{ start: 0, end: 2, text: '歌词' }],
        }],
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
        duration_seconds: 2,
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
    assert.equal(response.duration_seconds, 2)
    assert.deepEqual(response.lyrics_sections, [{
      section_type: 'verse',
      start: 0,
      end: 2,
      lines: [{ start: 0, end: 2, text: '歌词' }],
    }])
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
        lyrics_sections: [],
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
        duration_seconds: null,
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

  test('createMusicTrackSsePayload 为状态和终态事件携带完整 track 快照', () => {
    const track = {
      id: 'track-1',
      status: 'completed',
      stream_url: 'https://stream.example.com/track.m3u8',
    } as never

    assert.deepEqual(createMusicTrackSsePayload('completed', track), {
      event: 'completed',
      track,
    })
    assert.deepEqual(createMusicTrackSsePayload('status', track), {
      event: 'status',
      status: 'completed',
      track,
    })
    assert.deepEqual(createMusicTrackSsePayload('stream_url', track), {
      event: 'stream_url',
      stream_url: 'https://stream.example.com/track.m3u8',
      track,
    })
  })

  test('buildMusicAdjacentResponse 同时返回相邻歌曲 ID，匹配前端播放器契约', () => {
    const previous = { id: 'track-newer', title: '上一首' }
    const next = { id: 'track-older', title: '下一首' }

    assert.deepEqual(buildMusicAdjacentResponse(previous, next), {
      previous_id: 'track-newer',
      next_id: 'track-older',
      previous,
      next,
    })
    assert.deepEqual(buildMusicAdjacentResponse(null, null), {
      previous_id: null,
      next_id: null,
      previous: null,
      next: null,
    })
  })

  test('assertVoiceCloneReadyForWorkspace 使用内部 voice_clone_id 查询当前 workspace 的 ready 记录', async () => {
    const { db, calls } = createFakeDb({
      music_voice_clones: [{
        id: 'voice-clone-1',
        name: '测试音色',
        voice_id: 'provider-voice-1',
        external_voice_id: 'external-voice-1',
        workspace_id: 'workspace-current',
        status: 'ready',
      }],
    })

    const voice = await assertVoiceCloneReadyForWorkspace(db as never, 'workspace-current', 'voice-clone-1')

    assert.equal(voice?.voice_id, 'provider-voice-1')
    assert.equal(calls[0]?.table, 'music_voice_clones')
    assert.deepEqual(calls[0]?.wheres, [
      ['id', '=', 'voice-clone-1'],
      ['workspace_id', '=', 'workspace-current'],
      ['status', '=', 'ready'],
    ])
  })

  test('assertVoiceCloneReadyForWorkspace 遇到 ready 记录缺少 voice_id 时抛 VOICE_NOT_READY', async () => {
    const { db } = createFakeDb({
      music_voice_clones: [{
        id: 'voice-clone-1',
        name: '测试音色',
        voice_id: '',
        external_voice_id: null,
        workspace_id: 'workspace-1',
        status: 'ready',
      }],
    })

    await assertRejectsMusicRouteError(
      assertVoiceCloneReadyForWorkspace(db as never, 'workspace-1', 'voice-clone-1'),
      404,
      'VOICE_NOT_READY',
    )
  })

  test('mapMusicVoiceCloneResponse 优先返回签名后的 source_audio_storage_url 且不暴露原始 storage URL', async () => {
    const signedUrls: string[] = []
    const response = await mapMusicVoiceCloneResponse(
      makeVoiceCloneRow({
        source_audio_url: 'https://cdn.example.com/source.wav',
        source_audio_storage_url: 'tos://bucket/source.wav',
      }) as never,
      async (url) => {
        signedUrls.push(url ?? '')
        return `/signed/${encodeURIComponent(url ?? '')}`
      },
    )

    assert.deepEqual(signedUrls, ['tos://bucket/source.wav'])
    assert.equal(response.demo_audio_url, '/signed/tos%3A%2F%2Fbucket%2Fsource.wav')
    assert.equal(Object.values(response).includes('tos://bucket/source.wav'), false)
    assert.equal('source_audio_storage_url' in response, false)
  })

  test('mapMusicVoiceCloneResponse 没有 storage URL 时 fallback 到 source_audio_url', async () => {
    const signedUrls: string[] = []
    const response = await mapMusicVoiceCloneResponse(
      makeVoiceCloneRow({
        source_audio_url: 'https://cdn.example.com/source.wav',
        source_audio_storage_url: null,
      }) as never,
      async (url) => {
        signedUrls.push(url ?? '')
        return `/signed/${encodeURIComponent(url ?? '')}`
      },
    )

    assert.deepEqual(signedUrls, [])
    assert.equal(response.demo_audio_url, 'https://cdn.example.com/source.wav')
  })

  test('assertWorkspaceAccess 非管理员访问 deleted workspace 时拒绝', async () => {
    const { db, calls } = createFakeDb({
      workspace_members: [undefined],
      workspaces: [{ team_id: 'team-deleted' }],
    })

    await assertRejectsMusicRouteError(
      assertWorkspaceAccess(db as never, 'workspace-deleted', 'user-1', 'member'),
      403,
      'FORBIDDEN',
    )

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0]?.wheres.at(-1), ['workspaces.is_deleted', '=', false])
  })

  test('assertWorkspaceAccess 非管理员缺少 team_members 关联时拒绝且不走 admin fallback', async () => {
    const { db, calls } = createFakeDb({
      workspace_members: [undefined],
      workspaces: [{ team_id: 'team-1' }],
    })

    await assertRejectsMusicRouteError(
      assertWorkspaceAccess(db as never, 'workspace-1', 'user-1', 'member'),
      403,
      'FORBIDDEN',
    )

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0]?.joins, ['workspaces', 'team_members'])
  })

  test('post-generate 幂等命中前先校验 workspace 权限并限定当前 workspace', async () => {
    const source = await readFile(join(__dirname, '../routes/music/post-generate.ts'), 'utf-8')
    const validateIndex = source.indexOf('payload = validateMusicGeneratePayload(request.body)')
    const accessIndex = source.indexOf('const access = await assertWorkspaceAccess')
    const existingBatchIndex = source.indexOf("selectFrom('task_batches')")

    assert.ok(validateIndex >= 0)
    assert.ok(accessIndex > validateIndex)
    assert.ok(existingBatchIndex > accessIndex)
    assert.match(source, /\.where\('workspace_id', '=', payload\.workspace_id\)/)
    assert.match(source, /\.where\('mt\.workspace_id', '=', payload\.workspace_id\)/)
  })

  test('closeQueues 关闭后可重复调用且不连接真实 Redis', async () => {
    const closedQueues: string[] = []
    const makeQueue = (name: string) => ({
      async close() {
        closedQueues.push(name)
      },
    })

    __setQueuesForTest({
      imageQueue: makeQueue('image'),
      musicQueue: makeQueue('music'),
      musicVoiceCloneQueue: makeQueue('music-voice-clone'),
    })

    await closeQueues()
    await closeQueues()

    assert.deepEqual(closedQueues, ['image', 'music', 'music-voice-clone'])
  })
})
