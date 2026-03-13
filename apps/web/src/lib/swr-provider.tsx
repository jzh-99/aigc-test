'use client'

import { SWRConfig } from 'swr'
import { apiFetcher } from './api-client'

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        revalidateOnFocus: false,
        errorRetryCount: 3,
        dedupingInterval: 5000,
      }}
    >
      {children}
    </SWRConfig>
  )
}
