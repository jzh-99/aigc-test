import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { getAcceptedReferenceFiles, type PendingReferenceFile } from './video-reference-upload'

const createFile = (name: string, type: string): PendingReferenceFile => ({ name, type })

describe('video-reference-upload', () => {
  test('按类型累计已有素材与本次批量文件，限制内全部接收', () => {
    const result = getAcceptedReferenceFiles(
      [
        createFile('a.png', 'image/png'),
        createFile('b.png', 'image/png'),
        createFile('c.mp4', 'video/mp4'),
        createFile('d.mp3', 'audio/mpeg'),
      ],
      { image: 1, video: 0, audio: 0, text: 0 },
      { image: 3, video: 2, audio: 1, text: 0 },
    )

    assert.deepEqual(result.accepted.map((item) => item.file.name), ['a.png', 'b.png', 'c.mp4', 'd.mp3'])
    assert.deepEqual(result.rejected, [])
  })

  test('超过模型类型上限时返回可接收文件和被拒绝文件', () => {
    const result = getAcceptedReferenceFiles(
      [
        createFile('a.png', 'image/png'),
        createFile('b.png', 'image/png'),
        createFile('c.mp4', 'video/mp4'),
        createFile('d.mp4', 'video/mp4'),
      ],
      { image: 1, video: 1, audio: 0, text: 0 },
      { image: 2, video: 2, audio: 0, text: 0 },
    )

    assert.deepEqual(result.accepted.map((item) => item.file.name), ['a.png', 'c.mp4'])
    assert.deepEqual(result.rejected, [
      { file: createFile('b.png', 'image/png'), message: '最多添加 2 张参考图' },
      { file: createFile('d.mp4', 'video/mp4'), message: '最多添加 2 个参考视频' },
    ])
  })

  test('模型不支持某类型时拒绝该类型文件', () => {
    const result = getAcceptedReferenceFiles(
      [createFile('a.mp3', 'audio/mpeg')],
      { image: 0, video: 0, audio: 0, text: 0 },
      { image: 1, video: 1, audio: 0, text: 0 },
    )

    assert.deepEqual(result.accepted, [])
    assert.deepEqual(result.rejected, [
      { file: createFile('a.mp3', 'audio/mpeg'), message: '最多添加 0 个参考音频' },
    ])
  })

  test('拒绝不支持的文件格式', () => {
    const result = getAcceptedReferenceFiles(
      [createFile('a.txt', 'text/plain')],
      { image: 0, video: 0, audio: 0, text: 0 },
      { image: 1, video: 1, audio: 1, text: 0 },
    )

    assert.deepEqual(result.accepted, [])
    assert.deepEqual(result.rejected, [
      { file: createFile('a.txt', 'text/plain'), message: '文件「a.txt」格式不支持' },
    ])
  })
})
