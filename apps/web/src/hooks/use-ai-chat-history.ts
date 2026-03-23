'use client'

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  imagePreview?: string  // data URL (not persisted to localStorage)
  mediaLabel?: string    // "[图片]" | "[视频: name.mp4]"
  timestamp: number
}

const MAX_PERSISTED = 30

function storageKey(userId: string) {
  return `toby-ai-chat:${userId}`
}

export function loadAiChatHistory(userId: string): AiChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(userId))
    return raw ? (JSON.parse(raw) as AiChatMessage[]) : []
  } catch {
    return []
  }
}

export function saveAiChatHistory(userId: string, messages: AiChatMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    // Keep last N messages; strip imagePreview (base64 too large to persist)
    const toSave = messages.slice(-MAX_PERSISTED).map(({ imagePreview: _, ...m }) => m)
    localStorage.setItem(storageKey(userId), JSON.stringify(toSave))
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAiChatHistory(userId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(userId))
  } catch {}
}
