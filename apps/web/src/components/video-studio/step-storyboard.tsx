'use client'

import { useState, useCallback } from 'react'
import { Loader2, Plus, Trash2, ArrowRight, RefreshCw, User, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { splitStoryboard } from '@/lib/video-studio-api'
import type { Shot } from '@/lib/video-studio-api'
import type { DescribeData } from '@/hooks/video-studio/use-wizard-state'

interface Props {
  describeData: DescribeData
  script: string
  characters?: Array<{ name: string; description: string }>
  scenes?: Array<{ name: string; description: string }>
  initial?: Shot[]
  onComplete: (shots: Shot[]) => void
}

export function StepStoryboard({ describeData, script, characters, scenes, initial, onComplete }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const [loading, setLoading] = useState(false)
  const [shots, setShots] = useState<Shot[]>(initial ?? [])
  const [shotCount, setShotCount] = useState(() => Math.ceil(describeData.duration / 10))

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const res = await splitStoryboard({
        script,
        shotCount,
        aspectRatio: describeData.aspectRatio,
        style: describeData.style,
        characters,
        scenes,
      }, token ?? undefined)
      setShots(res.shots)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '分镜生成失败')
    } finally {
      setLoading(false)
    }
  }, [script, shotCount, describeData.aspectRatio, describeData.style, characters, scenes, token])

  const updateContent = (id: string, content: string) => {
    setShots((prev) => prev.map((s) => s.id === id ? { ...s, content } : s))
  }

  const removeShot = (id: string) => {
    setShots((prev) => prev.filter((s) => s.id !== id))
  }

  const addShot = () => {
    const newId = `shot_${Date.now()}`
    setShots((prev) => [...prev, { id: newId, label: `镜头${prev.length + 1}`, content: '', cameraMove: '固定镜头', duration: 5 }])
  }

  return (
    <div className="flex h-full">
      {/* Left: controls */}
      <div className="w-[280px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">分镜规划</h2>
          <p className="text-xs text-muted-foreground mt-0.5">AI 将剧本拆分为可执行的分镜</p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1.5">镜头数量</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={shotCount}
              onChange={(e) => setShotCount(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="text-sm font-medium w-16 text-right">{shotCount} 个</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">约 {shotCount * 8} 秒</p>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 text-sm bg-primary text-primary-foreground py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? '生成中…' : shots.length > 0 ? '重新生成' : '✨ 生成分镜'}
        </button>

        {shots.length > 0 && (
          <button
            onClick={() => onComplete(shots)}
            className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
          >
            确认分镜，生成参考图
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Right: shot list */}
      <div className="flex-1 p-5 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            AI 正在规划分镜…
          </div>
        )}

        {!loading && shots.length === 0 && (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            点击左侧"生成分镜"开始
          </div>
        )}

        {!loading && shots.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">{shots.length} 个镜头</p>
              <button onClick={addShot} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="w-3.5 h-3.5" />
                添加镜头
              </button>
            </div>

            {shots.map((shot, idx) => (
              <div key={shot.id} className="border rounded-xl bg-card p-4 space-y-3 group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-muted-foreground w-6">{idx + 1}</span>
                    <span className="text-sm font-medium">{shot.label}</span>
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{shot.cameraMove}</span>
                    <span className="text-xs text-muted-foreground">{shot.duration}s</span>
                  </div>
                  <button
                    onClick={() => removeShot(shot.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Characters & Scene tags */}
                {((shot.characters && shot.characters.length > 0) || shot.scene) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {shot.characters?.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded">
                        <User className="w-2.5 h-2.5" />{c}
                      </span>
                    ))}
                    {shot.scene && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-0.5 rounded">
                        <MapPin className="w-2.5 h-2.5" />{shot.scene}
                      </span>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">镜头描述</label>
                  <textarea
                    className="w-full text-xs bg-muted/50 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
                    value={shot.content}
                    onChange={(e) => updateContent(shot.id, e.target.value)}
                    placeholder="镜头内容描述…"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
