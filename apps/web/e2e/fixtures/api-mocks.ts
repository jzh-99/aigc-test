import type { Page, Route } from '@playwright/test'
import { mockAuth } from './auth'
import type { E2ECanvasEdge, E2ECanvasNode } from './canvas'

const VIDEO_MODEL_FIXTURE = {
  id: 'model-seedance-2',
  code: 'seedance-2.0',
  name: 'Seedance 2.0',
  description: null,
  module: 'video',
  provider_code: 'volcengine',
  credit_cost: 12,
  resolution: null,
  is_active: true,
  params_pricing: [
    { model: 'seedance-2.0', resolution: '5', unit_price: 12 },
  ],
  params_schema: {
    type: 'object',
    properties: {
      aspect_ratio: {
        enum: ['adaptive', '16:9', '9:16', '1:1'],
        enumNames: ['自适应', '16:9', '9:16', '1:1'],
      },
      time_length: {
        enum: [5, 10],
        enumNames: ['5s', '10s'],
      },
    },
  },
  video_categories: {
    multimodal: {
      label: '全能参考',
      limits: {
        image: { min: 0, max: 9 },
        video: { min: 0, max: 3 },
        audio: { min: 0, max: 3 },
      },
    },
    frames: {
      label: '首尾帧',
      limits: {
        image: { min: 1, max: 2 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
      },
    },
  },
}

const IMAGE_MODEL_FIXTURE = {
  id: 'model-gemini',
  code: 'gemini',
  name: 'Gemini Image',
  description: null,
  module: 'image',
  provider_code: 'gemini',
  credit_cost: 5,
  resolution: null,
  is_active: true,
  params_pricing: [
    { model: 'gemini', resolution: '2k', unit_price: 5 },
  ],
  params_schema: {
    type: 'object',
    properties: {
      resolution: {
        enum: ['2k'],
        enumNames: ['2K'],
      },
      aspect_ratio: {
        enum: ['1:1', '16:9'],
        enumNames: ['1:1', '16:9'],
      },
    },
  },
  video_categories: {},
  image_categories: {
    text_to_image: {
      label: '文生图',
      limits: {
        image: { min: 0, max: 0 },
      },
    },
    image_to_image: {
      label: '图生图',
      limits: {
        image: { min: 0, max: 6 },
      },
    },
  },
}

const SINGLE_REFERENCE_IMAGE_MODEL_FIXTURE = {
  ...IMAGE_MODEL_FIXTURE,
  id: 'model-single-reference',
  code: 'single-reference-image',
  name: '单参考图片',
  params_pricing: [
    { model: 'single-reference-image', resolution: '2k', unit_price: 3 },
  ],
  image_categories: {
    text_to_image: {
      label: '文生图',
      limits: {
        image: { min: 0, max: 0 },
      },
    },
    image_to_image: {
      label: '图生图',
      limits: {
        image: { min: 0, max: 1 },
      },
    },
  },
}

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
  onImageGenerate?: (body: any, route: Route) => Promise<void> | void
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

  await page.route('**/api/v1/models**', async (route, request) => {
    const url = new URL(request.url())
    const module = url.searchParams.get('module')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(module === 'video' ? [VIDEO_MODEL_FIXTURE] : module === 'image' ? [IMAGE_MODEL_FIXTURE, SINGLE_REFERENCE_IMAGE_MODEL_FIXTURE] : []),
    })
  })

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

  await page.route('**/api/v1/generate/image', async (route, request) => {
    const body = readJson(request.postData())

    if (cfg.onImageGenerate) {
      await cfg.onImageGenerate(body, route)
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `batch-${Date.now()}`,
        quantity: 1,
        estimated_credits: 5,
      }),
    })
  })

  return cfg
}
