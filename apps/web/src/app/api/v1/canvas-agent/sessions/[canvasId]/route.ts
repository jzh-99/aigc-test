import { NextRequest } from 'next/server'

const API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:7001'

type RouteContext = { params: { canvasId: string } }

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function proxyJson(req: NextRequest, canvasId: string, method: 'GET' | 'PUT' | 'DELETE') {
  const auth = req.headers.get('authorization') ?? ''
  const body = method === 'PUT' ? await req.text() : undefined

  const upstream = await fetch(`${API_URL}/api/v1/canvas-agent/sessions/${canvasId}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: auth } : {}),
    },
    body,
  })

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}

export async function GET(req: NextRequest, context: RouteContext) {
  const { canvasId } = context.params
  if (!canvasId) return jsonResponse({ success: false, error: { code: 'BAD_REQUEST', message: '缺少画布ID' } }, 400)
  return proxyJson(req, canvasId, 'GET')
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const { canvasId } = context.params
  if (!canvasId) return jsonResponse({ success: false, error: { code: 'BAD_REQUEST', message: '缺少画布ID' } }, 400)
  return proxyJson(req, canvasId, 'PUT')
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const { canvasId } = context.params
  if (!canvasId) return jsonResponse({ success: false, error: { code: 'BAD_REQUEST', message: '缺少画布ID' } }, 400)
  return proxyJson(req, canvasId, 'DELETE')
}
