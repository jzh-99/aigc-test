'use client'

import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useShortDramaProject } from '@/hooks/short-drama/use-short-drama-project'
import { EpisodeEditor } from '@/components/short-drama/episode-editor'
import { Button } from '@/components/ui/button'

export default function EpisodeEditorPage() {
  const params = useParams()
  const projectId = params.id as string
  const episodeNumber = parseInt(params.episodeId as string, 10)

  const { project, state, isLoading, error, mutate } = useShortDramaProject(projectId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !project || !state) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-muted-foreground">
        {error?.message ?? '项目加载失败'}
      </div>
    )
  }

  const episode = state.episodes.items.find(ep => ep.episodeNumber === episodeNumber)

  if (!episode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <p className="text-muted-foreground">第 {episodeNumber} 集不存在</p>
        <Link href={`/toby-studio/short-drama/${projectId}`}>
          <Button variant="outline">返回项目</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex items-center gap-4 rounded-2xl border bg-card/80 px-4 py-3">
        <Link href={`/toby-studio/short-drama/${projectId}`}>
          <Button variant="ghost" size="sm">← 返回</Button>
        </Link>
        <h1 className="text-lg font-bold tracking-tight">
          第 {episodeNumber} 集：{episode.title}
        </h1>
      </div>

      <EpisodeEditor
        projectId={projectId}
        episode={episode}
        state={state}
        onStateChange={() => mutate()}
      />
      </div>
    </div>
  )
}
