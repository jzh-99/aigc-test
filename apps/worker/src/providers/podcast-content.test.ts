// 播客内容预处理 + PDF 脱敏测试（Phase 5）。
//
// 测试目标：
//   - isPdfBase64Content：判定 content 是否为需脱敏的 PDF base64
//   - uploadPdfBase64ToTos：mock TOS putObject，验证 base64 解码 + key 格式 + 返回 URL
//   - resolvePodcastContent：text/file/url 三种内容预处理分流
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isPdfBase64Content,
  uploadPdfBase64ToTos,
  resolvePodcastContent,
  MASKED_PDF_CONTENT,
  type TosUploader,
} from './podcast-content.js'

// ─── mock TOS uploader：记录 putObject 调用 ──────────────────────────────────
function createMockUploader(): { uploader: TosUploader; calls: Array<{ key: string; contentType: string; bodyLength: number }> } {
  const calls: Array<{ key: string; contentType: string; bodyLength: number }> = []
  const uploader: TosUploader = {
    async putObject(params) {
      calls.push({
        key: params.key,
        contentType: params.contentType,
        bodyLength: params.body.length,
      })
    },
  }
  return { uploader, calls }
}

// 最小 PDF base64（"%PDF-1.4" 的 base64）
const MINIMAL_PDF_BASE64 = 'JVBERi0xLjQ='

describe('isPdfBase64Content（PDF base64 判定）', () => {
  test('content_type=file + 纯 base64 → true（需脱敏）', () => {
    assert.equal(isPdfBase64Content('file', MINIMAL_PDF_BASE64), true)
  })
  test('content_type=file + data URI → true', () => {
    assert.equal(isPdfBase64Content('file', `data:application/pdf;base64,${MINIMAL_PDF_BASE64}`), true)
  })
  test('content_type=file + http URL → false（已是 URL，无需脱敏）', () => {
    assert.equal(isPdfBase64Content('file', 'https://tos.example.com/x.pdf'), false)
  })
  test('content_type=file + https URL → false', () => {
    assert.equal(isPdfBase64Content('file', 'http://tos.example.com/x.pdf'), false)
  })
  test('content_type=text → false', () => {
    assert.equal(isPdfBase64Content('text', '一些文本'), false)
  })
  test('content_type=url → false', () => {
    assert.equal(isPdfBase64Content('url', 'https://x.com'), false)
  })
})

describe('uploadPdfBase64ToTos（PDF base64 → TOS 脱敏）', () => {
  test('纯 base64 上传：解码 + key 格式 + contentType=application/pdf', async () => {
    const { uploader, calls } = createMockUploader()
    const result = await uploadPdfBase64ToTos(MINIMAL_PDF_BASE64, 'task-001', uploader)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].contentType, 'application/pdf')
    // key 格式：assets/podcast/<taskId>/<uuid>.pdf
    assert.match(calls[0].key, /^assets\/podcast\/task-001\/[0-9a-f-]+\.pdf$/)
    // 返回 URL 包含 key
    assert.ok(result.storageUrl.includes(calls[0].key))
    // body 解码正确（%PDF-1.4 = 8 字节）
    assert.equal(calls[0].bodyLength, 8)
  })

  test('data URI 前缀的 base64：剥离前缀后上传', async () => {
    const { uploader, calls } = createMockUploader()
    const dataUri = `data:application/pdf;base64,${MINIMAL_PDF_BASE64}`
    await uploadPdfBase64ToTos(dataUri, 'task-002', uploader)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].bodyLength, 8, '应剥离 data URI 前缀后解码')
  })

  test('空 base64 抛错', async () => {
    const { uploader } = createMockUploader()
    await assert.rejects(() => uploadPdfBase64ToTos('', 'task-003', uploader), /为空/)
  })

  test('MASKED_PDF_CONTENT 占位符为 data:application/pdf;base64,<masked>', () => {
    assert.equal(MASKED_PDF_CONTENT, 'data:application/pdf;base64,<masked>')
  })
})

describe('resolvePodcastContent（内容预处理分流）', () => {
  test('sourceFileUrl 非空（路由层已转 TOS）→ 用该 URL', () => {
    const result = resolvePodcastContent({
      contentType: 'file',
      content: 'data:application/pdf;base64,xxx',
      sourceFileUrl: 'https://tos.example.com/task-001/abc.pdf',
    })
    assert.equal(result.content, 'https://tos.example.com/task-001/abc.pdf')
    assert.equal(result.isUrl, true)
  })

  test('content_type=text → 直接用文本', () => {
    const result = resolvePodcastContent({
      contentType: 'text',
      content: '播客正文',
    })
    assert.equal(result.content, '播客正文')
    assert.equal(result.isUrl, false)
  })

  test('content_type=url → 直接用 URL', () => {
    const result = resolvePodcastContent({
      contentType: 'url',
      content: 'https://example.com/article',
    })
    assert.equal(result.content, 'https://example.com/article')
    assert.equal(result.isUrl, true)
  })

  test('content_type=file + content 已是 URL → 直接用', () => {
    const result = resolvePodcastContent({
      contentType: 'file',
      content: 'https://tos.example.com/x.pdf',
    })
    assert.equal(result.content, 'https://tos.example.com/x.pdf')
    assert.equal(result.isUrl, true)
  })
})
