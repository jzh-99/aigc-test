import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Insertable, Selectable, Updateable } from 'kysely'
import type { Database } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('music schema types', () => {
  test('音乐任务状态包含歌词生成阶段', () => {
    const status: Selectable<Database['music_tracks']>['status'] = 'lyrics_generating'

    assert.equal(status, 'lyrics_generating')
  })

  test('音色克隆状态包含就绪状态', () => {
    const status: Selectable<Database['music_voice_clones']>['status'] = 'ready'

    assert.equal(status, 'ready')
  })

  test('音色克隆 gender 支持默认值和限定枚举', () => {
    const selectedGender: Selectable<Database['music_voice_clones']>['gender'] = 'female'
    const insertWithoutGender: Insertable<Database['music_voice_clones']> = {
      workspace_id: 'workspace_1',
      user_id: 'user_1',
      team_id: 'team_1',
      name: 'demo voice',
      source_audio_url: 'https://example.com/source.mp3',
    }
    const insertWithGender: Insertable<Database['music_voice_clones']> = {
      ...insertWithoutGender,
      gender: 'male',
    }

    assert.equal(selectedGender, 'female')
    assert.equal(insertWithoutGender.name, 'demo voice')
    assert.equal(insertWithGender.gender, 'male')
  })

  test('音色克隆 voice_id 可存储外部音色 ID', () => {
    const voiceId: Database['music_voice_clones']['voice_id'] = 'voice_123'

    assert.equal(voiceId, 'voice_123')
  })

  test('音乐表默认列插入时可省略', () => {
    const track: Insertable<Database['music_tracks']> = {
      workspace_id: 'workspace_1',
      user_id: 'user_1',
      team_id: 'team_1',
      type: 'song',
      mode: 'inspiration',
      model: 'mureka-8',
    }
    const clone: Insertable<Database['music_voice_clones']> = {
      workspace_id: 'workspace_1',
      user_id: 'user_1',
      team_id: 'team_1',
      name: 'demo voice',
      source_audio_url: 'https://example.com/source.mp3',
    }

    assert.equal(track.model, 'mureka-8')
    assert.equal(clone.name, 'demo voice')
  })

  test('music_tracks.lyrics_sections 支持精确歌词时间轴 JSON', () => {
    const sections = [{
      section_type: 'verse',
      start: 0,
      end: 4,
      lines: [{ start: 0, end: 4, text: '第一句' }],
    }]
    const update: Updateable<Database['music_tracks']> = {
      lyrics_sections: sections,
      duration_seconds: 4,
    }

    assert.deepEqual(update.lyrics_sections, sections)
    assert.equal(update.duration_seconds, 4)
  })

  test('music_tracks.styles 写入类型支持数组和 JSON 字符串', () => {
    const insertWithArray: Insertable<Database['music_tracks']> = {
      workspace_id: 'workspace_1',
      user_id: 'user_1',
      team_id: 'team_1',
      type: 'song',
      mode: 'custom',
      model: 'mureka-8',
      styles: ['pop', 'electronic'],
    }
    const insertWithJson: Insertable<Database['music_tracks']> = {
      workspace_id: 'workspace_1',
      user_id: 'user_1',
      team_id: 'team_1',
      type: 'instrumental',
      mode: 'inspiration',
      model: 'mureka-9',
      styles: JSON.stringify(['ambient']),
    }
    const updateWithArray: Updateable<Database['music_tracks']> = {
      styles: ['folk'],
    }
    const updateWithJson: Updateable<Database['music_tracks']> = {
      styles: JSON.stringify(['jazz']),
    }

    assert.deepEqual(insertWithArray.styles, ['pop', 'electronic'])
    assert.equal(insertWithJson.styles, '["ambient"]')
    assert.deepEqual(updateWithArray.styles, ['folk'])
    assert.equal(updateWithJson.styles, '["jazz"]')
  })
})

describe('music migration and seed hardening', () => {
  test('044 down 收窄模块约束前清理音乐相关模型和批次', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/044_music.ts'),
      'utf-8',
    )
    const cleanupModelsIndex = source.indexOf("module IN ('music','music_voice_clone')")
    const providerConstraintIndex = source.indexOf("ALTER TABLE provider_models ADD CONSTRAINT chk_pm_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation'))")
    const cleanupBatchesIndex = source.indexOf("DELETE FROM task_batches WHERE module IN ('music','music_voice_clone')")
    const batchConstraintIndex = source.indexOf("ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard'))")

    assert.ok(cleanupModelsIndex >= 0)
    assert.ok(providerConstraintIndex > cleanupModelsIndex)
    assert.ok(cleanupBatchesIndex >= 0)
    assert.ok(batchConstraintIndex > cleanupBatchesIndex)
    assert.match(source, /DELETE FROM team_model_configs[\s\S]+provider_models/)
  })

  test('音乐表注册 updated_at 触发器', async () => {
    const source = await readFile(join(__dirname, '../triggers.sql'), 'utf-8')

    assert.match(source, /DROP TRIGGER IF EXISTS trg_music_voice_clones_updated_at ON music_voice_clones/)
    assert.match(source, /CREATE TRIGGER trg_music_voice_clones_updated_at/)
    assert.match(source, /DROP TRIGGER IF EXISTS trg_music_tracks_updated_at ON music_tracks/)
    assert.match(source, /CREATE TRIGGER trg_music_tracks_updated_at/)
  })

  test('Mureka seed 缺少 API URL 时不会写入空 base_url 且不禁用模型', async () => {
    const source = await readFile(join(__dirname, '../scripts/seed.ts'), 'utf-8')

    assert.match(source, /const murekaApiBaseUrl = process\.env\.MUREKA_API_URL\?\.trim\(\)/)
    assert.doesNotMatch(source, /api_base_url: process\.env\.MUREKA_API_URL \?\? ''/)
    assert.doesNotMatch(source, /const murekaEnabled = Boolean\(murekaApiBaseUrl\)/)
    assert.match(source, /is_active: true/)
  })

  test('Mureka seed 不写入音色克隆伪模型并删除旧模型项', async () => {
    const source = await readFile(join(__dirname, '../scripts/seed.ts'), 'utf-8')

    assert.doesNotMatch(source, /code: 'mureka-voice-clone'/)
    assert.doesNotMatch(source, /model: 'mureka-voice-clone'/)
    assert.match(source, /mureka-8-voice-clone', 'mureka-9-voice-clone', 'mureka-voice-clone'/)
    assert.match(source, /deleteFrom\('provider_models'\)/)
  })
})
