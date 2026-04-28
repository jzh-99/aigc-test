'use client'

import { useState, useCallback } from 'react'
import { Loader2, RefreshCw, ArrowRight, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { writeScript } from '@/lib/video-studio-api'
import type { DescribeData } from '@/hooks/video-studio/use-wizard-state'
import type { ScriptResult } from '@/lib/video-studio-api'

interface Props {
  describeData: DescribeData
  initial?: Omit<ScriptResult, 'success'> | null
  scriptHistory?: Omit<ScriptResult, 'success'>[]
  onGenerated?: (data: Omit<ScriptResult, 'success'>) => void
  onComplete: (data: Omit<ScriptResult, 'success'>) => void
}

export function StepScript({ describeData, initial, scriptHistory = [], onGenerated, onComplete }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [result, setResult] = useState<Omit<ScriptResult, 'success'> | null>(initial ?? null)
  const [editedScript, setEditedScript] = useState(initial?.script ?? '')
  // index into scriptHistory; -1 means the latest freshly generated result
  const [historyIndex, setHistoryIndex] = useState<number>(scriptHistory.length > 0 ? scriptHistory.length - 1 : -1)

  const generate = useCallback(async (fb?: string) => {
    setLoading(true)
    try {
      const res = await writeScript({
        description: describeData.description,
        style: describeData.style,
        duration: describeData.duration,
        feedback: fb,
      }, token ?? undefined)
      setResult(res)
      setEditedScript(res.script)
      setFeedback('')
      setShowFeedback(false)
      setHistoryIndex(-1)
      // Persist immediately so switching steps doesn't lose the generated result
      onGenerated?.(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }, [describeData, token, onGenerated])

  const handleConfirm = () => {
    if (!result) return
    onComplete({ ...result, script: editedScript })
  }

  const hasFreshResult = result != null && (scriptHistory.length === 0 || scriptHistory[scriptHistory.length - 1]?.script !== result.script)
  // Display newest first: latest version is always 1/N, older versions count upward.
  const versions = result && hasFreshResult ? [result, ...scriptHistory.toReversed()] : scriptHistory.toReversed()
  const totalVersions = versions.length
  const effectiveIndex = result ? Math.max(0, versions.findIndex((entry) => entry.script === result.script)) : 0
  const displayIndex = effectiveIndex + 1
  const canGoPrev = totalVersions > 1 && effectiveIndex > 0
  const canGoNext = totalVersions > 1 && effectiveIndex < totalVersions - 1

  const loadVersion = (idx: number) => {
    const entry = versions[idx]
    if (!entry) return
    setResult(entry)
    setEditedScript(entry.script)
    setHistoryIndex(scriptHistory.findIndex((historyEntry) => historyEntry.script === entry.script))
  }

  const goPrev = () => {
    if (!canGoPrev) return
    loadVersion(effectiveIndex - 1)
  }

  const goNext = () => {
    if (!canGoNext) return
    loadVersion(effectiveIndex + 1)
  }

  return (
    <div className="flex h-full">
      {/* Left: form */}
      <div className="w-[380px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">生成剧本</h2>
          <p className="text-xs text-muted-foreground mt-0.5">AI 根据你的描述生成完整剧本</p>
        </div>

        <div className="p-3 bg-muted/50 rounded-lg text-xs space-y-1">
          <p><span className="text-muted-foreground">主题：</span>{describeData.description.slice(0, 60)}{describeData.description.length > 60 ? '…' : ''}</p>
          <p><span className="text-muted-foreground">风格：</span>{describeData.style} · {describeData.duration}秒</p>
        </div>

        {!result ? (
          <button
            onClick={() => generate()}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 text-sm bg-primary text-primary-foreground py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? '生成中…' : '✨ 生成剧本'}
          </button>
        ) : (
          <div className="space-y-3">
            {totalVersions > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground border rounded-lg px-3 py-2">
                <span>版本 {displayIndex} / {totalVersions}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={goPrev}
                    disabled={!canGoPrev}
                    className="p-0.5 hover:text-foreground disabled:opacity-30 transition-colors"
                    title="上一版本"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!canGoNext}
                    className="p-0.5 hover:text-foreground disabled:opacity-30 transition-colors"
                    title="下一版本"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => setShowFeedback(!showFeedback)}
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
            >
              <span>对剧本有修改意见？</span>
              {showFeedback ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showFeedback && (
              <div className="space-y-2">
                <textarea
                  className="w-full h-20 p-2.5 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="例如：把结局改成悲剧，增加一个反转…"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <button
                  onClick={() => generate(feedback)}
                  disabled={loading || !feedback.trim()}
                  className="w-full flex items-center justify-center gap-1.5 text-xs border border-border py-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  按意见重新生成
                </button>
              </div>
            )}

            <button
              onClick={handleConfirm}
              className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
            >
              确认剧本，进入分镜
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Right: preview */}
      <div className="flex-1 p-5 overflow-y-auto space-y-4">
        {!result && !loading && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            点击左侧"生成剧本"开始
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            AI 正在创作剧本…
          </div>
        )}
        {result && !loading && (
          <div className="space-y-4">
            {result.title && (
              <h3 className="text-lg font-bold">{result.title}</h3>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {result.characters.map((c) => (
                  <div key={c.name} className="text-xs bg-orange-50 border border-orange-200 text-orange-800 px-2.5 py-1.5 rounded-lg max-w-[220px]">
                    <p className="font-semibold">👤 {c.name}</p>
                    {c.description && <p className="text-orange-600 mt-0.5 leading-relaxed">{c.description}</p>}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {result.scenes.map((s) => (
                  <div key={s.name} className="text-xs bg-blue-50 border border-blue-200 text-blue-800 px-2.5 py-1.5 rounded-lg max-w-[220px]">
                    <p className="font-semibold">🏞 {s.name}</p>
                    {s.description && <p className="text-blue-600 mt-0.5 leading-relaxed">{s.description}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="border rounded-xl bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2">剧本全文（可编辑）</p>
              <textarea
                className="w-full text-sm leading-relaxed bg-transparent resize-none focus:outline-none min-h-[300px]"
                value={editedScript}
                onChange={(e) => setEditedScript(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
