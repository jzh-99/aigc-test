import { create } from 'zustand'
import {
  fetchCanvasAssets,
  fetchCanvasHistory,
  type CanvasAssetItem,
  type CanvasHistoryItem,
} from '@/lib/canvas/canvas-api'

interface CursorSection<T> {
  items: T[]
  nextCursor: string | null
  loading: boolean
  loaded: boolean
  error: string | null
  lastFetchedAt: number | null
}

interface CanvasSidebarBucket {
  history: CursorSection<CanvasHistoryItem>
  assets: CursorSection<CanvasAssetItem>
}

interface CanvasSidebarDataState {
  byCanvas: Record<string, CanvasSidebarBucket>

  prefetch: (canvasId: string, token: string) => Promise<void>
  refreshHistory: (canvasId: string, token: string) => Promise<void>
  refreshAssets: (canvasId: string, token: string) => Promise<void>
  loadMoreHistory: (canvasId: string, token: string) => Promise<void>
  loadMoreAssets: (canvasId: string, token: string) => Promise<void>
  clearCanvasData: (canvasId: string) => void
  prependHistoryItem: (canvasId: string, item: CanvasHistoryItem) => void
  updateHistoryItemStatus: (canvasId: string, batchId: string, patch: Partial<CanvasHistoryItem>) => void
}

function makeSection<T>(): CursorSection<T> {
  return {
    items: [],
    nextCursor: null,
    loading: false,
    loaded: false,
    error: null,
    lastFetchedAt: null,
  }
}

function makeBucket(): CanvasSidebarBucket {
  return {
    history: makeSection<CanvasHistoryItem>(),
    assets: makeSection<CanvasAssetItem>(),
  }
}

function ensureBucket(state: CanvasSidebarDataState, canvasId: string): CanvasSidebarBucket {
  return state.byCanvas[canvasId] ?? makeBucket()
}

function shouldRetryRateLimited(err: any): boolean {
  const msg = String(err?.message ?? '').toLowerCase()
  return msg.includes('请求过于频繁') || msg.includes('rate') || msg.includes('429')
}

async function retryOnceIfRateLimited<T>(fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (err) {
    if (!shouldRetryRateLimited(err)) throw err
    await new Promise((resolve) => setTimeout(resolve, 1200 + Math.floor(Math.random() * 400)))
    return await fn()
  }
}

