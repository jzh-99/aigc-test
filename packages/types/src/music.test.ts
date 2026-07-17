import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  isMusicModel,
  MUSIC_CUSTOM_TITLE_MAX_LENGTH,
  resolveMusicPricingKey,
  MUSIC_VOICE_DESCRIPTION_MAX_LENGTH,
  normalizeMusicTitle,
  normalizeVoiceCloneDescription,
} from './music.js'

describe('音乐类型校验', () => {
  test('识别支持的音乐模型', () => {
    assert.equal(isMusicModel('mureka-8'), true)
    assert.equal(isMusicModel('mureka-9'), true)
    assert.equal(isMusicModel('mureka-10'), false)
  })
})

describe('音乐标题标准化', () => {
  test('自定义标题长度上限为 20 字', () => {
    assert.equal(MUSIC_CUSTOM_TITLE_MAX_LENGTH, 20)
  })

  test('去除标题首尾空白', () => {
    assert.equal(normalizeMusicTitle('  星空来信  '), '星空来信')
  })

  test('标题 trim 后为空时抛出错误', () => {
    assert.throws(() => normalizeMusicTitle('   '), /标题不能为空/)
  })

  test('标题超过 20 字时抛出错误', () => {
    assert.throws(() => normalizeMusicTitle('一'.repeat(21)), /标题不能超过 20 字/)
  })
})

describe('声音克隆描述标准化', () => {
  test('声音描述长度上限为 1024 字', () => {
    assert.equal(MUSIC_VOICE_DESCRIPTION_MAX_LENGTH, 1024)
  })

  test('未填写声音描述时返回 null', () => {
    assert.equal(normalizeVoiceCloneDescription(undefined), null)
  })

  test('去除声音描述首尾空白', () => {
    assert.equal(normalizeVoiceCloneDescription('  温柔清亮  '), '温柔清亮')
  })

  test('声音描述超过 1024 字时抛出错误', () => {
    assert.throws(() => normalizeVoiceCloneDescription('a'.repeat(1025)), /描述不能超过 1024 字/)
  })
})

describe('音乐业务计费键', () => {
  test('三种产品模式映射到三种可配置价格', () => {
    assert.equal(resolveMusicPricingKey('inspiration', 'song'), 'inspiration_song')
    assert.equal(resolveMusicPricingKey('inspiration', 'instrumental'), 'instrumental')
    assert.equal(resolveMusicPricingKey('custom', 'song'), 'custom_song')
  })
})
