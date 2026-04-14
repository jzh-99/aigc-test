import { expect, test } from '@playwright/test'
import { mockCanvasEditor } from '../fixtures/api-mocks'
import {
  createAssetNode,
  createEdge,
  createTextNode,
  createVideoNode,
} from '../fixtures/canvas'

test.describe('canvas video submit', () => {
  test.use({ viewport: { width: 1600, height: 1200 } })
  test('submits multiref payload with image/video/audio references', async ({ page }) => {
    const canvasId = 'canvas-video-multiref'
    const submissions: Array<Record<string, unknown>> = []

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createTextNode({ id: 'text-1', label: '提示词', text: '一只猫在太空站行走' }),
        createAssetNode({
          id: 'asset-img-1',
          label: '参考图',
          url: 'https://cdn.test/ref-image-1.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 260 },
        }),
        createAssetNode({
          id: 'asset-video-1',
          label: '参考视频',
          url: 'https://cdn.test/ref-video-1.mp4',
          mimeType: 'video/mp4',
          position: { x: 360, y: 380 },
        }),
        createAssetNode({
          id: 'asset-audio-1',
          label: '参考音频',
          url: 'https://cdn.test/ref-audio-1.mp3',
          mimeType: 'audio/mpeg',
          position: { x: 360, y: 500 },
        }),
        createVideoNode({ id: 'video-1', label: '视频节点', videoMode: 'multiref' }),
      ],
      edges: [
        createEdge({ id: 'e-text-video', source: 'text-1', target: 'video-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-img-video', source: 'asset-img-1', target: 'video-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-video-video', source: 'asset-video-1', target: 'video-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-audio-video', source: 'asset-audio-1', target: 'video-1', targetHandle: 'any-in' }),
      ],
      onVideoGenerate: async (body, route) => {
        submissions.push(body as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'batch-video-1', quantity: 1, estimated_credits: 20 }),
        })
      },
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '视频节点' }).first().click()
    await expect(page.getByText('视频节点 · 参数')).toBeVisible()

    await page.getByTestId('canvas-execute-video').scrollIntoViewIfNeeded()
    await page.getByTestId('canvas-execute-video').click({ force: true })

    await expect.poll(() => submissions.length).toBe(1)
    const payload = submissions[0]

    expect(payload.prompt).toContain('一只猫在太空站行走')
    expect(payload.reference_images).toEqual(['https://cdn.test/ref-image-1.jpg'])
    expect(payload.reference_videos).toEqual(['https://cdn.test/ref-video-1.mp4'])
    expect(payload.reference_audios).toEqual(['https://cdn.test/ref-audio-1.mp3'])
    expect(payload.canvas_id).toBe(canvasId)
    expect(payload.canvas_node_id).toBe('video-1')
  })

  test('submits keyframe payload and supports swapping frames', async ({ page }) => {
    const canvasId = 'canvas-video-keyframe'
    const submissions: Array<Record<string, unknown>> = []

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createTextNode({ id: 'text-1', label: '提示词', text: '晨光中的雪山延时摄影' }),
        createAssetNode({
          id: 'asset-img-start',
          label: '首帧',
          url: 'https://cdn.test/frame-start.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 260 },
        }),
        createAssetNode({
          id: 'asset-img-end',
          label: '尾帧',
          url: 'https://cdn.test/frame-end.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 380 },
        }),
        createVideoNode({ id: 'video-1', label: '关键帧视频', videoMode: 'keyframe' }),
      ],
      edges: [
        createEdge({ id: 'e-text-video', source: 'text-1', target: 'video-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-start-video', source: 'asset-img-start', target: 'video-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-end-video', source: 'asset-img-end', target: 'video-1', targetHandle: 'any-in' }),
      ],
      onVideoGenerate: async (body, route) => {
        submissions.push(body as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: `batch-video-${submissions.length}`, quantity: 1, estimated_credits: 12 }),
        })
      },
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '关键帧视频' }).first().click()
    await expect(page.getByText('关键帧视频 · 参数')).toBeVisible()

    await page.getByTestId('canvas-execute-video').scrollIntoViewIfNeeded()
    await page.getByTestId('canvas-execute-video').click({ force: true })

    await expect.poll(() => submissions.length).toBe(1)
    expect(submissions[0].images).toEqual([
      'https://cdn.test/frame-start.jpg',
      'https://cdn.test/frame-end.jpg',
    ])

    await page.getByRole('button', { name: /交换/ }).click()
    await page.getByTestId('canvas-execute-video').scrollIntoViewIfNeeded()
    await page.getByTestId('canvas-execute-video').click({ force: true })

    await expect.poll(() => submissions.length).toBe(2)
    expect(submissions[1].images).toEqual([
      'https://cdn.test/frame-end.jpg',
      'https://cdn.test/frame-start.jpg',
    ])
  })
})
