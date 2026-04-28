import { create } from 'zustand'
import {
  fetchVideoStudioAssets,
  fetchVideoStudioHistory,
  type VideoStudioAssetItem,
  type VideoStudioHistoryItem,
} from '@/lib/video-studio-api'

interface CursorSection<T> {
  items: T[]
  nextCursor: string | null
  loading: boolean
  loaded: boolean
  error: string | null
  lastFetchedAt: number | null
}

type AssetSubTab = 'image' | 'video'

interface VideoStudioSidebarBucket {
  history: CursorSection<VideoStudioHistoryItem>
  assets: CursorSection<VideoStudioAssetItem>
  videoAssets: CursorSection<VideoStudioAssetItem>
  assetSubTab: AssetSubTab
}

interface VideoStudioSidebarDataState {
  byProject: Record<string, VideoStudioSidebarBucket>

  prefetch: (projectId: string, token: string) => Promise<void>
  refreshHistory: (projectId: string, token: string) => Promise<void>
  refreshAssets: (projectId: string, token: string) => Promise<void>
  refreshVideoAssets: (projectId: string, token: string) => Promise<void>
  loadMoreHistory: (projectId: string, token: string) => Promise<void>
  loadMoreAssets: (projectId: string, token: string) => Promise<void>
  loadMoreVideoAssets: (projectId: string, token: string) => Promise<void>
  setAssetSubTab: (projectId: string, subTab: AssetSubTab) => void
  clearProjectData: (projectId: string) => void
  prependHistoryItem: (projectId: string, item: VideoStudioHistoryItem) => void
  updateHistoryItemStatus: (projectId: string, batchId: string, patch: Partial<VideoStudioHistoryItem>) => void
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

function makeBucket(): VideoStudioSidebarBucket {
  return {
    history: makeSection<VideoStudioHistoryItem>(),
    assets: makeSection<VideoStudioAssetItem>(),
    videoAssets: makeSection<VideoStudioAssetItem>(),
    assetSubTab: 'image',
  }
}

function ensureBucket(state: VideoStudioSidebarDataState, projectId: string): VideoStudioSidebarBucket {
  return state.byProject[projectId] ?? makeBucket()
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

export const useVideoStudioSidebarDataStore = create<VideoStudioSidebarDataState>((set, get) => ({
  byProject: {},

  prefetch: async (projectId, token) => {
    if (!projectId || !token) return
    const bucket = ensureBucket(get(), projectId)

    await Promise.all([
      !bucket.history.loaded && !bucket.history.loading ? get().refreshHistory(projectId, token) : Promise.resolve(),
      !bucket.assets.loaded && !bucket.assets.loading ? get().refreshAssets(projectId, token) : Promise.resolve(),
    ])
  },

  refreshHistory: async (projectId, token) => {
    if (!projectId || !token) return
    const current = ensureBucket(get(), projectId)
    if (current.history.loading) return

    set((state) => {
      const bucket = ensureBucket(state, projectId)
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
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
      const data = await retryOnceIfRateLimited(() => fetchVideoStudioHistory(projectId, token))
      set((state) => {
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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

  refreshAssets: async (projectId, token) => {
    if (!projectId || !token) return
    const current = ensureBucket(get(), projectId)
    if (current.assets.loading) return

    set((state) => {
      const bucket = ensureBucket(state, projectId)
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
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
      const data = await retryOnceIfRateLimited(() => fetchVideoStudioAssets(projectId, token, null, 'image'))
      set((state) => {
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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

  refreshVideoAssets: async (projectId, token) => {
    if (!projectId || !token) return
    const current = ensureBucket(get(), projectId)
    if (current.videoAssets.loading) return

    set((state) => {
      const bucket = ensureBucket(state, projectId)
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...bucket,
            videoAssets: {
              ...bucket.videoAssets,
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
      const data = await retryOnceIfRateLimited(() => fetchVideoStudioAssets(projectId, token, null, 'video'))
      set((state) => {
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...bucket,
              videoAssets: {
                ...bucket.videoAssets,
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
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...bucket,
              videoAssets: {
                ...bucket.videoAssets,
                loading: false,
                loaded: true,
                error: err?.message ?? '加载视频资产失败',
              },
            },
          },
        }
      })
    }
  },

  loadMoreHistory: async (projectId, token) => {
    if (!projectId || !token) return
    const current = ensureBucket(get(), projectId)
    if (current.history.loading || !current.history.nextCursor) return

    set((state) => {
      const bucket = ensureBucket(state, projectId)
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
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
      const data = await retryOnceIfRateLimited(() => fetchVideoStudioHistory(projectId, token, current.history.nextCursor))
      set((state) => {
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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

  loadMoreAssets: async (projectId, token) => {
    if (!projectId || !token) return
    const current = ensureBucket(get(), projectId)
    if (current.assets.loading || !current.assets.nextCursor) return

    set((state) => {
      const bucket = ensureBucket(state, projectId)
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
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
      const data = await retryOnceIfRateLimited(() => fetchVideoStudioAssets(projectId, token, current.assets.nextCursor, 'image'))
      set((state) => {
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
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

  loadMoreVideoAssets: async (projectId, token) => {
    if (!projectId || !token) return
    const current = ensureBucket(get(), projectId)
    if (current.videoAssets.loading || !current.videoAssets.nextCursor) return

    set((state) => {
      const bucket = ensureBucket(state, projectId)
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...bucket,
            videoAssets: {
              ...bucket.videoAssets,
              loading: true,
              error: null,
            },
          },
        },
      }
    })

    try {
      const data = await retryOnceIfRateLimited(() => fetchVideoStudioAssets(projectId, token, current.videoAssets.nextCursor, 'video'))
      set((state) => {
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...bucket,
              videoAssets: {
                ...bucket.videoAssets,
                items: [...bucket.videoAssets.items, ...data.items],
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
        const bucket = ensureBucket(state, projectId)
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...bucket,
              videoAssets: {
                ...bucket.videoAssets,
                loading: false,
                error: err?.message ?? '加载更多视频资产失败',
              },
            },
          },
        }
      })
    }
  },

  setAssetSubTab: (projectId, subTab) => {
    if (!projectId) return
    set((state) => {
      const bucket = ensureBucket(state, projectId)
      if (bucket.assetSubTab === subTab) return state
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...bucket,
            assetSubTab: subTab,
          },
        },
      }
    })
  },

  clearProjectData: (projectId) => {
    if (!projectId) return
    set((state) => {
      if (!state.byProject[projectId]) return state
      const byProject = { ...state.byProject }
      delete byProject[projectId]
      return { byProject }
    })
  },

  prependHistoryItem: (projectId, item) => {
    if (!projectId) return
    set((state) => {
      const bucket = ensureBucket(state, projectId)
      // Skip if not yet loaded (will appear on next refresh) or already present
      if (!bucket.history.loaded) return state
      if (bucket.history.items.some((i) => i.id === item.id)) return state
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
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

  updateHistoryItemStatus: (projectId, batchId, patch) => {
    if (!projectId) return
    set((state) => {
      const bucket = ensureBucket(state, projectId)
      if (!bucket.history.loaded) return state
      const idx = bucket.history.items.findIndex((i) => i.id === batchId)
      if (idx === -1) return state
      const updated = [...bucket.history.items]
      updated[idx] = { ...updated[idx], ...patch }
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...bucket,
            history: { ...bucket.history, items: updated },
          },
        },
      }
    })
  },
}))
