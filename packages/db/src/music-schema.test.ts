import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Database } from './schema.js'

describe('music schema types', () => {
  test('音乐任务状态包含歌词生成阶段', () => {
    const status: Database['music_tracks']['status'] = 'lyrics_generating'

    assert.equal(status, 'lyrics_generating')
  })

  test('音色克隆状态包含就绪状态', () => {
    const status: Database['music_voice_clones']['status'] = 'ready'

    assert.equal(status, 'ready')
  })

  test('音色克隆 voice_id 可存储外部音色 ID', () => {
    const voiceId: Database['music_voice_clones']['voice_id'] = 'voice_123'

    assert.equal(voiceId, 'voice_123')
  })
})
