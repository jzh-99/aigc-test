import type { Page, Route } from '@playwright/test'
import { mockAuth } from './auth'
import type { E2ECanvasEdge, E2ECanvasNode } from './canvas'

interface MockCanvasEditorOptions {
  canvasId: string
  canvasName?: string
  workspaceId?: string
  version?: number
  nodes?: E2ECanvasNode[]
  edges?: E2ECanvasEdge[]
  historyItems?: unknown[]
  imageAssets?: unknown[]
  videoAssets?: unknown[]
  onVideoGenerate?: (body: any, route: Route) => Promise<void> | void
}

function buildCursorPayload(items: unknown[], nextCursor: string | null = null) {
  return {
    items,
    nextCursor,
  }
}

function readJson<T = any>(text: string | null): T {
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
}

export async function mockCanvasEditor(page: Page, options: MockCanvasEditorOptions) {
  const cfg = {
    canvasName: 'E2E画布',
    workspaceId: 'ws-e2e',
    version: 1,
    nodes: [] as E2ECanvasNode[],
    edges: [] as E2ECanvasEdge[],
    historyItems: [] as unknown[],
    imageAssets: [] as unknown[],
    videoAssets: [] as unknown[],
    ...options,
  }

  await mockAuth(page, { workspaceId: cfg.workspaceId })

  await page.route(`**/api/v1/canvases/${cfg.canvasId}`, async (route, req) => {
    const method = req.method().toUpperCase()

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: cfg.canvasId,
          name: cfg.canvasName,
          version: cfg.version,
          workspace_id: cfg.workspaceId,
          structure_data: {
            nodes: cfg.nodes,
            edges: cfg.edges,
          },
        }),
      })
      return
    }

    if (method === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: cfg.canvasId,
          name: cfg.canvasName,
          version: cfg.version + 1,
          workspace_id: cfg.workspaceId,
          structure_data: {
            nodes: cfg.nodes,
            edges: cfg.edges,
          },
        }),
      })
      return
    }

    await route.fallback()
  })

  await page.route(`**/api/v1/canvases/${cfg.canvasId}/active-tasks**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: cfg.version,
        batches: [],
      }),
    })
  })

  await page.route(`**/api/v1/canvases/${cfg.canvasId}/all-node-outputs**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  await page.route(`**/api/v1/canvases/${cfg.canvasId}/node-outputs/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  await page.route(`**/api/v1/canvases/${cfg.canvasId}/history**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCursorPayload(cfg.historyItems)),
    })
  })

  await page.route(`**/api/v1/canvases/${cfg.canvasId}/assets**`, async (route, request) => {
    const url = new URL(request.url())
    const type = url.searchParams.get('type')
    const items = type === 'video' ? cfg.videoAssets : cfg.imageAssets

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCursorPayload(items)),
    })
  })

  await page.route('**/api/v1/videos/generate', async (route, request) => {
    const body = readJson(request.postData())

    if (cfg.onVideoGenerate) {
      await cfg.onVideoGenerate(body, route)
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `batch-${Date.now()}`,
        quantity: 1,
        estimated_credits: 12,
      }),
    })
  })

  return cfg
}
