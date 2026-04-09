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
      const data = await fetchCanvasHistory(canvasId, token)
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
      const data = await fetchCanvasAssets(canvasId, token)
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
      const data = await fetchCanvasHistory(canvasId, token, current.history.nextCursor)
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
      const data = await fetchCanvasAssets(canvasId, token, current.assets.nextCursor)
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
}))
