import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  getCanvasUploadMediaKind,
  getNodeUploadRule,
  getUploadAccept,
  isFileAllowedForUploadTarget,
} from './media-upload-rules'

describe('media-upload-rules', () => {
  test('识别图片、视频和音频文件', () => {
    assert.equal(getCanvasUploadMediaKind({ type: 'image/png' }), 'image')
    assert.equal(getCanvasUploadMediaKind({ type: 'video/mp4' }), 'video')
    assert.equal(getCanvasUploadMediaKind({ type: 'audio/mpeg' }), 'audio')
    assert.equal(getCanvasUploadMediaKind({ type: 'application/pdf' }), null)
  })

  test('空白画布上传允许图片、视频和音频', () => {
    assert.equal(getUploadAccept({ kind: 'canvas' }), 'image/*,video/*,audio/*')
    assert.equal(isFileAllowedForUploadTarget({ type: 'image/webp' }, { kind: 'canvas' }), true)
    assert.equal(isFileAllowedForUploadTarget({ type: 'video/quicktime' }, { kind: 'canvas' }), true)
    assert.equal(isFileAllowedForUploadTarget({ type: 'audio/wav' }, { kind: 'canvas' }), true)
  })

  test('图片、视频和音频节点只允许上传同类资源', () => {
    const imageRule = getNodeUploadRule({ type: 'image_gen', data: { label: '图片', config: {} } } as any)
    const videoRule = getNodeUploadRule({ type: 'video_gen', data: { label: '视频', config: {} } } as any)
    const audioRule = getNodeUploadRule({ type: 'audio_gen', data: { label: '音频', config: {} } } as any)

    assert.deepEqual(imageRule, { kind: 'node', nodeId: undefined, mediaKind: 'image', uploadMode: 'output' })
    assert.deepEqual(videoRule, { kind: 'node', nodeId: undefined, mediaKind: 'video', uploadMode: 'output' })
    assert.deepEqual(audioRule, { kind: 'node', nodeId: undefined, mediaKind: 'audio', uploadMode: 'output' })
    assert.equal(getUploadAccept(imageRule), 'image/*')
    assert.equal(getUploadAccept(videoRule), 'video/*')
    assert.equal(getUploadAccept(audioRule), 'audio/*')
    assert.equal(isFileAllowedForUploadTarget({ type: 'image/jpeg' }, imageRule), true)
    assert.equal(isFileAllowedForUploadTarget({ type: 'video/mp4' }, imageRule), false)
    assert.equal(isFileAllowedForUploadTarget({ type: 'video/mp4' }, videoRule), true)
    assert.equal(isFileAllowedForUploadTarget({ type: 'image/jpeg' }, videoRule), false)
    assert.equal(isFileAllowedForUploadTarget({ type: 'audio/mpeg' }, audioRule), true)
    assert.equal(isFileAllowedForUploadTarget({ type: 'image/jpeg' }, audioRule), false)
  })
})
