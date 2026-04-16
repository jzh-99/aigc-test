import type { AppNode, AppEdge } from './types'

export const MAX_UNDO = 30

export interface UndoSnapshot {
  nodes: AppNode[]
  edges: AppEdge[]
}

export interface UndoHistory {
  past: UndoSnapshot[]
  future: UndoSnapshot[]
}

function storageKey(canvasId: string) {
  return `canvas-undo:${canvasId}`
}

export function loadUndoHistory(canvasId: string): UndoHistory {
  if (typeof window === 'undefined') return { past: [], future: [] }
  try {
    const raw = localStorage.getItem(storageKey(canvasId))
    if (!raw) return { past: [], future: [] }
    const parsed = JSON.parse(raw) as UndoHistory
    return {
      past: Array.isArray(parsed.past) ? parsed.past : [],
      future: Array.isArray(parsed.future) ? parsed.future : [],
    }
  } catch {
    return { past: [], future: [] }
  }
}

export function saveUndoHistory(canvasId: string, history: UndoHistory): void {
  if (typeof window === 'undefined') return
  try {
    const toSave: UndoHistory = {
      past: history.past.slice(-MAX_UNDO),
      future: history.future,
    }
    localStorage.setItem(storageKey(canvasId), JSON.stringify(toSave))
  } catch {
    // Ignore storage quota errors
  }
}

export function clearUndoHistory(canvasId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(canvasId))
  } catch {}
}
