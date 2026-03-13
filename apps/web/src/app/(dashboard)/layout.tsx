'use client'

import { AppShell } from '@/components/layout/app-shell'
import { SWRProvider } from '@/lib/swr-provider'
import { AuthProvider } from '@/lib/auth-provider'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SWRProvider>
        <AppShell>{children}</AppShell>
      </SWRProvider>
    </AuthProvider>
  )
}
