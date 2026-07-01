import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeDataUrl } from './data-url.js'

// Gemini 图片适配器只能返回 inline base64（data: URL），无法像 OpenAI 路径那样请求 url。
// transfer worker 必须能把 data: URL 直接解码成 buffer 上传 TOS，否则这类图片永远卡在 SSRF 校验。
test('decodeDataUrl 解析 base64 data URL 为 buffer 和 contentType', () => {
  // 1x1 透明 PNG 的 base64
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const dataUrl = `data:image/png;base64,${pngBase64}`

  const result = decodeDataUrl(dataUrl)

  assert.equal(result.contentType, 'image/png')
  // 解码后的字节长度应等于原始 base64 解码后的长度
  const expectedLength = Buffer.from(pngBase64, 'base64').length
  assert.equal(result.buffer.length, expectedLength)
  // 内容一致（首字节为 PNG 魔数 0x89）
  assert.equal(result.buffer[0], 0x89)
  assert.equal(result.buffer[1], 0x50) // 'P'
})

test('decodeDataUrl 支持 jpeg / webp 等 mime 类型', () => {
  const jpeg = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAAAAAAAAAAAAAAAAAAAAAAAA/9k='
  const result = decodeDataUrl(`data:image/jpeg;base64,${jpeg}`)
  assert.equal(result.contentType, 'image/jpeg')
  assert.equal(result.buffer[0], 0xff) // JPEG 魔数 0xFF 0xD8
  assert.equal(result.buffer[1], 0xd8)
})

test('decodeDataUrl 拒绝非 data: 协议（应由 http/https 下载分支处理）', () => {
  assert.throws(
    () => decodeDataUrl('https://example.com/image.png'),
    /data: URL/,
  )
})

test('decodeDataUrl 拒绝缺少 base64 数据的 data: URL', () => {
  assert.throws(
    () => decodeDataUrl('data:image/png;base64,'),
    /payload 为空/,
  )
  assert.throws(
    () => decodeDataUrl('data:image/png;base64'),
    /payload 为空/,
  )
})
