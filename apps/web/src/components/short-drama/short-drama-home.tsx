'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'
import { SHORT_DRAMA_ASPECT_RATIOS, SHORT_DRAMA_EPISODE_COUNTS } from '@aigc/types'
import type { ShortDramaAspectRatio } from '@aigc/types'
import { ShortDramaStyleDialog } from './short-drama-style-dialog'
import { ShortDramaProjectCard } from './short-drama-project-card'
import {
  createShortDramaProject,
  listRecentShortDramaProjects,
  type ShortDramaProjectListItem,
} from '@/lib/short-drama/api'

export function ShortDramaHome() {
  const router = useRouter()
  const workspaceId = useAuthStore(s => s.activeWorkspaceId)

  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('真人都市')
  const [aspectRatio, setAspectRatio] = useState<ShortDramaAspectRatio>('9:16')
  const [episodeCount, setEpisodeCount] = useState(10)
  const [submitting, setSubmitting] = useState(false)

  const { data: recentProjects, isLoading: loadingProjects } = useSWR<ShortDramaProjectListItem[]>(
    workspaceId ? ['short-drama-recent', workspaceId] : null,
    () => listRecentShortDramaProjects(workspaceId!),
    { revalidateOnFocus: true }
  )

  const handleSubmit = async () => {
    if (!prompt.trim() || !workspaceId) return
    setSubmitting(true)
    try {
      const result = await createShortDramaProject({
        workspaceId,
        prompt: prompt.trim(),
        style,
        aspectRatio,
        episodeCount,
      })
      toast.success('项目创建成功')
      router.push(`/toby-studio/short-drama/${result.projectId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">AI 短剧</h1>
        <p className="text-muted-foreground mt-1">输入创意，AI 帮你生成完整短剧</p>
      </div>

      <div className="space-y-4 p-6 rounded-xl border bg-card">
        <Textarea
          placeholder="描述你的短剧创意，例如：一个普通外卖员意外获得超能力，在都市中行侠仗义的故事..."
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="min-h-[120px] resize-none"
          maxLength={2000}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">视觉风格</label>
            <ShortDramaStyleDialog value={style} onChange={setStyle} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">画面比例</label>
            <select
              value={aspectRatio}
              onChange={e => setAspectRatio(e.target.value as ShortDramaAspectRatio)}
              className="w-full h-10 px-3 rounded-md border bg-background text-sm"
            >
              {SHORT_DRAMA_ASPECT_RATIOS.map(r => (
                <option key={r} value={r}>{r === '9:16' ? '竖屏 9:16' : '横屏 16:9'}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">集数</label>
            <select
              value={episodeCount}
              onChange={e => setEpisodeCount(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-md border bg-background text-sm"
            >
              {SHORT_DRAMA_EPISODE_COUNTS.map(c => (
                <option key={c} value={c}>{c} 集</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            创建项目后将消耗少量积分用于 AI 文本生成
          </p>
          <Button
            onClick={handleSubmit}
            disabled={!prompt.trim() || submitting || !workspaceId}
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />创建中...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" />开始创作</>
            )}
          </Button>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">最近项目</h2>
        {loadingProjects ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            加载中...
          </div>
        ) : !recentProjects || recentProjects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            还没有短剧项目，开始你的第一个创作吧
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentProjects.map(project => (
              <ShortDramaProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
