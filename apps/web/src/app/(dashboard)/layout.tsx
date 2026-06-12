'use client'

import { AppShell } from '@/components/layout/app-shell'
import { SWRProvider } from '@/lib/swr-provider'
import { AuthProvider } from '@/lib/auth-provider'
import { StoreHydration } from '@/lib/store-hydration'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SWRProvider>
        <StoreHydration />
        <AppShell>{children}</AppShell>
      </SWRProvider>
    </AuthProvider>
  )
}
