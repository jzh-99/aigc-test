'use client'

import { useCallback, useState } from 'react'
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { generateSeriesOutline } from '@/lib/video-studio-api'
import type { DescribeData, SeriesOutline } from '@/hooks/video-studio/use-wizard-state'

interface Props {
  describeData: DescribeData
  episodeCount: number
  initial?: SeriesOutline | null
  activeEpisodeId?: string | null
  onGenerated: (outline: SeriesOutline) => void
  onSelectEpisode: (episodeId: string) => void
  onComplete: () => void
}

export function StepOutline({ describeData, episodeCount, initial, activeEpisodeId, onGenerated, onSelectEpisode, onComplete }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const [loading, setLoading] = useState(false)
  const [outline, setOutline] = useState<SeriesOutline | null>(initial ?? null)
  const selectedEpisodeId = activeEpisodeId ?? outline?.episodes[0]?.id ?? null

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const res = await generateSeriesOutline({
        description: describeData.description,
        style: describeData.style,
        episodeCount,
        episodeDuration: describeData.duration,
      }, token ?? undefined)
      const next = {
        title: res.title,
        synopsis: res.synopsis,
        worldbuilding: res.worldbuilding,
        mainCharacters: res.mainCharacters,
        mainScenes: res.mainScenes,
        relationships: res.relationships,
        episodes: res.episodes,
      }
      setOutline(next)
      onGenerated(next)
      if (next.episodes[0]) onSelectEpisode(next.episodes[0].id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '大纲生成失败')
    } finally {
      setLoading(false)
    }
  }, [describeData, episodeCount, token, onGenerated, onSelectEpisode])

  return (
    <div className="flex h-full">
      <div className="w-[320px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">剧集大纲</h2>
          <p className="text-xs text-muted-foreground mt-0.5">先搭建全剧主线，再选择单集制作</p>
        </div>

        <div className="p-3 bg-muted/50 rounded-lg text-xs space-y-1">
          <p><span className="text-muted-foreground">集数：</span>{episodeCount} 集</p>
          <p><span className="text-muted-foreground">单集：</span>{describeData.duration} 秒 · {describeData.style}</p>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 text-sm bg-primary text-primary-foreground py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? '生成中…' : outline ? '重新生成大纲' : '生成剧集大纲'}
        </button>

        {outline && selectedEpisodeId && (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
          >
            确认大纲，生成主要人物场景
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 p-5 overflow-y-auto space-y-4">
        {!outline && !loading && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            点击左侧“生成剧集大纲”开始
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            AI 正在规划剧集结构…
          </div>
        )}
        {outline && !loading && (
          <div className="space-y-4">
            <div className="border rounded-xl bg-card p-4 space-y-2">
              <h3 className="text-lg font-bold">{outline.title}</h3>
              <p className="text-sm leading-relaxed">{outline.synopsis}</p>
              {outline.worldbuilding && <p className="text-xs text-muted-foreground leading-relaxed">{outline.worldbuilding}</p>}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">主要人物</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {outline.mainCharacters.map((character) => (
                  <div key={character.name} className="text-xs border rounded-lg p-3 bg-orange-50 border-orange-200 text-orange-900">
                    <p className="font-semibold">{character.name}</p>
                    <p className="mt-1 text-orange-700 leading-relaxed">{character.description}</p>
                    {character.voiceDescription && <p className="mt-1 text-orange-600 leading-relaxed">音色：{character.voiceDescription}</p>}
                  </div>
                ))}
              </div>
            </div>

            {outline.mainScenes.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">主要场景</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {outline.mainScenes.map((scene) => (
                    <div key={scene.name} className="text-xs border rounded-lg p-3 bg-blue-50 border-blue-200 text-blue-900">
                      <p className="font-semibold">{scene.name}</p>
                      <p className="mt-1 text-blue-700 leading-relaxed">{scene.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-semibold">分集结构</p>
              {outline.episodes.map((episode, idx) => (
                <button
                  key={episode.id}
                  onClick={() => onSelectEpisode(episode.id)}
                  className={`w-full text-left border rounded-xl p-4 transition-colors ${selectedEpisodeId === episode.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/50'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">第 {idx + 1} 集：{episode.title}</p>
                    {selectedEpisodeId === episode.id && <span className="text-xs text-primary shrink-0">当前制作</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{episode.synopsis}</p>
                  {episode.coreConflict && <p className="text-xs mt-2 leading-relaxed">冲突：{episode.coreConflict}</p>}
                  {episode.hook && <p className="text-xs mt-1 leading-relaxed">钩子：{episode.hook}</p>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
