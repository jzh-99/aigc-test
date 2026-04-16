'use client'

import type { AgentMessage, AgentWorkflow } from '@/lib/canvas/agent-types'

export interface CanvasAgentSession {
  messages: AgentMessage[]
  activeWorkflow: AgentWorkflow | null
  currentStepIndex: number
}

const MAX_PERSISTED = 20

function storageKey(canvasId: string) {
  return `canvas-agent:${canvasId}`
}

export function loadCanvasAgentSession(canvasId: string): CanvasAgentSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(canvasId))
    return raw ? (JSON.parse(raw) as CanvasAgentSession) : null
  } catch {
    return null
  }
}

export function saveCanvasAgentSession(canvasId: string, session: CanvasAgentSession): void {
  if (typeof window === 'undefined') return
  try {
    const toSave: CanvasAgentSession = {
      ...session,
      // Only keep done messages, drop streaming/error states
      messages: session.messages
        .filter((m) => m.status === 'done')
        .slice(-MAX_PERSISTED),
    }
    localStorage.setItem(storageKey(canvasId), JSON.stringify(toSave))
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCanvasAgentSession(canvasId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(canvasId))
  } catch {}
}
