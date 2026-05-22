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
          thumbnailUrl: 'https://cdn.test/ref-video-1-thumb.jpg',
          duration: 2.4,
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

    const promptInput = page.getByTestId('resource-mention-editor')
    await promptInput.click()
    await page.keyboard.type('@')
    await expect(page.getByRole('button', { name: /图片1/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /视频1/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /音频1/ })).toBeVisible()
    await page.getByRole('button', { name: /图片1/ }).click()
    await expect(promptInput).toContainText('@图片1')
    await expect(page.getByTestId('canvas-reference-preview-group-image')).toContainText('图片 1')
    await expect(page.getByTestId('canvas-reference-preview-group-video')).toContainText('视频 1')
    await expect(page.getByTestId('canvas-reference-preview-group-audio')).toContainText('音频 1')
    await expect(page.getByTestId('canvas-reference-preview-图片1')).toBeVisible()
    await expect(page.getByTestId('canvas-reference-preview-视频1')).toBeVisible()
    await expect(page.getByTestId('canvas-reference-preview-音频1')).toBeVisible()
    await expect(page.getByTestId('canvas-reference-preview-list-image').getByTestId('canvas-reference-preview-图片1')).toBeVisible()
    await expect(page.getByTestId('canvas-reference-preview-list-video').getByTestId('canvas-reference-preview-视频1')).toBeVisible()
    await expect(page.getByTestId('canvas-reference-preview-list-audio').getByTestId('canvas-reference-preview-音频1')).toBeVisible()
    await expect(page.getByTestId('canvas-reference-preview-图片1').locator('img')).toHaveAttribute('src', /ref-image-1\.jpg/)
    await expect(page.getByTestId('canvas-reference-preview-视频1').locator('img')).toHaveAttribute('src', /ref-video-1-thumb\.jpg/)

    await promptInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type([
      '整体生成一个暖色调广告短片',
      '@图片1 保持人物主体一致',
      '@视频1 参考运镜节奏',
      '@音频1 参考温柔女声音色',
    ].join('\n'))

    await page.getByTestId('canvas-execute-video').scrollIntoViewIfNeeded()
    await page.getByTestId('canvas-execute-video').click({ force: true })

    await expect.poll(() => submissions.length).toBe(1)
    const payload = submissions[0]

    expect(payload.prompt).toContain('一只猫在太空站行走')
    expect(payload.prompt).toContain('整体生成一个暖色调广告短片')
    expect(payload.prompt).toContain('图片参考：参考<图片1>中的主体/角色。')
    expect(payload.prompt).toContain('视频参考：参考<视频1>中的动作/运镜/风格/音效。')
    expect(payload.prompt).toContain('音频参考：参考<音频1>中的音色。')
    expect(payload.prompt).toContain('生成：整体生成一个暖色调广告短片')
    expect(payload.prompt).toContain('<图片1> 保持人物主体一致')
    expect(payload.prompt).toContain('<视频1> 参考运镜节奏')
    expect(payload.prompt).toContain('<音频1> 参考温柔女声音色')
    expect(payload.video_category).toBe('multimodal')
    expect(payload.reference_images).toEqual(['https://cdn.test/ref-image-1.jpg'])
    expect(payload.reference_videos).toEqual(['https://cdn.test/ref-video-1.mp4'])
    expect(payload.reference_video_durations).toEqual([2.4])
    expect(payload.reference_audios).toEqual(['https://cdn.test/ref-audio-1.mp3'])
    expect(payload.canvas_id).toBe(canvasId)
    expect(payload.canvas_node_id).toBe('video-1')
  })

  test('renders selected resource mentions as atomic colored tokens', async ({ page }) => {
    const canvasId = 'canvas-video-mention-token'

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createAssetNode({
          id: 'asset-video-1',
          label: '参考视频',
          url: 'https://cdn.test/ref-video-1.mp4',
          mimeType: 'video/mp4',
          position: { x: 360, y: 380 },
        }),
        createVideoNode({ id: 'video-1', label: '视频节点', videoMode: 'multiref' }),
      ],
      edges: [
        createEdge({ id: 'e-video-video', source: 'asset-video-1', target: 'video-1', targetHandle: 'any-in' }),
      ],
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '视频节点' }).first().click()
    await expect(page.getByText('视频节点 · 参数')).toBeVisible()

    const editor = page.getByTestId('resource-mention-editor')
    await editor.click()
    await page.keyboard.type('@')
    await page.getByRole('button', { name: /视频1/ }).click()

    const token = page.getByTestId('resource-mention-token').filter({ hasText: '@视频1' })
    await expect(token).toBeVisible()
    await expect(token).toHaveAttribute('contenteditable', 'false')
    await expect(token).toHaveClass(/text-violet-600/)
    await expect(page.getByTestId('canvas-reference-preview-视频1').locator('video')).toHaveAttribute('src', /ref-video-1\.mp4/)

    await page.keyboard.type(' 参考奔跑动作')
    await page.keyboard.press('Home')
    await page.keyboard.press('Delete')
    await expect(token).toHaveCount(0)
    await expect(editor).not.toContainText('@视频1')
    await expect(editor).toContainText('参考奔跑动作')
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
    expect(submissions[0].video_category).toBe('frames')
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
