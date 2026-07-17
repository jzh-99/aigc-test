import { Loader2 } from 'lucide-react'

/**
 * 画布编辑器路由级加载占位
 * 在 Next.js 客户端导航到 /canvas/editor/[id] 时立即展示，
 * 避免从画廊跳转到编辑器期间出现空白页。
 */
export default function CanvasEditorLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background -m-4 md:-m-6">
      {/* 占位 header，与编辑器实际 header 高度一致 */}
      <header className="h-10 border-b shrink-0 bg-background" />

      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">画布加载中…</p>
        </div>
      </div>
    </div>
  )
}
