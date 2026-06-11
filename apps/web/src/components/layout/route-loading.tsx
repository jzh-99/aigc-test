import { Loader2 } from 'lucide-react'

/**
 * 通用路由级加载占位组件
 *
 * 用于各栏目目录下的 loading.tsx，在 Next.js 客户端导航期间
 * 提供即时视觉反馈，避免页面空白。
 */
export function RouteLoading({ hint }: { hint?: string }) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}
