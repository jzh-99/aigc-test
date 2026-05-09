import type { CanvasAgentSession } from '@/hooks/canvas/use-canvas-agent-history'

function authHeaders(token: string | null | undefined): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function fetchCanvasAgentSession(canvasId: string, token: string | null | undefined): Promise<CanvasAgentSession | null> {
  const res = await fetch(`/api/v1/canvas-agent/sessions/${canvasId}`, {
    method: 'GET',
    headers: authHeaders(token),
  })

  if (!res.ok) throw new Error(`Failed to fetch canvas agent session: ${res.status}`)

  const data = await res.json() as { session?: CanvasAgentSession | null }
  return data.session ?? null
}

export async function upsertCanvasAgentSession(
  canvasId: string,
  session: CanvasAgentSession,
  token: string | null | undefined,
): Promise<void> {
  const res = await fetch(`/api/v1/canvas-agent/sessions/${canvasId}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ session }),
  })

  if (!res.ok) throw new Error(`Failed to save canvas agent session: ${res.status}`)
}

export async function deleteCanvasAgentSession(canvasId: string, token: string | null | undefined): Promise<void> {
  const res = await fetch(`/api/v1/canvas-agent/sessions/${canvasId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })

  if (!res.ok) throw new Error(`Failed to delete canvas agent session: ${res.status}`)
}
