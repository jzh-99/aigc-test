import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { makePictureBookImageParams, selectAssetTargets } from '../routes/picture-book/post-generate-assets.js'
import {
  findStoryboardReferenceImages,
  makeStoryboardAudioText,
  selectStoryboardImageTargets,
} from '../routes/picture-book/post-generate-storyboard-images.js'

describe('picture book media helpers', () => {
  test('makePictureBookImageParams 为 seedream 生成稳定 seed 和默认参数', () => {
    const params = makePictureBookImageParams('project-a', 'character_1', '吉卜力风')

    assert.equal(params.resolution, '2K')
    assert.equal(params.aspect_ratio, '16:9')
    assert.equal(params.watermark, false)
    assert.equal(typeof params.seed, 'number')
    assert.equal(params.style, '吉卜力风')
  })

  test('makePictureBookImageParams 使用项目比例传给图片生成参数', () => {
    const params = makePictureBookImageParams('project-a', 'page_1', '吉卜力风', '9:16')

    assert.equal(params.aspect_ratio, '9:16')
  })

  test('selectAssetTargets 默认选择全部角色和背景，也支持按 ref_id 过滤', () => {
    const state = {
      assets: {
        characters: [{ id: 'character_1', name: '小狗', prompt: '小狗设定图', imageUrl: null }],
        backgrounds: [{ id: 'background_1', name: '客厅', prompt: '客厅设定图', imageUrl: null }],
      },
    }

    assert.equal(selectAssetTargets(state as any, undefined).length, 2)
    assert.deepEqual(selectAssetTargets(state as any, [{ kind: 'background', ref_id: 'background_1' }]).map(item => item.refId), ['background_1'])
  })

  test('selectStoryboardImageTargets 默认选择全部分镜图', () => {
    const state = {
      storyboard: [
        { page: 1, prompt: '第一页画面', script: { narration: { zh: '你好', en: 'Hello' }, dialogue: { zh: '', en: '' } } },
        { page: 2, prompt: '第二页画面', script: { narration: { zh: '再见', en: 'Bye' }, dialogue: { zh: '', en: '' } } },
      ],
    }

    assert.deepEqual(selectStoryboardImageTargets(state as any, undefined).map(item => item.refId), ['page_1', 'page_2'])
  })

  test('findStoryboardReferenceImages 从 @ 标记匹配角色和背景图片并去重', () => {
    const state = {
      assets: {
        characters: [
          { id: 'character_1', name: '小狗', prompt: '小狗设定图', imageUrl: 'https://img.test/dog.png' },
          { id: 'character_2', name: '小猫', prompt: '小猫设定图', imageUrl: null },
        ],
        backgrounds: [
          { id: 'background_1', name: '花园', prompt: '花园设定图', imageUrl: 'https://img.test/garden.png' },
        ],
      },
    }

    assert.deepEqual(
      findStoryboardReferenceImages('@小狗 在 @花园 遇见 @小狗 和 @小猫', state as any),
      ['https://img.test/dog.png', 'https://img.test/garden.png'],
    )
  })

  test('findStoryboardReferenceImages 不匹配普通文字里的名称', () => {
    const state = {
      assets: {
        characters: [{ id: 'character_1', name: '小狗', prompt: '小狗设定图', imageUrl: 'https://img.test/dog.png' }],
        backgrounds: [],
      },
    }

    assert.deepEqual(findStoryboardReferenceImages('小狗在奔跑，没有 @ 标记', state as any), [])
  })

  test('makeStoryboardAudioText 合并旁白和台词，并按语言返回', () => {
    const page = {
      script: {
        narration: { zh: '小狗抬头看月亮。', en: 'The puppy looks at the moon.' },
        dialogue: { zh: '你好，月亮。', en: 'Hello, moon.' },
      },
    }

    assert.equal(makeStoryboardAudioText(page as any, 'zh'), '小狗抬头看月亮。\n你好，月亮。')
    assert.equal(makeStoryboardAudioText(page as any, 'en'), 'The puppy looks at the moon.\nHello, moon.')
  })
})
