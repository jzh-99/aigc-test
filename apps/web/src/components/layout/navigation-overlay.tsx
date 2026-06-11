'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useNavigationStore } from '@/stores/navigation-store'

/** 导航超时保护：最多显示 10 秒后自动关闭，防止遮罩卡住 */
const SAFETY_TIMEOUT_MS = 10_000

/**
 * 全局导航加载遮罩
 *
 * 挂载在 AppShell 顶层，监听 pathname 变化自动关闭。
 * 当用户点击侧边栏/顶部导航时立即显示，
 * 直到 Next.js 完成路由切换并渲染新页面后消失。
 */
export function NavigationOverlay() {
  const pathname = usePathname()
  const isLoading = useNavigationStore((s) => s.isLoading)
  const stopNavigation = useNavigationStore((s) => s.stopNavigation)

  // pathname 变化 = 导航完成，关闭遮罩
  useEffect(() => {
    stopNavigation()
  }, [pathname, stopNavigation])

  // 安全超时：防止遮罩因异常卡住（如导航被拦截、同页面点击等）
  useEffect(() => {
    if (!isLoading) return
    const timer = setTimeout(stopNavigation, SAFETY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isLoading, stopNavigation])

  if (!isLoading) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/50 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">页面加载中…</p>
      </div>
    </div>
  )
}
