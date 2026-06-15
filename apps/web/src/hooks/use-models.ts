'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import type { AigcModule, ModelItem } from '@aigc/types'
import { useAuthStore } from '@/stores/auth-store'
import { preloadModelBrandIcons } from '@/components/generation/shared/model-brand-icon'

export function useModels(module?: AigcModule, workspaceId?: string | null) {
  const isInitialized = useAuthStore((s) => s.isInitialized)

  const params = new URLSearchParams()
  if (module) params.set('module', module)
  if (workspaceId) params.set('workspace_id', workspaceId)
  const url = isInitialized ? `/models?${params.toString()}` : null

  const { data, isLoading, error } = useSWR<ModelItem[]>(url, {
    revalidateOnFocus: false,
  })

  useEffect(() => {
    preloadModelBrandIcons(data)
  }, [data])

  return {
    models: data ?? [],
    isReady: !isLoading && data !== undefined,
    isLoading,
    error,
  }
}
