import assert from 'node:assert/strict'
import {
  PICTURE_BOOK_PAGE_COUNTS,
  PICTURE_BOOK_STYLES,
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

const state = makeDefaultPictureBookState({ style: '吉卜力风', pageCount: 15 })
assert.equal(state.steps.active, 'script')
assert.equal(state.settings.imageModel, 'seedream-5.0-lite')
assert.equal(state.settings.ttsModel, 'speech-2.8-hd')
assert.equal(state.settings.textModel, 'qwen3.6-plus')
assert.equal(state.settings.billingMode, 'project')

const normalized = normalizePictureBookState({ settings: { style: '坏值', pageCount: 12 } })
assert.equal(normalized.settings.style, '吉卜力风')
assert.equal(normalized.settings.pageCount, 10)
