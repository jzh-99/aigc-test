import { AppShell } from '@/components/layout/app-shell'
import { SWRProvider } from '@/lib/swr-provider'
import { AuthProvider } from '@/lib/auth-provider'

export default function CanvasEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SWRProvider>
        <AppShell mainClassName="flex-1 overflow-hidden flex flex-col">
          {children}
        </AppShell>
      </SWRProvider>
    </AuthProvider>
  )
}
