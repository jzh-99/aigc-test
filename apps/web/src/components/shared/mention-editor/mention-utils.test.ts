import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  parseSegments,
  resolveMentionPrompt,
  limitPromptLength,
  escapeRegExp,
} from './mention-utils'
import type { MentionResource } from './types'

const imageResources: MentionResource[] = [
  { id: 'img-1', mentionLabel: '图片1', sourceLabel: '参考图1', kind: 'image' },
  { id: 'img-2', mentionLabel: '图片2', sourceLabel: '参考图2', kind: 'image' },
]

const mixedResources: MentionResource[] = [
  { id: 'img-1', mentionLabel: '图片1', kind: 'image' },
  { id: 'vid-1', mentionLabel: '视频1', kind: 'video' },
  { id: 'aud-1', mentionLabel: '音频1', kind: 'audio' },
]

const aliasResources: MentionResource[] = [
  { id: 'char-1', mentionLabel: '角色A', kind: 'character', aliases: ['A', '主角'] },
]

describe('parseSegments', () => {
  test('空字符串返回空数组', () => {
    assert.deepEqual(parseSegments('', imageResources), [])
  })

  test('无资源时返回纯文本段落', () => {
    assert.deepEqual(parseSegments('hello world', []), [
      { type: 'text', text: 'hello world' },
    ])
  })

  test('解析单个 @ 标签', () => {
    const segments = parseSegments('参考 @图片1 的风格', imageResources)
    assert.equal(segments.length, 3)
    assert.equal(segments[0].type, 'text')
    assert.equal((segments[0] as { type: 'text'; text: string }).text, '参考 ')
    assert.equal(segments[1].type, 'mention')
    assert.equal((segments[1] as { type: 'mention'; text: string }).text, '@图片1')
    assert.equal(segments[2].type, 'text')
    assert.equal((segments[2] as { type: 'text'; text: string }).text, ' 的风格')
  })

  test('解析多个不同类型的 @ 标签', () => {
    const segments = parseSegments('结合 @视频1 和 @音频1', mixedResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 2)
  })

  test('匹配别名', () => {
    const segments = parseSegments('画 @主角 站在门口', aliasResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 1)
    assert.equal((mentions[0] as { type: 'mention'; text: string }).text, '@主角')
  })

  test('不匹配连续 @@', () => {
    const segments = parseSegments('@@图片1', imageResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 0)
  })

  test('标签后紧跟逗号正常匹配', () => {
    const segments = parseSegments('@图片1，继续描述', imageResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 1)
  })
})

describe('resolveMentionPrompt', () => {
  test('将 @标签 替换为 <标签>', () => {
    assert.equal(
      resolveMentionPrompt('参考 @图片1 的风格生成', imageResources),
      '参考 <图片1> 的风格生成',
    )
  })

  test('多个标签全部替换', () => {
    assert.equal(
      resolveMentionPrompt('@图片1 和 @图片2', imageResources),
      '<图片1> 和 <图片2>',
    )
  })

  test('没有 @ 标签时原样返回', () => {
    assert.equal(
      resolveMentionPrompt('生成一张森林海报', imageResources),
      '生成一张森林海报',
    )
  })

  test('空资源列表时原样返回', () => {
    assert.equal(resolveMentionPrompt('@图片1', []), '@图片1')
  })

  test('别名也能替换', () => {
    assert.equal(
      resolveMentionPrompt('画 @主角', aliasResources),
      '画 <角色A>',
    )
  })
})

describe('limitPromptLength', () => {
  test('不超过最大长度时原样返回', () => {
    assert.equal(limitPromptLength('hello', 10), 'hello')
  })

  test('超过最大长度时截断', () => {
    assert.equal(limitPromptLength('hello world', 5), 'hello')
  })

  test('正确处理 emoji 等多字节字符', () => {
    assert.equal(limitPromptLength('🎉🎊🎈', 2), '🎉🎊')
  })
})

describe('escapeRegExp', () => {
  test('转义正则特殊字符', () => {
    assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c')
  })
})
