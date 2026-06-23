// 必须在 import @aigc/db（间接拉入 storage）之前加载 .env
import './test-env.js'

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { persistReferenceImages } from './reference-images.js'

// persistReferenceImages 测试：参考图 base64 脱敏落 TOS，返回 URL 数组。
//
// 红线：base64 明文绝不入库/入日志——本测试核心验证两点：
//   1. 入参 data URI → 返回 TOS/S3 公网 URL（即被 uploadToTos 接管）
//   2. 返回值与函数副作用中不得残留 base64 明文（params 只存 URL）
//
// 上传依赖 STORAGE_DRIVER / TOS_* / S3_* 环境变量。本地默认 STORAGE_DRIVER=s3（MinIO），
// 真实上传到 MinIO 后只断言 URL 形态（以 S3_PUBLIC_URL 开头），不校验对象可下载
// （避免测试强依赖网络回读，保持与 transfer.ts worker 的 uploadToStorage 一致的写入语义）。

// 构造一张 1x1 PNG 的 data URI（base64 内容固定，便于"无残留"断言）
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`

// 构造一张 1x1 JPEG 的 data URI（验证多扩展名解析）
const JPEG_DATA_URI = `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4wNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AK//2Q==`

// 收集本测试上传的 TOS key，after 钩子清理（避免 MinIO/TOS 残留）
const uploadedKeys: string[] = []

describe('persistReferenceImages', () => {
  // 测试前从 S3_PUBLIC_URL 推断前缀（用于断言返回 URL 形态）
  const publicUrlPrefix = (process.env.S3_PUBLIC_URL ?? process.env.TOS_PUBLIC_URL ?? '').replace(/\/+$/, '')

  afterEach(async () => {
    // 清理上传对象：懒加载 deleteTosObject，避免未配置环境下的二次失败
    if (uploadedKeys.length === 0) return
    const { deleteTosObject } = await import('./storage.js')
    for (const key of uploadedKeys) {
      try {
        await deleteTosObject(key)
      } catch {
        // 对象可能已被删或 MinIO 未配置，忽略
      }
    }
    uploadedKeys.length = 0
  })

  test('null / undefined 入参 → 返回空数组（不调用上传）', async () => {
    assert.deepEqual(await persistReferenceImages(null), [])
    assert.deepEqual(await persistReferenceImages(undefined), [])
  })

  test('空数组入参 → 返回空数组', async () => {
    assert.deepEqual(await persistReferenceImages([]), [])
  })

  test('单张 base64 data URI → 返回 1 个 TOS URL，URL 以 publicUrl 开头', async () => {
    const urls = await persistReferenceImages(PNG_DATA_URI)
    assert.equal(urls.length, 1)
    if (publicUrlPrefix) {
      assert.ok(urls[0].startsWith(publicUrlPrefix), `URL 应以 ${publicUrlPrefix} 开头，实际：${urls[0]}`)
    }
    // 从 URL 反推 key 记录待清理
    const { extractStorageKey } = await import('./storage.js')
    const key = extractStorageKey(urls[0])
    if (key) uploadedKeys.push(key)
  })

  test('多张 base64 数组 → 返回等长 URL 数组', async () => {
    const urls = await persistReferenceImages([PNG_DATA_URI, JPEG_DATA_URI])
    assert.equal(urls.length, 2)
    const { extractStorageKey } = await import('./storage.js')
    for (const u of urls) {
      const key = extractStorageKey(u)
      if (key) uploadedKeys.push(key)
    }
  })

  test('已是 http(s) URL 的参考图 → 原样保留（不重新上传）', async () => {
    const external = 'https://example.com/ref.png'
    const urls = await persistReferenceImages(external)
    assert.deepEqual(urls, [external])
  })

  test('混合数组（URL + base64）→ URL 原样保留 + base64 转为 TOS URL', async () => {
    const external = 'https://cdn.example.com/a.png'
    const urls = await persistReferenceImages([external, PNG_DATA_URI])
    assert.equal(urls.length, 2)
    assert.equal(urls[0], external)
    assert.notEqual(urls[1], PNG_DATA_URI)
    assert.notEqual(urls[1], external)
    const { extractStorageKey } = await import('./storage.js')
    const key = extractStorageKey(urls[1])
    if (key) uploadedKeys.push(key)
  })

  test('返回值中绝不残留 base64 明文（脱敏红线）', async () => {
    const urls = await persistReferenceImages([PNG_DATA_URI, JPEG_DATA_URI])
    const serialized = JSON.stringify(urls)
    assert.equal(serialized.includes(PNG_BASE64), false, '返回值不得包含入参 base64 明文')
    assert.equal(serialized.includes('base64'), false, '返回 URL 不得含 base64 标记')
    const { extractStorageKey } = await import('./storage.js')
    for (const u of urls) {
      const key = extractStorageKey(u)
      if (key) uploadedKeys.push(key)
    }
  })

  test('jpeg 扩展名正确解析（key 以 .jpg/.jpeg 结尾）', async () => {
    const urls = await persistReferenceImages(JPEG_DATA_URI)
    assert.equal(urls.length, 1)
    // jpeg 解析出的扩展名为 jpg 或 jpeg（实现以 MIME image/jpeg → jpg 为准）
    assert.ok(/\.jpe?g$/i.test(urls[0]), `jpeg URL 应以 .jpg/.jpeg 结尾，实际：${urls[0]}`)
    const { extractStorageKey } = await import('./storage.js')
    const key = extractStorageKey(urls[0])
    if (key) uploadedKeys.push(key)
  })
})
