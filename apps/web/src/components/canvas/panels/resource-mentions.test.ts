import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildPromptWithResourceMentions, type CanvasReferenceMentionResource } from './resource-mentions'

const resources: CanvasReferenceMentionResource[] = [
  { id: 'image-1', url: 'https://cdn.test/image-1.jpg', type: 'image', mentionLabel: '图片1', sourceLabel: '图片节点1' },
  { id: 'image-2', url: 'https://cdn.test/image-2.jpg', type: 'image', mentionLabel: '图片2', sourceLabel: '图片节点2' },
  { id: 'video-1', url: 'https://cdn.test/video-1.mp4', type: 'video', mentionLabel: '视频1', sourceLabel: '视频节点1' },
  { id: 'audio-1', url: 'https://cdn.test/audio-1.mp3', type: 'audio', mentionLabel: '音频1', sourceLabel: '音频节点1' },
]

describe('buildPromptWithResourceMentions', () => {
  test('图片引用使用官方参考句式，并保留完整生成意图', () => {
    const prompt = buildPromptWithResourceMentions([], '@图片2 帮 @图片1 找妈妈', resources)

    assert.equal(prompt, [
      '图片参考：参考<图片2>中的主体/角色，参考<图片1>中的主体/角色。',
      '生成：<图片2> 帮 <图片1> 找妈妈',
    ].join('\n'))
  })

  test('视频和音频引用使用官方多模态参考句式', () => {
    const prompt = buildPromptWithResourceMentions([], '结合 @视频1 的动作和 @音频1 的声音氛围，生成广告短片', resources)

    assert.equal(prompt, [
      '视频参考：参考<视频1>中的动作/运镜/风格/音效。',
      '音频参考：参考<音频1>中的音色。',
      '生成：结合 <视频1> 的动作和 <音频1> 的声音氛围，生成广告短片',
    ].join('\n'))
  })

  test('没有资源引用时保持原始提示词结构', () => {
    const prompt = buildPromptWithResourceMentions(['上游文本'], '生成一张森林海报', resources)

    assert.equal(prompt, '上游文本\n生成一张森林海报')
  })

})
