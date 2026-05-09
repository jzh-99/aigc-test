'use client'

import type { AgentMessage, AgentWorkflow } from '@/lib/canvas/agent-types'
import { upsertCanvasAgentSession } from '@/lib/canvas/agent-session-api'

export interface CanvasAgentSession {
  messages: AgentMessage[]
  activeWorkflow: AgentWorkflow | null
  currentStepIndex: number
}

const MAX_PERSISTED = 20

function storageKey(canvasId: string) {
  return `canvas-agent:${canvasId}`
}

function migrationKey(canvasId: string) {
  return `canvas-agent-migrated:${canvasId}`
}

export function prepareCanvasAgentSession(session: CanvasAgentSession): CanvasAgentSession {
  return {
    ...session,
    messages: session.messages
      .filter((m): m is Extract<typeof m, { role: 'user' | 'assistant' }> => m.role !== 'result' && m.status === 'done')
      .slice(-MAX_PERSISTED),
  }
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
    localStorage.setItem(storageKey(canvasId), JSON.stringify(prepareCanvasAgentSession(session)))
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCanvasAgentSession(canvasId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(canvasId))
    localStorage.removeItem(migrationKey(canvasId))
  } catch {}
}

export async function migrateCanvasAgentSessionToServer(canvasId: string, token: string | null | undefined): Promise<void> {
  if (typeof window === 'undefined' || !token) return
  try {
    if (localStorage.getItem(migrationKey(canvasId))) return
    const session = loadCanvasAgentSession(canvasId)
    if (!session) return
    await upsertCanvasAgentSession(canvasId, prepareCanvasAgentSession(session), token)
    localStorage.setItem(migrationKey(canvasId), '1')
  } catch {
    // Keep localStorage as the recovery source if migration fails.
  }
}
