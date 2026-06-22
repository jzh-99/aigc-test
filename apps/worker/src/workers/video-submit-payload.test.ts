import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCtyunEdgeTaskBody, buildVolcengineTaskBody } from './video-submit-payload.js'

test('多模态参考图带 reference_image 角色，避免被火山识别为首尾帧', () => {
  const body = buildVolcengineTaskBody('seedance-2.0', '生成小猪吃奶视频', {
    video_category: 'multimodal',
    reference_images: ['https://cdn.test/pig.jpg'],
    reference_videos: ['https://cdn.test/pig.mp4'],
  })

  assert.deepEqual(body.content, [
    { type: 'text', text: '生成小猪吃奶视频' },
    { type: 'image_url', image_url: { url: 'https://cdn.test/pig.jpg' }, role: 'reference_image' },
    { type: 'video_url', video_url: { url: 'https://cdn.test/pig.mp4' }, role: 'reference_video' },
  ])
})

test('首尾帧图片显式带 first_frame 和 last_frame 角色', () => {
  const body = buildVolcengineTaskBody('seedance-2.0', '从首帧过渡到尾帧', {
    video_category: 'frames',
    images: ['https://cdn.test/start.jpg', 'https://cdn.test/end.jpg'],
  })

  assert.deepEqual(body.content, [
    { type: 'text', text: '从首帧过渡到尾帧' },
    { type: 'image_url', image_url: { url: 'https://cdn.test/start.jpg' }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: 'https://cdn.test/end.jpg' }, role: 'last_frame' },
  ])
})

test('全能参考模式允许不传任何参考资源', () => {
  const body = buildVolcengineTaskBody('seedance-2.0', '纯文本生成一个广告片', {
    video_category: 'multimodal',
  })

  assert.deepEqual(body.content, [
    { type: 'text', text: '纯文本生成一个广告片' },
  ])
})

test('Seedance 2.0 时长使用官方 duration 整数秒字段，避免落入默认 5 秒', () => {
  const unsupportedCameraParam = ['camera', 'fixed'].join('_')
  const body = buildVolcengineTaskBody('seedance-2.0', '生成 15 秒广告片', {
    duration: 15,
    [unsupportedCameraParam]: true,
  })

  assert.equal(body.duration, 15)
  assert.equal('parameters' in body, false)
  assert.equal(unsupportedCameraParam in body, false)
})

test('天翼云边缘 Seedance 2.0 映射到 cdance2.0-0611', () => {
  const body = buildCtyunEdgeTaskBody('ctyun-seedance-2.0', '生成一段短剧视频', {
    aspect_ratio: '16:9',
    duration: 8,
    resolution: '720p',
    generate_audio: true,
    reference_images: ['https://cdn.test/role.jpg'],
  })

  assert.equal(body.model, 'cdance2.0-0611')
  assert.equal(body.ratio, '16:9')
  assert.equal(body.duration, 8)
  assert.equal(body.resolution, '720p')
  assert.equal(body.generate_audio, true)
  assert.deepEqual(body.content, [
    { type: 'text', text: '生成一段短剧视频' },
    { type: 'image_url', image_url: { url: 'https://cdn.test/role.jpg' }, role: 'reference_image' },
  ])
})

test('天翼云边缘 Seedance 2.0 Fast 映射到 cdance2.0-fast-0611', () => {
  const body = buildCtyunEdgeTaskBody('ctyun-seedance-2.0-fast', '生成快速预览视频', {})

  assert.equal(body.model, 'cdance2.0-fast-0611')
})
