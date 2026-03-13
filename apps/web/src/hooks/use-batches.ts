'use client'

import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useCallback } from 'react'
import type { BatchResponse, BatchListResponse } from '@aigc/types'
import { useAuthStore } from '@/stores/auth-store'

const PAGE_SIZE = 20

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
    { revalidateFirstPage: true },
  )

  const batches = data ? data.flatMap((page) => page.data) : []
  const isLoadingInitial = !data && !error
  const isLoadingMore = isLoadingInitial || (size > 0 && data && typeof data[size - 1] === 'undefined')
  const hasMore = data ? !!data[data.length - 1]?.cursor : false

  // Optimistically prepend a new batch to the top of the list (no API call)
  const prependBatch = useCallback((batch: BatchResponse) => {
    mutate((pages) => {
      if (!pages || pages.length === 0) return [{ data: [batch], cursor: null }]
      const [first, ...rest] = pages
      // Avoid duplicate if already present
      if (first.data.some((b) => b.id === batch.id)) return pages
      return [{ ...first, data: [batch, ...first.data] }, ...rest]
    }, { revalidate: false })
  }, [mutate])

  // Update a single batch in cache (called on each SSE event)
  const updateBatchInList = useCallback((updated: BatchResponse) => {
    console.log('[useBatches] updateBatchInList called with:', updated.id, updated.status, updated.completed_count)
    mutate((pages) => {
      if (!pages) return pages
      // Create new array references to trigger React re-renders
      const newPages = pages.map((page) => ({
        ...page,
        data: page.data.map((b) => b.id === updated.id ? { ...b, ...updated } : b),
      }))
      console.log('[useBatches] mutate completed, new pages:', newPages[0]?.data[0])
      return newPages
    }, { revalidate: false })  // Trust SSE data, don't refetch immediately
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
  }
}
