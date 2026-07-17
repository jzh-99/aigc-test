'use client'

import Link from 'next/link'
import { BookOpenText, Clock3, Layers3, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { PictureBookProjectListItem } from '@/lib/picture-book/types'
import { useNavigationStore } from '@/stores/navigation-store'

const statusText: Record<string, string> = {
  draft: '草稿',
  generating: '生成中',
  script_ready: '剧本',
  assets_ready: '资产',
  storyboard_ready: '分镜',
  completed: '完成',
  failed: '失败',
}

export function PictureBookProjectCard({ project }: { project: PictureBookProjectListItem }) {
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  const isGenerating = project.status === 'generating'

  // 卡片内容（封面 + 信息）
  const cardContent = (
    <>
      <div className="aspect-[4/3] bg-muted">
        {isGenerating ? (
          <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(135deg,hsl(var(--muted)),hsl(var(--background)))]">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
          </div>
        ) : project.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.cover_url} alt={project.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(135deg,hsl(var(--muted)),hsl(var(--background)))]">
            <BookOpenText className="h-9 w-9 text-muted-foreground transition-colors group-hover:text-primary" />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5">{project.title || '未命名绘本'}</h3>
          <Badge variant={project.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0">
            {statusText[project.status] ?? project.status}
          </Badge>
        </div>
        <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{project.prompt || '暂无主题描述'}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Layers3 className="h-3.5 w-3.5" />
            {project.page_count} 页
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {formatDate(project.updated_at)}
          </span>
        </div>
      </div>
    </>
  )

  // 生成中：项目尚未就绪，不跳转；悬停显示禁止光标提示大纲生成中
  if (isGenerating) {
    return (
      <div
        className="group block cursor-not-allowed overflow-hidden rounded-lg border bg-card"
        title="大纲生成中，请稍候"
        aria-disabled="true"
      >
        {cardContent}
      </div>
    )
  }

  return (
    <Link
      href={`/toby-studio/picture-book/${project.id}`}
      className="group block overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/60"
      onClick={() => startNavigation(`/toby-studio/picture-book/${project.id}`)}
    >
      {cardContent}
    </Link>
  )
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
  } catch {
    return ''
  }
}
