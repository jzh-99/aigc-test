'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, Film, Loader2 } from 'lucide-react'
import { listShortDramaProjects } from '@/lib/short-drama/api'
import { useAuthStore } from '@/stores/auth-store'
import { ShortDramaProjectCard } from '@/components/short-drama/short-drama-project-card'

export default function ShortDramaProjectsPage() {
  const workspaceId = useAuthStore(state => state.activeWorkspaceId)
  const projects = useSWR(
    workspaceId ? ['short-drama-projects', workspaceId] : null,
    () => listShortDramaProjects(workspaceId!, undefined, 80),
  )
  const items = projects.data?.items ?? []

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      <div className="sticky top-[-1rem] z-20 flex h-16 items-center border-b bg-card/95 px-5 backdrop-blur md:top-[-1.5rem] md:px-8">
        <Link href="/toby-studio/short-drama" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回 AI短剧
        </Link>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">全部短剧项目</h1>
            <p className="mt-1 text-sm text-muted-foreground">查看草稿、素材进度和已完成的短剧项目。</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Film className="h-5 w-5" />
          </div>
        </div>

        {projects.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="h-[148px] animate-pulse rounded-lg border bg-card dark:border-[#201b49] dark:bg-[#0d0b1d]" />
            ))}
          </div>
        ) : projects.error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-10 text-center text-sm text-destructive">
            短剧项目加载失败
          </div>
        ) : items.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map(project => (
              <ShortDramaProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground dark:border-[#302858] dark:bg-[#0d0b1d]">
            还没有短剧项目。
          </div>
        )}

        {projects.isValidating && !projects.isLoading ? (
          <div className="mt-5 flex justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            正在更新项目列表
          </div>
        ) : null}
      </main>
    </div>
  )
}
