import type { AgentInstruction, CanvasNodeSummary } from '@/lib/canvas/agent-types'

export interface CanvasAgentChatParams {
  content: string | Array<{ type: string; [key: string]: unknown }>
  canvasContext: {
    nodes: CanvasNodeSummary[]
    edges: Array<{ source: string; target: string }>
  }
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  token?: string | null
  onChunk: (chunk: string) => void
  signal?: AbortSignal
}

export async function callCanvasAgent(params: CanvasAgentChatParams): Promise<void> {
  const { content, canvasContext, history, token, onChunk, signal } = params

  const res = await fetch('/api/v1/canvas-agent/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content, canvasContext, history }),
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as any)?.error?.message ?? 'AI助手暂时不可用'
    throw new Error(msg)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      // Parse SSE lines: "data: {...}"
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) onChunk(delta)
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
