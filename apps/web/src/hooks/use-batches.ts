'use client'

import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useCallback } from 'react'
import type { BatchResponse, BatchListResponse } from '@aigc/types'
import { useAuthStore } from '@/stores/auth-store'
import { apiPatch } from '@/lib/api-client'

const PAGE_SIZE = 10

export function useBatch(batchId: string | null) {
  return useSWR<BatchResponse>(
    batchId ? `/batches/${batchId}` : null,
  )
}

export function useBatches() {
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const wsParam = activeWorkspaceId ? `&workspace_id=${activeWorkspaceId}` : ''

  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<BatchListResponse>(
    (pageIndex, previousPageData) => {
      if (!activeWorkspaceId) return null
      if (previousPageData && !previousPageData.cursor) return null
      if (pageIndex === 0) return `/batches?limit=${PAGE_SIZE}${wsParam}`
      return `/batches?limit=${PAGE_SIZE}&cursor=${previousPageData!.cursor}${wsParam}`
    },
    { revalidateFirstPage: false, revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 10000, focusThrottleInterval: 15000 },
  )

  const batches = data ? data.flatMap((page) => page.data) : []
  const isLoadingInitial = !data && !error
  const isLoadingMore = isLoadingInitial || (size > 0 && data && typeof data[size - 1] === 'undefined')
  const hasMore = data ? !!data[data.length - 1]?.cursor : false

  const prependBatch = useCallback((batch: BatchResponse) => {
    mutate((pages) => {
      if (!pages || pages.length === 0) return [{ data: [batch], cursor: null }]
      const [first, ...rest] = pages
      if (first.data.some((b) => b.id === batch.id)) return pages
      return [{ ...first, data: [batch, ...first.data] }, ...rest]
    }, { revalidate: false })
  }, [mutate])

  const updateBatchInList = useCallback((updated: BatchResponse) => {
    console.log('[useBatches] updateBatchInList called with:', updated.id, updated.status, updated.completed_count)
    mutate((pages) => {
      if (!pages) return pages
      const newPages = pages.map((page) => ({
        ...page,
        data: page.data.map((b) => b.id === updated.id ? { ...b, ...updated } : b),
      }))
      console.log('[useBatches] mutate completed, new pages:', newPages[0]?.data[0])
      return newPages
    }, { revalidate: false })
  }, [mutate])

  const hideBatch = useCallback(async (id: string) => {
    await apiPatch(`/batches/${id}/hide`, {})
    mutate((pages) => {
      if (!pages) return pages
      return pages.map((page) => ({ ...page, data: page.data.filter((b) => b.id !== id) }))
    }, { revalidate: false })
  }, [mutate])

  return {
    batches,
    error,
    isLoadingInitial,
    isLoadingMore,
    isValidating,
    hasMore,
    loadMore: () => setSize(size + 1),
    mutate,
    prependBatch,
    updateBatchInList,
    hideBatch,
  }
}

export function useHiddenBatches(enabled: boolean) {
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const wsParam = activeWorkspaceId ? `&workspace_id=${activeWorkspaceId}` : ''

  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<BatchListResponse>(
    (pageIndex, previousPageData) => {
      if (!enabled || !activeWorkspaceId) return null
      if (previousPageData && !previousPageData.cursor) return null
      if (pageIndex === 0) return `/batches/hidden?limit=${PAGE_SIZE}${wsParam}`
      return `/batches/hidden?limit=${PAGE_SIZE}&cursor=${previousPageData!.cursor}${wsParam}`
    },
    { revalidateFirstPage: false, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const batches = data ? data.flatMap((page) => page.data) : []
  const isLoadingInitial = !data && !error
  const isLoadingMore = isLoadingInitial || (size > 0 && data && typeof data[size - 1] === 'undefined')
  const hasMore = data ? !!data[data.length - 1]?.cursor : false

  const unhideBatch = useCallback(async (id: string) => {
    await apiPatch(`/batches/${id}/unhide`, {})
    mutate((pages) => {
      if (!pages) return pages
      return pages.map((page) => ({ ...page, data: page.data.filter((b) => b.id !== id) }))
    }, { revalidate: false })
  }, [mutate])

  return {
    batches,
    error,
    isLoadingInitial,
    isLoadingMore: !!isLoadingMore,
    isValidating,
    hasMore,
    loadMore: () => setSize(size + 1),
    mutate,
    unhideBatch,
  }
}

