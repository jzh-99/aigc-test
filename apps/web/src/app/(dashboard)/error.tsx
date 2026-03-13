'use client'

import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">出错了</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {error.message || '页面加载时发生了意外错误'}
          </p>
        </div>
        <Button variant="outline" onClick={reset}>
          重试
        </Button>
      </div>
    </div>
  )
}
