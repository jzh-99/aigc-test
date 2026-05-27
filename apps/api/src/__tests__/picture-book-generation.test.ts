import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildAssetPromptUserPrompt, normalizeAssetPromptResult } from '../routes/picture-book/post-asset-prompts.js'
import { buildScriptUserPrompt, normalizeScriptResult } from '../routes/picture-book/post-script.js'
import { buildStoryboardPromptUserPrompt, normalizeStoryboardPromptResult } from '../routes/picture-book/post-storyboard-prompts.js'

describe('picture book Qwen generation helpers', () => {
  test('buildScriptUserPrompt 明确故事摘要仅中文且每页台词/旁白双语', () => {
    const prompt = buildScriptUserPrompt({
      prompt: '一只小狗第一次去月亮上交朋友',
      style: '吉卜力风',
      pageCount: 10,
    })

    assert.match(prompt, /故事摘要只输出中文/)
    assert.match(prompt, /10 页/)
    assert.match(prompt, /dialogue\.zh/)
    assert.match(prompt, /narration\.en/)
  })

  test('normalizeScriptResult 补齐页码和双语台词字段', () => {
    const result = normalizeScriptResult({
      title: '月亮朋友',
      summaryZh: '小狗在月亮上学会分享。',
      pages: [{ narration: { zh: '夜晚到了。' }, dialogue: { en: 'Hello moon.' }, visualPrompt: '月光下的小狗' }],
    }, 2)

    assert.equal(result.title, '月亮朋友')
    assert.equal(result.summaryZh, '小狗在月亮上学会分享。')
    assert.equal(result.pages.length, 2)
    assert.deepEqual(result.pages[0], {
      page: 1,
      narration: { zh: '夜晚到了。', en: '' },
      dialogue: { zh: '', en: 'Hello moon.' },
      visualPrompt: '月光下的小狗',
    })
    assert.equal(result.pages[1].page, 2)
  })

  test('asset prompt helper 使用角色/背景页签且不要求自动生成图片', () => {
    const prompt = buildAssetPromptUserPrompt({
      style: '彩铅蜡笔风',
      summaryZh: '小女孩和云朵旅行。',
      pages: [],
    })

    assert.match(prompt, /只生成提示词/)
    assert.match(prompt, /characters/)
    assert.match(prompt, /backgrounds/)

    const result = normalizeAssetPromptResult({
      characters: [{ name: '小女孩', prompt: '彩铅风，小女孩角色设定图' }],
      backgrounds: [{ name: '云朵小镇', prompt: '彩铅风，云朵小镇背景设定图' }],
    })

    assert.equal(result.characters[0].id, 'character_1')
    assert.equal(result.characters[0].imageUrl, null)
    assert.equal(result.backgrounds[0].id, 'background_1')
  })

  test('storyboard prompt helper 保留脚本单语结构并输出双语音频文本', () => {
    const prompt = buildStoryboardPromptUserPrompt({
      style: '经典水彩风',
      pages: [{ page: 1, narration: { zh: '你好。', en: 'Hello.' }, dialogue: { zh: '', en: '' }, visualPrompt: '花园' }],
      characters: [{ id: 'character_1', name: '小狗', prompt: '小狗设定图', imageUrl: null }],
      backgrounds: [],
    })

    assert.match(prompt, /imagePrompt/)
    assert.match(prompt, /audioText\.zh/)
    assert.match(prompt, /audioText\.en/)

    const result = normalizeStoryboardPromptResult({
      pages: [{ imagePrompt: '水彩花园里的小狗', audioText: { zh: '你好。', en: 'Hello.' } }],
    }, [{ page: 1, narration: { zh: '你好。', en: 'Hello.' }, dialogue: { zh: '', en: '' } }])

    assert.equal(result[0].page, 1)
    assert.equal(result[0].prompt, '水彩花园里的小狗')
    assert.equal(result[0].script.narration.en, 'Hello.')
    assert.equal(result[0].voice.zh, null)
  })
})
