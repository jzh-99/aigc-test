import { expect, test } from '@playwright/test'
import { mockCanvasEditor } from '../fixtures/api-mocks'
import { createTextNode } from '../fixtures/canvas'

test('shows percent progress on text node while AI text is streaming', async ({ page }) => {
  const canvasId = 'canvas-text-progress'
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  const encoder = new TextEncoder()

  await mockCanvasEditor(page, {
    canvasId,
    nodes: [createTextNode({ id: 'text-1', label: '文本节点', position: { x: 300, y: 180 } })],
  })

  await page.route('**/api/v1/canvas-agent/text-gen', async (route) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'))
      },
    })

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: stream,
    })
  })

  await page.goto(`/canvas/editor/${canvasId}`)
  await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

  await page.locator('.react-flow__node', { hasText: '文本节点' }).first().click()
  await expect(page.getByText('文本节点 · 参数')).toBeVisible()

  await page.getByPlaceholder('描述你想生成的文本内容…').fill('生成一段测试文本')
  await page.getByRole('button', { name: '生成' }).click()

  await expect(page.locator('.react-flow__node', { hasText: '文本节点' }).getByText(/\d+%/)).toBeVisible()

  streamController?.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n'))
  streamController?.enqueue(encoder.encode('data: [DONE]\n\n'))
  streamController?.close()
})
