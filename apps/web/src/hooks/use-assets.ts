'use client'

import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useAuthStore } from '@/stores/auth-store'
import { apiDelete, apiPost } from '@/lib/api-client'

export interface AssetItem {
  id: string
  type: 'image' | 'video'
  storage_url: string | null
  thumbnail_url: string | null
  original_url: string | null
  created_at: string
  batch: { id: string; prompt: string; model: string }
}

export interface TrashAssetItem {
  id: string
  type: 'image' | 'video'
  storage_url: string | null
  original_url: string | null
  deleted_at: string
  prompt: string
}

interface AssetListResponse {
  data: AssetItem[]
  cursor: string | null
}

const PAGE_SIZE = 24

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
    { revalidateFirstPage: false, revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 60000 },
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

export function useTrashAssets(enabled: boolean) {
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { data, error, mutate } = useSWR<{ data: TrashAssetItem[] }>(
    enabled && activeWorkspaceId ? `/assets/trash?workspace_id=${activeWorkspaceId}` : null,
  )
  return { assets: data?.data ?? [], error, isLoading: !data && !error, mutate }
}

export async function deleteAsset(id: string): Promise<void> {
  await apiDelete<void>(`/assets/${id}`)
}

export async function restoreAsset(id: string): Promise<void> {
  await apiPost<void>(`/assets/trash/${id}/restore`, {})
}

export async function permanentDeleteAsset(id: string): Promise<void> {
  await apiDelete<void>(`/assets/trash/${id}`)
}

