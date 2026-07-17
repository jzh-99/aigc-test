import { expect, test } from '@playwright/test'
import { mockCanvasEditor } from '../fixtures/api-mocks'
import { createAudioNode } from '../fixtures/canvas'

test.describe('canvas audio submit', () => {
  test.use({ viewport: { width: 1600, height: 1200 } })

  test('submits tts payload from audio node panel', async ({ page }) => {
    const canvasId = 'canvas-audio-submit'
    const submissions: Array<Record<string, unknown>> = []

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createAudioNode({
          id: 'audio-1',
          label: '音频节点',
          position: { x: 620, y: 160 },
        }),
      ],
      onAudioGenerate: async (body, route) => {
        submissions.push(body as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'batch-audio-1',
            output_id: 'output-audio-1',
            output_url: 'https://cdn.test/generated-audio.mp3',
            estimated_credits: 1,
          }),
        })
      },
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '音频节点' }).first().click()
    await expect(page.getByText('音频节点 · 参数')).toBeVisible()
    await expect(page.getByRole('button', { name: /MiniMax Speech 2.8 Turbo/ })).toBeVisible()
    await expect(page.getByText('御姐音色')).toBeVisible()
    await expect(page.getByText('3000 字以内使用同步非流式合成。')).toHaveCount(0)
    await expect(page.getByText('情绪')).toHaveCount(0)

    const textInput = page.getByTestId('audio-tag-editor')
    await textInput.click()
    await page.keyboard.type('你好，欢迎来到 Toby AI。')
    await page.getByRole('button', { name: '停顿' }).click()
    await page.getByRole('button', { name: '1.0s' }).click()
    await page.getByRole('button', { name: '语气词' }).click()
    await page.getByRole('button', { name: '笑声' }).click()
    await expect(page.getByTestId('audio-tag-token').filter({ hasText: '<#1s#>' })).toBeVisible()
    await expect(page.getByTestId('audio-tag-token').filter({ hasText: '笑声' })).toBeVisible()

    await page.getByRole('button', { name: '选择' }).click()
    const voiceDialog = page.getByRole('dialog', { name: '音色选择' })
    await expect(voiceDialog).toBeVisible()
    await expect(voiceDialog.getByText('我的音色')).toHaveCount(0)
    await expect(voiceDialog.getByText('收藏音色')).toHaveCount(0)
    await expect(voiceDialog.getByText('筛选')).toHaveCount(0)
    await expect(voiceDialog.getByRole('combobox')).toHaveCount(0)
    await expect(voiceDialog.getByRole('button', { name: '已选' })).toBeVisible()
    await voiceDialog.getByRole('button', { name: '关闭', exact: true }).click()

    await page.getByTestId('canvas-execute-audio').click()

    await expect.poll(() => submissions.length).toBe(1)
    const payload = submissions[0]

    expect(payload.workspace_id).toBe('ws-e2e')
    expect(payload.canvas_id).toBe(canvasId)
    expect(payload.canvas_node_id).toBe('audio-1')
    expect(payload.model).toBe('speech-2.8-turbo')
    expect(payload.voice_id).toBe('female-yujie')
    expect(payload.text).toContain('你好，欢迎来到 Toby AI。')
    expect(payload.text).toContain('<#1#>')
    expect(payload.text).toContain('(laughs)')
    expect(payload.speed).toBe(1)
    expect(payload.pitch).toBe(0)
    expect(payload.volume).toBe(1)

    await expect(page.locator('.react-flow__node', { hasText: '音频输出' })).toBeVisible()
    await expect(page.locator('.react-flow__node', { hasText: '音频输出' }).getByText('定稿')).toHaveCount(0)
  })
})
