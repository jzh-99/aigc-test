import assert from 'node:assert/strict'
import {
  PICTURE_BOOK_IMAGE_MODEL,
  PICTURE_BOOK_PAGE_COUNTS,
  PICTURE_BOOK_STYLES,
  PICTURE_BOOK_TEXT_MODEL,
  PICTURE_BOOK_TTS_MODEL,
  isPictureBookPageCount,
  isPictureBookStyle,
  makeDefaultPictureBookState,
  normalizePictureBookState,
} from './picture-book.js'

assert.deepEqual(PICTURE_BOOK_PAGE_COUNTS, [10, 15, 20])
assert.equal(isPictureBookPageCount(10), true)
assert.equal(isPictureBookPageCount(12), false)
assert.equal(isPictureBookStyle('吉卜力风'), true)
assert.equal(isPictureBookStyle('赛博朋克'), false)
assert.equal(PICTURE_BOOK_STYLES.includes('梦幻光影厚涂风'), true)
assert.equal(PICTURE_BOOK_TEXT_MODEL, 'qwen3.6-plus')
assert.equal(PICTURE_BOOK_IMAGE_MODEL, 'seedream-5.0-lite')
assert.equal(PICTURE_BOOK_TTS_MODEL, 'speech-2.8-hd')

const state = makeDefaultPictureBookState({ style: '吉卜力风', pageCount: 15 })
assert.equal(state.steps.active, 'script')
assert.equal(state.settings.imageModel, 'seedream-5.0-lite')
assert.equal(state.settings.ttsModel, 'speech-2.8-hd')
assert.equal(state.settings.textModel, 'qwen3.6-plus')
assert.equal(state.settings.billingMode, 'project')
assert.deepEqual(state.script, { summaryZh: '', pages: [] })
assert.deepEqual(state.assets, { characters: [], backgrounds: [] })
assert.deepEqual(state.storyboard, [])
assert.deepEqual(state.draft, { dirty: false })

const normalized = normalizePictureBookState({ settings: { style: '坏值', pageCount: 12 } })
assert.equal(normalized.settings.style, '吉卜力风')
assert.equal(normalized.settings.pageCount, 10)

const normalizedNull = normalizePictureBookState(null)
assert.equal(normalizedNull.steps.active, 'script')
assert.equal(normalizedNull.settings.style, '吉卜力风')
assert.equal(normalizedNull.settings.pageCount, 10)

const normalizedString = normalizePictureBookState('bad')
assert.equal(normalizedString.steps.active, 'script')
assert.equal(normalizedString.settings.style, '吉卜力风')
assert.equal(normalizedString.settings.pageCount, 10)

const normalizedNullSettings = normalizePictureBookState({ settings: null })
assert.equal(normalizedNullSettings.steps.active, 'script')
assert.equal(normalizedNullSettings.settings.style, '吉卜力风')
assert.equal(normalizedNullSettings.settings.pageCount, 10)
