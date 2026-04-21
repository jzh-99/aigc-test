'use client'

import { useState, useCallback } from 'react'
import { Loader2, RefreshCw, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { executeScriptWriterNode } from '@/lib/canvas/canvas-api'
import type { StepsState } from '@/hooks/canvas/use-steps-state'

const STYLE_OPTIONS = ['现代都市', '古装', '科幻', '动漫', '纪录片', '悬疑', '奇幻']

interface Props {
  canvasId: string
  scriptData: StepsState['scriptData']
  onComplete: (data: NonNullable<StepsState['scriptData']>) => void
}

export function StepScript({ scriptData, onComplete }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const [description, setDescription] = useState(scriptData?.description ?? '')
  const [style, setStyle] = useState(scriptData?.style ?? '现代都市')
  const [duration, setDuration] = useState(scriptData?.duration ?? 60)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ script: string; characters: string[]; scenes: string[] } | null>(
    scriptData ? { script: scriptData.script, characters: scriptData.characters, scenes: scriptData.scenes } : null
  )

  const generate = useCallback(async () => {
    if (!description.trim()) { toast.error('请填写故事描述'); return }
    setLoading(true)
    try {
      const res = await executeScriptWriterNode({ description, style, duration }, token ?? undefined)
      setResult(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }, [description, style, duration, token])

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Step 1 · 剧本</h2>
        <p className="text-sm text-muted-foreground mt-1">描述你的故事，AI 将生成完整剧本、角色和场景列表</p>
      </div>

      {/* Config */}
      <div className="space-y-4 p-4 border rounded-xl bg-card">
        <div>
          <label className="text-sm font-medium block mb-1.5">故事描述</label>
          <textarea
            className="w-full h-24 p-3 text-sm bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="简单描述你想要的故事内容，例如：一个关于时间旅行的爱情故事…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium block mb-1.5">风格</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2"
            >
              {STYLE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="w-28">
            <label className="text-sm font-medium block mb-1.5">时长（秒）</label>
            <input
              type="number" min={10} max={600} step={10}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2"
            />
          </div>
        </div>
        <button
          onClick={generate}
          disabled={loading || !description.trim()}
          className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? '生成中…' : result ? '重新生成' : '生成剧本'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {result.characters.map((c) => (
              <span key={c} className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded-full">
                👤 {c}
              </span>
            ))}
            {result.scenes.map((s) => (
              <span key={s} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-2 py-1 rounded-full">
                🏞 {s}
              </span>
            ))}
          </div>

          <div className="border rounded-xl bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">剧本全文</p>
            <div className="text-sm whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
              {result.script}
            </div>
          </div>

          <button
            onClick={() => onComplete({ script: result.script, characters: result.characters, scenes: result.scenes, description, style, duration })}
            className="flex items-center gap-2 text-sm bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 transition-colors"
          >
            确认剧本，进入分镜
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
