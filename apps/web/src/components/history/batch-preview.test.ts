import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { getBatchImagePreviewUrls, getBatchVideoPreviewUrl, getBatchResourceTypes } from './batch-preview'

const createTask = (type: 'image' | 'video' | 'audio', url: string) => ({
  id: `${type}-task`,
  status: 'completed' as const,
  asset: {
    type,
    storage_url: url,
    original_url: null,
  },
})

describe('batch-preview', () => {
  test('图片预览只返回图片资源，忽略音频资源', () => {
    const urls = getBatchImagePreviewUrls({
      thumbnail_urls: ['https://cdn.example.com/audio.mp3'],
      tasks: [
        createTask('audio', 'https://cdn.example.com/audio.mp3'),
        createTask('image', 'https://cdn.example.com/image.png'),
      ],
    })

    assert.deepEqual(urls, ['https://cdn.example.com/image.png'])
  })

  test('视频预览只返回视频资源，忽略音频资源', () => {
    const url = getBatchVideoPreviewUrl({
      thumbnail_urls: ['https://cdn.example.com/audio.mp3'],
      tasks: [
        createTask('audio', 'https://cdn.example.com/audio.mp3'),
        createTask('video', 'https://cdn.example.com/video.mp4'),
      ],
    })

    assert.equal(url, 'https://cdn.example.com/video.mp4')
  })

  test('getBatchResourceTypes 从 resources 提取类型并去重', () => {
    const types = getBatchResourceTypes({
      resources: [
        { url: 'https://cdn.example.com/img1.png', type: 'image' },
        { url: 'https://cdn.example.com/img2.png', type: 'image' },
        { url: 'https://cdn.example.com/audio.mp3', type: 'audio' },
        { url: 'https://cdn.example.com/video.mp4', type: 'video' },
        { url: 'https://cdn.example.com/audio2.mp3', type: 'audio' },
      ],
    })

    assert.deepEqual(types, ['image', 'audio', 'video'])
  })

  test('getBatchResourceTypes 从 tasks 回退提取类型', () => {
    const types = getBatchResourceTypes({
      tasks: [
        createTask('image', 'https://cdn.example.com/img1.png'),
        createTask('image', 'https://cdn.example.com/img2.png'),
        createTask('video', 'https://cdn.example.com/video.mp4'),
        createTask('audio', 'https://cdn.example.com/audio.mp3'),
      ],
    })

    assert.deepEqual(types, ['image', 'video', 'audio'])
  })

  test('getBatchResourceTypes 优先使用 resources 而非 tasks', () => {
    const types = getBatchResourceTypes({
      resources: [
        { url: 'https://cdn.example.com/audio.mp3', type: 'audio' },
      ],
      tasks: [
        createTask('image', 'https://cdn.example.com/img.png'),
      ],
    })

    assert.deepEqual(types, ['audio'])
  })

  test('getBatchResourceTypes 空批次返回空数组', () => {
    const types = getBatchResourceTypes({})
    assert.deepEqual(types, [])
  })
})
