'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, BookOpenText } from 'lucide-react'
import { listPictureBookProjects } from '@/lib/picture-book/api'
import { useAuthStore } from '@/stores/auth-store'
import { PictureBookProjectCard } from '@/components/picture-book/picture-book-project-card'

export default function PictureBookProjectsPage() {
  const workspaceId = useAuthStore((state) => state.activeWorkspaceId)
  const projects = useSWR(
    workspaceId ? ['picture-book-projects', workspaceId] : null,
    () => listPictureBookProjects(workspaceId!, 80),
  )

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      <div className="sticky top-[-1rem] z-20 flex h-16 items-center border-b bg-card/95 px-5 backdrop-blur md:top-[-1.5rem] md:px-8">
        <Link href="/toby-studio/picture-book" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回 AI绘本
        </Link>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">我的绘本</h1>
            <p className="mt-1 text-sm text-muted-foreground">草稿、资产生成进度和已完成项目都在这里。</p>
          </div>
          <BookOpenText className="h-8 w-8 text-primary" />
        </div>

        {projects.isLoading ? (
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-64 animate-pulse rounded-lg border bg-muted" />
            ))}
          </div>
        ) : projects.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {projects.data.map((project) => (
              <PictureBookProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <p className="text-sm text-muted-foreground">还没有绘本项目。</p>
          </div>
        )}
      </main>
    </div>
  )
}
