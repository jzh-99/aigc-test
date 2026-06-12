'use client'

import useSWR from 'swr'
import type { BatchStatsResponse } from '@aigc/types'
import { useAuthStore } from '@/stores/auth-store'

export function useBatchStats() {
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const isInitialized = useAuthStore((s) => s.isInitialized)

  const key = isInitialized && activeWorkspaceId
    ? `/batches/stats?workspace_id=${activeWorkspaceId}`
    : null

  const { data, error, isLoading } = useSWR<BatchStatsResponse>(key, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 30000,
  })

  return {
    total: (data?.total_completed || 0) + (data?.total_failed || 0),
    totalCompleted: data?.total_completed ?? 0,
    totalFailed: data?.total_failed ?? 0,
    successRate: data?.success_rate ?? null,
    isLoading,
    error,
  }
}
