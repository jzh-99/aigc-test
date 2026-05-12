'use client'

import useSWR from 'swr'
import type { AigcModule, ModelItem } from '@aigc/types'

export function useModels(module?: AigcModule, workspaceId?: string | null) {
  const params = new URLSearchParams()
  if (module) params.set('module', module)
  if (workspaceId) params.set('workspace_id', workspaceId)
  const url = `/models?${params.toString()}`

  const { data, isLoading, error } = useSWR<ModelItem[]>(url, {
    revalidateOnFocus: false,
  })

  return {
    models: data ?? [],
    isReady: !isLoading && data !== undefined,
    isLoading,
    error,
  }
}
