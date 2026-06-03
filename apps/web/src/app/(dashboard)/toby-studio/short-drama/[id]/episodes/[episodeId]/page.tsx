'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useShortDramaProject } from '@/hooks/short-drama/use-short-drama-project'
import { useModels } from '@/hooks/use-models'
import { useAuthStore } from '@/stores/auth-store'
import { EpisodeEditor } from '@/components/short-drama/episode-editor'
import { Button } from '@/components/ui/button'
import { extractSchemaEnums } from '@/components/generation/shared/schema-utils'
import { parseCategoryReferences } from '@aigc/types'

type VideoResolution = '720p' | '1080p'

const DEFAULT_VIDEO_MODEL = 'seedance-2.0'
const DEFAULT_VIDEO_RESOLUTION: VideoResolution = '720p'
const FALLBACK_VIDEO_RESOLUTIONS: VideoResolution[] = ['720p', '1080p']

export default function EpisodeEditorPage() {
  const params = useParams()
  const projectId = params.id as string
  const episodeNumber = parseInt(params.episodeId as string, 10)
  const workspaceId = useAuthStore(state => state.activeWorkspaceId)

  const { project, state, isLoading, error, mutate } = useShortDramaProject(projectId)
  const { models: videoModels } = useModels('video', workspaceId)
  const [videoModel, setVideoModel] = useState(DEFAULT_VIDEO_MODEL)
  const [videoResolution, setVideoResolution] = useState<VideoResolution>(DEFAULT_VIDEO_RESOLUTION)

  const multimodalVideoModels = useMemo(
    () => videoModels.filter(model => Boolean(parseCategoryReferences(model.category_references).multimodal)),
    [videoModels],
  )
  const selectableVideoModels = multimodalVideoModels.length > 0 ? multimodalVideoModels : videoModels
  const selectedVideoModel = selectableVideoModels.find(model => model.code === videoModel)
  const resolutionOptions = useMemo(() => {
    const modelResolutions = extractSchemaEnums(selectedVideoModel?.params_schema, 'resolution')
      .map(item => item.value)
      .filter((value): value is VideoResolution => value === '720p' || value === '1080p')

    return modelResolutions.length > 0 ? modelResolutions : FALLBACK_VIDEO_RESOLUTIONS
  }, [selectedVideoModel])

  useEffect(() => {
    if (selectableVideoModels.length === 0) return
    if (selectableVideoModels.some(model => model.code === videoModel)) return

    const defaultModel = selectableVideoModels.find(model => model.code === DEFAULT_VIDEO_MODEL) ?? selectableVideoModels[0]
    setVideoModel(defaultModel.code)
  }, [videoModel, selectableVideoModels])

  useEffect(() => {
    if (resolutionOptions.includes(videoResolution)) return
    setVideoResolution(resolutionOptions[0] ?? DEFAULT_VIDEO_RESOLUTION)
  }, [resolutionOptions, videoResolution])

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
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card/80 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Link href={`/toby-studio/short-drama/${projectId}`}>
            <Button variant="ghost" size="sm">← 返回</Button>
          </Link>
          <h1 className="truncate text-lg font-bold tracking-tight">
            第 {episodeNumber} 集：{episode.title}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>模型</span>
            <select
              value={videoModel}
              onChange={event => setVideoModel(event.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/25"
            >
              {(selectableVideoModels.length > 0 ? selectableVideoModels : [{ code: DEFAULT_VIDEO_MODEL, name: 'Seedance 2.0' }]).map(model => (
                <option key={model.code} value={model.code}>
                  {'name' in model && model.name ? model.name : model.code}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>清晰度</span>
            <select
              value={videoResolution}
              onChange={event => setVideoResolution(event.target.value as VideoResolution)}
              className="h-8 rounded-md border bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/25"
            >
              {resolutionOptions.map(resolution => (
                <option key={resolution} value={resolution}>
                  {resolution}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <EpisodeEditor
        projectId={projectId}
        episode={episode}
        state={state}
        videoModel={videoModel}
        videoResolution={videoResolution}
        onStateChange={(nextState) => {
          if (nextState) {
            mutate(current => current ? { ...current, state: nextState } : current, false)
            return
          }
          return mutate()
        }}
      />
      </div>
    </div>
  )
}
