import { NextRequest } from 'next/server'

const API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:7001'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const auth = req.headers.get('authorization') ?? ''

  const upstream = await fetch(`${API_URL}/api/v1/canvas-agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body,
  })

  if (!upstream.ok) {
    const err = await upstream.text()
    return new Response(err, { status: upstream.status, headers: { 'Content-Type': 'application/json' } })
  }

  // Stream SSE directly — no buffering
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