export const useCanvasSidebarDataStore = create<CanvasSidebarDataState>((set, get) => ({
  byCanvas: {},

  prefetch: async (canvasId, token) => {
    if (!canvasId || !token) return
    const bucket = ensureBucket(get(), canvasId)

    await Promise.all([
      !bucket.history.loaded && !bucket.history.loading ? get().refreshHistory(canvasId, token) : Promise.resolve(),
      !bucket.assets.loaded && !bucket.assets.loading ? get().refreshAssets(canvasId, token) : Promise.resolve(),
    ])
  },

  refreshHistory: async (canvasId, token) => {
    if (!canvasId || !token) return
    const current = ensureBucket(get(), canvasId)
    if (current.history.loading) return

    set((state) => {
      const bucket = ensureBucket(state, canvasId)
      return {
        byCanvas: {
          ...state.byCanvas,
          [canvasId]: {
            ...bucket,
            history: {
              ...bucket.history,
              items: [],
              nextCursor: null,
              loading: true,
              error: null,
            },
          },
        },
      }
    })

    try {
      const data = await retryOnceIfRateLimited(() => fetchCanvasHistory(canvasId, token))
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              history: {
                ...bucket.history,
                items: data.items,
                nextCursor: data.nextCursor,
                loaded: true,
                loading: false,
                error: null,
                lastFetchedAt: Date.now(),
              },
            },
          },
        }
      })
    } catch (err: any) {
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              history: {
                ...bucket.history,
                loading: false,
                loaded: true,
                error: err?.message ?? '加载任务记录失败',
              },
            },
          },
        }
      })
    }
  },

  refreshAssets: async (canvasId, token) => {
    if (!canvasId || !token) return
    const current = ensureBucket(get(), canvasId)
    if (current.assets.loading) return

    set((state) => {
      const bucket = ensureBucket(state, canvasId)
      return {
        byCanvas: {
          ...state.byCanvas,
          [canvasId]: {
            ...bucket,
            assets: {
              ...bucket.assets,
              items: [],
              nextCursor: null,
              loading: true,
              error: null,
            },
          },
        },
      }
    })

    try {
      const data = await retryOnceIfRateLimited(() => fetchCanvasAssets(canvasId, token))
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              assets: {
                ...bucket.assets,
                items: data.items,
                nextCursor: data.nextCursor,
                loaded: true,
                loading: false,
                error: null,
                lastFetchedAt: Date.now(),
              },
            },
          },
        }
      })
    } catch (err: any) {
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              assets: {
                ...bucket.assets,
                loading: false,
                loaded: true,
                error: err?.message ?? '加载资产失败',
              },
            },
          },
        }
      })
    }
  },

  loadMoreHistory: async (canvasId, token) => {
    if (!canvasId || !token) return
    const current = ensureBucket(get(), canvasId)
    if (current.history.loading || !current.history.nextCursor) return

    set((state) => {
      const bucket = ensureBucket(state, canvasId)
      return {
        byCanvas: {
          ...state.byCanvas,
          [canvasId]: {
            ...bucket,
            history: {
              ...bucket.history,
              loading: true,
              error: null,
            },
          },
        },
      }
    })

    try {
      const data = await retryOnceIfRateLimited(() => fetchCanvasHistory(canvasId, token, current.history.nextCursor))
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              history: {
                ...bucket.history,
                items: [...bucket.history.items, ...data.items],
                nextCursor: data.nextCursor,
                loaded: true,
                loading: false,
                error: null,
                lastFetchedAt: Date.now(),
              },
            },
          },
        }
      })
    } catch (err: any) {
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              history: {
                ...bucket.history,
                loading: false,
                error: err?.message ?? '加载更多任务记录失败',
              },
            },
          },
        }
      })
    }
  },

  loadMoreAssets: async (canvasId, token) => {
    if (!canvasId || !token) return
    const current = ensureBucket(get(), canvasId)
    if (current.assets.loading || !current.assets.nextCursor) return

    set((state) => {
      const bucket = ensureBucket(state, canvasId)
      return {
        byCanvas: {
          ...state.byCanvas,
          [canvasId]: {
            ...bucket,
            assets: {
              ...bucket.assets,
              loading: true,
              error: null,
            },
          },
        },
      }
    })

    try {
      const data = await retryOnceIfRateLimited(() => fetchCanvasAssets(canvasId, token, current.assets.nextCursor))
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              assets: {
                ...bucket.assets,
                items: [...bucket.assets.items, ...data.items],
                nextCursor: data.nextCursor,
                loaded: true,
                loading: false,
                error: null,
                lastFetchedAt: Date.now(),
              },
            },
          },
        }
      })
    } catch (err: any) {
      set((state) => {
        const bucket = ensureBucket(state, canvasId)
        return {
          byCanvas: {
            ...state.byCanvas,
            [canvasId]: {
              ...bucket,
              assets: {
                ...bucket.assets,
                loading: false,
                error: err?.message ?? '加载更多资产失败',
              },
            },
          },
        }
      })
    }
  },

  clearCanvasData: (canvasId) => {
    if (!canvasId) return
    set((state) => {
      if (!state.byCanvas[canvasId]) return state
      const byCanvas = { ...state.byCanvas }
      delete byCanvas[canvasId]
      return { byCanvas }
    })
  },

  prependHistoryItem: (canvasId, item) => {
    if (!canvasId) return
    set((state) => {
      const bucket = ensureBucket(state, canvasId)
      // Skip if not yet loaded (will appear on next refresh) or already present
      if (!bucket.history.loaded) return state
      if (bucket.history.items.some((i) => i.id === item.id)) return state
      return {
        byCanvas: {
          ...state.byCanvas,
          [canvasId]: {
            ...bucket,
            history: {
              ...bucket.history,
              items: [item, ...bucket.history.items],
            },
          },
        },
      }
    })
  },

  updateHistoryItemStatus: (canvasId, batchId, patch) => {
    if (!canvasId) return
    set((state) => {
      const bucket = ensureBucket(state, canvasId)
      if (!bucket.history.loaded) return state
      const idx = bucket.history.items.findIndex((i) => i.id === batchId)
      if (idx === -1) return state
      const updated = [...bucket.history.items]
      updated[idx] = { ...updated[idx], ...patch }
      return {
        byCanvas: {
          ...state.byCanvas,
          [canvasId]: {
            ...bucket,
            history: { ...bucket.history, items: updated },
          },
        },
      }
    })
  },
}))
