import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { extractStorageKey, normalizeStorageUrl } from '../lib/storage.js'
import { buildSystemVoiceDemoKey } from '../routes/models/get.js'

describe('storage url normalization', () => {
  test('从已签名 TOS URL 中提取真实 object key，不包含签名 query', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const signedUrl = 'https://toby-ai-dev.tos-cn-shanghai.volces.com/canvas-assets/demo.jpg?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Date=20260607T071739Z'

    assert.equal(extractStorageKey(signedUrl), 'canvas-assets/demo.jpg')
    assert.equal(normalizeStorageUrl(signedUrl), 'https://toby-ai-dev.tos-cn-shanghai.volces.com/canvas-assets/demo.jpg')
  })

  test('非本存储 URL 保持原样', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const externalUrl = 'https://example.com/image.jpg?token=1'

    assert.equal(extractStorageKey(externalUrl), null)
    assert.equal(normalizeStorageUrl(externalUrl), externalUrl)
  })

  test('含空格的 key：normalizeStorageUrl 保持 %20 编码，不出现裸空格', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const url = 'https://toby-ai-dev.tos-cn-shanghai.volces.com/system-voices/demos/minimax/Chinese%20(Mandarin)_Cute.mp3'
    assert.equal(
      normalizeStorageUrl(url),
      'https://toby-ai-dev.tos-cn-shanghai.volces.com/system-voices/demos/minimax/Chinese%20(Mandarin)_Cute.mp3',
    )
  })

  test('含括号的 key round-trip 自洽', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const url = 'https://toby-ai-dev.tos-cn-shanghai.volces.com/path/(group)%20item.jpg'
    assert.equal(normalizeStorageUrl(url), url)
    assert.equal(extractStorageKey(url), 'path/(group) item.jpg')
  })

  test('含中文的 key round-trip 自洽', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const url = 'https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/%E6%88%91%E7%9A%84%E5%BD%95%E9%9F%B3.mp3'
    assert.equal(normalizeStorageUrl(url), url)
    assert.equal(extractStorageKey(url), 'demos/我的录音.mp3')
  })

  test('已含 %20 的脏 URL：extractStorageKey 解码成空格（钉死数据迁移需求）', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const url = 'https://toby-ai-dev.tos-cn-shanghai.volces.com/system-voices/demos/minimax/Chinese%20(Mandarin)_Cute.mp3'
    assert.equal(extractStorageKey(url), 'system-voices/demos/minimax/Chinese (Mandarin)_Cute.mp3')
  })

  test('防双重编码：normalizeStorageUrl 对已编码 URL 不二次编码', () => {
    process.env.TOS_PUBLIC_URL = 'https://toby-ai-dev.tos-cn-shanghai.volces.com'
    const url = 'https://toby-ai-dev.tos-cn-shanghai.volces.com/a%20b.jpg'
    const out = normalizeStorageUrl(url)
    assert.equal(out, url)
    assert.ok(!out || !out.includes('%25'))
  })
})

describe('system voice demo key', () => {
  test('key 存原始字符，不含 encodeURIComponent 产生的 %20', () => {
    assert.equal(
      buildSystemVoiceDemoKey('Chinese (Mandarin)_Cute_Spirit'),
      'system-voices/demos/minimax/Chinese (Mandarin)_Cute_Spirit.mp3',
    )
  })
})
