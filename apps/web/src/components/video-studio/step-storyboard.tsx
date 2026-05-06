'use client'

import { useState, useCallback } from 'react'
import { Loader2, Plus, Trash2, ArrowRight, RefreshCw, User, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { splitStoryboard } from '@/lib/video-studio-api'
import type { Fragment, Shot } from '@/lib/video-studio-api'
import type { DescribeData } from '@/hooks/video-studio/use-wizard-state'

interface Props {
  describeData: DescribeData
  script: string
  characters?: Array<{ name: string; description: string; voiceDescription?: string }>
  scenes?: Array<{ name: string; description: string }>
  initial?: Fragment[]
  defaultFragmentCount?: number
  onComplete: (fragments: Fragment[]) => void
}

export function StepStoryboard({ describeData, script, characters, scenes, initial, defaultFragmentCount, onComplete }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const [loading, setLoading] = useState(false)
  const [fragments, setFragments] = useState<Fragment[]>(initial ?? [])
  const [fragmentCount, setFragmentCount] = useState(() => defaultFragmentCount ?? Math.ceil(describeData.duration / 12))
  const shots = fragments.flatMap((fragment) => fragment.shots ?? [])

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const res = await splitStoryboard({
        script,
        fragmentCount,
        duration: describeData.duration,
        aspectRatio: describeData.aspectRatio,
        style: describeData.style,
        characters,
        scenes,
      }, token ?? undefined)
      setFragments(res.fragments)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '片段生成失败')
    } finally {
      setLoading(false)
    }
  }, [script, fragmentCount, describeData.duration, describeData.aspectRatio, describeData.style, characters, scenes, token])

  const updateShot = (id: string, patch: Partial<Shot>) => {
    setFragments((prev) => prev.map((fragment) => ({
      ...fragment,
      shots: fragment.shots.map((shot) => shot.id === id ? { ...shot, ...patch } : shot),
    })))
  }

  const removeShot = (id: string) => {
    setFragments((prev) => prev.map((fragment) => ({
      ...fragment,
      shots: fragment.shots.filter((shot) => shot.id !== id),
    })).filter((fragment) => fragment.shots.length > 0))
  }

  const addShot = (fragmentId: string) => {
    const newId = `shot_${Date.now()}`
    setFragments((prev) => prev.map((fragment) => fragment.id === fragmentId ? {
      ...fragment,
      shots: [...fragment.shots, { id: newId, label: `分镜${fragment.shots.length + 1}`, content: '', cameraMove: '固定镜头', duration: 5 }],
    } : fragment))
  }

  return (
    <div className="flex h-full">
      <div className="w-[280px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">片段规划</h2>
          <p className="text-xs text-muted-foreground mt-0.5">AI 将剧本拆成 10-15 秒长片段，每段含 1-3 个分镜</p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1.5">片段数量</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={fragmentCount}
              onChange={(e) => setFragmentCount(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="text-sm font-medium w-16 text-right">{fragmentCount} 个</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">约 {fragmentCount * 12} 秒，每段 1-3 镜</p>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 text-sm bg-primary text-primary-foreground py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? '生成中…' : fragments.length > 0 ? '重新生成' : '生成片段'}
        </button>

        {fragments.length > 0 && (
          <button
            onClick={() => onComplete(fragments)}
            className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
          >
            确认片段，生成参考图
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 p-5 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            AI 正在规划长片段…
          </div>
        )}

        {!loading && fragments.length === 0 && (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            点击左侧“生成片段”开始
          </div>
        )}

        {!loading && fragments.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{fragments.length} 个片段 · {shots.length} 个分镜</p>

            {fragments.map((fragment, fragmentIndex) => (
              <div key={fragment.id} className="border rounded-xl bg-muted/20 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{fragment.label || `片段${fragmentIndex + 1}`} · {fragment.duration}s</p>
                    {fragment.transition && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">过渡：{fragment.transition}</p>}
                  </div>
                  <button onClick={() => addShot(fragment.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                    添加分镜
                  </button>
                </div>

                {fragment.shots.map((shot, idx) => (
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
                      <label className="text-[11px] text-muted-foreground mb-1 block">分镜描述</label>
                      <textarea
                        className="w-full text-xs bg-muted/50 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
                        value={shot.content}
                        onChange={(e) => updateShot(shot.id, { content: e.target.value })}
                        placeholder="分镜内容描述…"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">台词音色与语气</label>
                      <textarea
                        className="w-full text-xs bg-muted/50 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[44px]"
                        value={shot.voiceNote ?? ''}
                        onChange={(e) => updateShot(shot.id, { voiceNote: e.target.value })}
                        placeholder="例如：沈念安：青年女声，清亮柔和；语气：哽咽但强撑镇定。"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
