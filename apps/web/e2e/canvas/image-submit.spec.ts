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
    expect(payload.prompt).toContain('<图片1> 保持人物面部特征一致')
    expect(payload.prompt).not.toContain('图片参考')
    expect(payload.prompt).not.toContain('生成：')
    expect((payload.params as Record<string, unknown>).image).toEqual(['https://cdn.test/person.jpg'])
    expect(payload.canvas_id).toBe(canvasId)
    expect(payload.canvas_node_id).toBe('image-1')
  })

  test('removes an image reference from preview, edges, and prompt mentions', async ({ page }) => {
    const canvasId = 'canvas-image-remove-reference'
    const submissions: Array<Record<string, unknown>> = []

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createAssetNode({
          id: 'asset-img-1',
          label: '旧人物参考',
          url: 'https://cdn.test/person-old.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 220 },
        }),
        createAssetNode({
          id: 'asset-img-2',
          label: '新人像参考',
          url: 'https://cdn.test/person-new.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 340 },
        }),
        createImageNode({
          id: 'image-1',
          label: '图片节点',
          prompt: '@图片1和@图片2是好朋友。',
          position: { x: 620, y: 160 },
        }),
      ],
      edges: [
        createEdge({ id: 'e-img-old-image', source: 'asset-img-1', target: 'image-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-img-new-image', source: 'asset-img-2', target: 'image-1', targetHandle: 'any-in' }),
      ],
      onImageGenerate: async (body, route) => {
        submissions.push(body as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'batch-image-remove-ref', quantity: 1, estimated_credits: 5 }),
        })
      },
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '图片节点' }).first().click()
    await expect(page.getByText('图片节点 · 参数')).toBeVisible()

    const promptInput = page.getByTestId('resource-mention-editor')
    await expect(promptInput).toContainText('@图片1')
    await expect(promptInput).toContainText('@图片2')

    await expect(page.getByTestId('canvas-reference-remove-图片2')).toHaveCSS('opacity', '0')
    await page.getByTestId('canvas-reference-preview-图片2').hover()
    await expect(page.getByTestId('canvas-reference-remove-图片2')).toHaveCSS('opacity', '1')
    await page.getByTestId('canvas-reference-remove-图片2').click()

    await expect(promptInput).not.toContainText('@图片2')
    await expect(promptInput).toContainText('@图片1和是好朋友。')
    await expect(page.getByTestId('canvas-reference-preview-图片1').locator('img')).toHaveAttribute('src', /person-old\.jpg/)

    await page.getByTestId('canvas-execute-image').scrollIntoViewIfNeeded()
    await page.getByTestId('canvas-execute-image').click({ force: true })

    await expect.poll(() => submissions.length).toBe(1)
    const payload = submissions[0]

    expect((payload.params as Record<string, unknown>).image).toEqual(['https://cdn.test/person-old.jpg'])
    expect(payload.prompt).toContain('<图片1> 和是好朋友。')
    expect(payload.prompt).not.toContain('图片参考')
    expect(payload.prompt).not.toContain('生成：')
    expect(payload.prompt).not.toContain('图片2')
  })

  test('disables image models that cannot accept current reference count', async ({ page }) => {
    const canvasId = 'canvas-image-model-reference-limit'

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createAssetNode({
          id: 'asset-img-1',
          label: '参考图一',
          url: 'https://cdn.test/ref-1.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 220 },
        }),
        createAssetNode({
          id: 'asset-img-2',
          label: '参考图二',
          url: 'https://cdn.test/ref-2.jpg',
          mimeType: 'image/jpeg',
          position: { x: 360, y: 340 },
        }),
        createImageNode({ id: 'image-1', label: '图片节点', position: { x: 620, y: 160 } }),
      ],
      edges: [
        createEdge({ id: 'e-img-1-image', source: 'asset-img-1', target: 'image-1', targetHandle: 'any-in' }),
        createEdge({ id: 'e-img-2-image', source: 'asset-img-2', target: 'image-1', targetHandle: 'any-in' }),
      ],
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '图片节点' }).first().click()
    await expect(page.getByText('图片节点 · 参数')).toBeVisible()

    const limitedModel = page.getByRole('button', { name: /单参考图片/ })
    await expect(limitedModel).toBeDisabled()
    await expect(limitedModel).toContainText('最多1')

    await limitedModel.click({ force: true })
    await expect(page.getByRole('button', { name: /Gemini Image/ })).toHaveClass(/text-primary/)
  })
})
