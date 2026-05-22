import { expect, test } from '@playwright/test'
import { mockCanvasEditor } from '../fixtures/api-mocks'
import {
  createAssetNode,
  createEdge,
  createImageNode,
  createTextNode,
} from '../fixtures/canvas'

test.describe('canvas image submit', () => {
  test.use({ viewport: { width: 1600, height: 1200 } })

  test('supports @ image references in the image prompt panel', async ({ page }) => {
    const canvasId = 'canvas-image-resource-mention'
    const submissions: Array<Record<string, unknown>> = []

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createTextNode({ id: 'text-1', label: '整体要求', text: '商业摄影质感' }),
        createAssetNode({
          id: 'asset-img-1',
          label: '人物参考',
          url: 'https://cdn.test/person.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 260 },
        }),
        createImageNode({ id: 'image-1', label: '图片节点', position: { x: 620, y: 160 } }),
      ],
      edges: [
        createEdge({ id: 'e-text-image', source: 'text-1', target: 'image-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-img-image', source: 'asset-img-1', target: 'image-1', targetHandle: 'any-in' }),
      ],
      onImageGenerate: async (body, route) => {
        submissions.push(body as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'batch-image-1', quantity: 1, estimated_credits: 5 }),
        })
      },
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '图片节点' }).first().click()
    await expect(page.getByText('图片节点 · 参数')).toBeVisible()

    const promptInput = page.getByTestId('resource-mention-editor')
    await promptInput.click()
    await page.keyboard.type('@')
    await expect(page.getByRole('button', { name: /图片1/ })).toBeVisible()
    await page.getByRole('button', { name: /图片1/ }).click()
    await expect(promptInput).toContainText('@图片1')

    await promptInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type([
      '生成一张干净的产品海报',
      '@图片1 保持人物面部特征一致',
    ].join('\n'))

    await page.getByTestId('canvas-execute-image').scrollIntoViewIfNeeded()
    await page.getByTestId('canvas-execute-image').click({ force: true })

    await expect.poll(() => submissions.length).toBe(1)
    const payload = submissions[0]

    expect(payload.prompt).toContain('商业摄影质感')
    expect(payload.prompt).toContain('生成一张干净的产品海报')
    expect(payload.prompt).toContain('图片参考：参考<图片1>中的主体/角色。')
    expect(payload.prompt).toContain('生成：生成一张干净的产品海报')
    expect(payload.prompt).toContain('<图片1> 保持人物面部特征一致')
    expect((payload.params as Record<string, unknown>).image).toEqual(['https://cdn.test/person.jpg'])
    expect(payload.canvas_id).toBe(canvasId)
    expect(payload.canvas_node_id).toBe('image-1')
  })
})
