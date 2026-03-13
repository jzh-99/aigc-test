'use client'

import useSWRInfinite from 'swr/infinite'
import { useAuthStore } from '@/stores/auth-store'
import { apiDelete } from '@/lib/api-client'

export interface AssetItem {
  id: string
  type: 'image' | 'video'
  storage_url: string | null
  original_url: string | null
  created_at: string
  batch: { id: string; prompt: string; model: string }
}

interface AssetListResponse {
  data: AssetItem[]
  cursor: string | null
}

const PAGE_SIZE = 60

export function useAssets(type?: 'image' | 'video', date?: string) {
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)

  const typeParam = type ? `&type=${type}` : ''
  const dateParam = date ? `&date=${date}` : ''
  const wsParam = activeWorkspaceId ? `&workspace_id=${activeWorkspaceId}` : ''

  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<AssetListResponse>(
    (pageIndex, previousPageData) => {
      if (!activeWorkspaceId) return null
      if (previousPageData && !previousPageData.cursor) return null
      if (pageIndex === 0) return `/assets?limit=${PAGE_SIZE}${wsParam}${typeParam}${dateParam}`
      return `/assets?limit=${PAGE_SIZE}&cursor=${previousPageData!.cursor}${wsParam}${typeParam}${dateParam}`
    },
    { revalidateFirstPage: true },
  )

  const assets = data ? data.flatMap((page) => page.data) : []
  const isLoadingInitial = !data && !error
  const isLoadingMore = isLoadingInitial || (size > 0 && data && typeof data[size - 1] === 'undefined')
  const hasMore = data ? !!data[data.length - 1]?.cursor : false

  return {
    assets,
    error,
    isLoadingInitial,
    isLoadingMore: !!isLoadingMore,
    isValidating,
    hasMore,
    loadMore: () => setSize(size + 1),
    mutate,
  }
}

export async function deleteAsset(id: string): Promise<void> {
  await apiDelete<void>(`/assets/${id}`)
}
