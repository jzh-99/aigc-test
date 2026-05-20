'use client'

import { useState, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { CanvasApiError, executeTextGenNode } from '@/lib/canvas/canvas-api'

interface TextInputPanelProps {
  textDraft: string
  setTextDraft: (value: string) => void
  flushTextDraft: () => void
  upstreamTextNodeLabels: string[]
}

export function TextInputPanel({
  textDraft,
  setTextDraft,
  flushTextDraft,
  upstreamTextNodeLabels,
}: TextInputPanelProps) {
  const token = useAuthStore((s) => s.accessToken)
  const [aiPrompt, setAiPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  // 流式输出时的实时预览文本，生成完成后写入 textDraft
  const streamingRef = useRef('')

  const handleGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) {
      toast.error('请先输入生成提示词')
      return
    }
    setGenerating(true)
    streamingRef.current = ''
    // 清空当前文本，准备流式填入
    setTextDraft('')

    try {
      await executeTextGenNode(
        { prompt: aiPrompt },
        (delta) => {
          streamingRef.current += delta
          // flushSync 强制每个 chunk 同步渲染，实现打字机逐字输出效果
          flushSync(() => {
            setTextDraft(streamingRef.current)
          })
        },
        token ?? undefined,
      )
      // 生成完成后持久化到 store
      flushTextDraft()
      toast.success('生成完成')
    } catch (err) {
      const message = err instanceof CanvasApiError ? err.message : '生成失败'
      toast.error(message)
      // 出错时恢复已生成的部分内容
      if (streamingRef.current) flushTextDraft()
    } finally {
      setGenerating(false)
    }
  }, [aiPrompt, token, setTextDraft, flushTextDraft])

  return (
    <div className="p-3 space-y-3">
      {/* AI 生成区 */}
      <div>
        <label className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
          <Sparkles size={10} />
          AI 生成
        </label>
        <textarea
          className="w-full h-16 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="描述你想生成的文本内容…"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
        />
        <button
          onClick={handleGenerate}
          disabled={generating || !aiPrompt.trim()}
          className="mt-1.5 w-full text-xs bg-primary text-primary-foreground rounded-lg py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {generating && <Loader2 size={11} className="animate-spin" />}
          {generating ? '生成中…' : '生成'}
        </button>
      </div>

      {/* 手动输入区 */}
      <div>
        <label className="text-[11px] font-medium text-muted-foreground block mb-1">文本内容</label>
        {upstreamTextNodeLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {upstreamTextNodeLabels.map((label, i) => (
              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
                [{label}]+
              </span>
            ))}
          </div>
        )}
        <textarea
          className="w-full h-20 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="输入提示词内容..."
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={flushTextDraft}
        />
      </div>
    </div>
  )
}
