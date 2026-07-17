import { expect, test } from '@playwright/test'
import { createImageNode } from '../fixtures/canvas'
import { mockCanvasEditor } from '../fixtures/api-mocks'

test('refreshes image node preview and asset library when a generated image replaces an existing output', async ({ page }) => {
  const canvasId = 'canvas-image-live-refresh'
  const nodeId = 'image-node-1'
  const oldOutputUrl = 'https://cdn.test/old-image.jpg'
  const newOutputUrl = 'https://cdn.test/new-image.jpg'
  const newOutputId = 'output-new-image'
  const newAssetId = 'asset-new-image'
  let pollCount = 0
  let nodeOutputsRequested = false
  let assetsRequestedAfterFinish = false

  await mockCanvasEditor(page, {
    canvasId,
    nodes: [createImageNode({ id: nodeId, prompt: '一只白猫' })],
  })

  await page.route(`**/api/v1/canvases/${canvasId}/all-node-outputs**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        [nodeId]: [
          {
            id: 'output-old-image',
            output_urls: [oldOutputUrl],
            thumbnail_url: null,
            params_snapshot: null,
            is_selected: true,
            created_at: '2026-05-29T08:00:00.000Z',
            asset_type: 'image',
          },
        ],
      }),
    })
  })

  await page.route(`**/api/v1/canvases/${canvasId}/active-tasks**`, async (route) => {
    pollCount += 1
    const finished = pollCount >= 3
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: finished ? 2 : 1,
        batches: finished
          ? [
              {
                id: 'batch-image-new',
                canvas_node_id: nodeId,
                status: 'completed',
                quantity: 1,
                completed_count: 1,
                failed_count: 0,
                queue_position: null,
                processing_started_at: '2026-05-29T08:01:00.000Z',
              },
            ]
          : [],
      }),
    })
  })

  await page.route(`**/api/v1/canvases/${canvasId}/node-outputs/${nodeId}`, async (route) => {
    nodeOutputsRequested = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: newOutputId,
          output_urls: [newOutputUrl],
          thumbnail_url: null,
          params_snapshot: null,
          is_selected: true,
          created_at: '2026-05-29T08:02:00.000Z',
          asset_type: 'image',
        },
        {
          id: 'output-old-image',
          output_urls: [oldOutputUrl],
          thumbnail_url: null,
          params_snapshot: null,
          is_selected: false,
          created_at: '2026-05-29T08:00:00.000Z',
          asset_type: 'image',
        },
      ]),
    })
  })

  await page.route(`**/api/v1/canvases/${canvasId}/assets**`, async (route) => {
    if (pollCount >= 3) assetsRequestedAfterFinish = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: pollCount >= 3
          ? [
              {
                id: newAssetId,
                type: 'image',
                storage_url: newOutputUrl,
                original_url: null,
                thumbnail_url: null,
                created_at: '2026-05-29T08:02:00.000Z',
                batch_id: 'batch-image-new',
                canvas_node_id: nodeId,
                prompt: '一只白猫',
                model: 'gemini-3.1-flash-image-preview',
              },
            ]
          : [],
        nextCursor: null,
      }),
    })
  })

  await page.goto(`/canvas/editor/${canvasId}`)

  await expect(page.locator(`img[src="${oldOutputUrl}"]`)).toBeVisible()
  await expect(page.locator(`img[src="${newOutputUrl}"]`)).toBeVisible({ timeout: 8000 })
  expect(nodeOutputsRequested).toBe(true)

  await page.getByRole('button', { name: '记录' }).click()
  await page.getByRole('button', { name: '资产库', exact: true }).last().click()

  await expect(page.getByTestId(`canvas-asset-item-${newAssetId}`)).toBeVisible()
  expect(assetsRequestedAfterFinish).toBe(true)
})
