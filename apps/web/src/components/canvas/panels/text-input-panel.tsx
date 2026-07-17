'use client'

import { useState, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { CanvasApiError, executeTextGenNode } from '@/lib/canvas/canvas-api'
import { ExecuteButton } from './panel-shared'

interface TextInputPanelProps {
  setTextDraft: (value: string) => void
  commitTextDraft: (value: string) => void
  onGeneratingChange: (generating: boolean) => void
  onProgressChange: (progress: number) => void
}

export function TextInputPanel({
  setTextDraft,
  commitTextDraft,
  onGeneratingChange,
  onProgressChange,
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
    onGeneratingChange(true)
    onProgressChange(10)
    streamingRef.current = ''
    // 清空当前文本，准备流式填入
    setTextDraft('')

    try {
      const generatedText = await executeTextGenNode(
        { prompt: aiPrompt },
        (delta) => {
          streamingRef.current += delta
          // flushSync 强制每个 chunk 同步渲染，实现打字机逐字输出效果
          flushSync(() => {
            setTextDraft(streamingRef.current)
            onProgressChange(60)
          })
        },
        token ?? undefined,
      )
      const finalText = generatedText || streamingRef.current
      setTextDraft(finalText)
      commitTextDraft(finalText)
      onProgressChange(100)
      toast.success('生成完成')
    } catch (err) {
      const message = err instanceof CanvasApiError ? err.message : '生成失败'
      toast.error(message)
      if (streamingRef.current) commitTextDraft(streamingRef.current)
    } finally {
      setGenerating(false)
      onGeneratingChange(false)
    }
  }, [aiPrompt, token, setTextDraft, commitTextDraft, onGeneratingChange, onProgressChange])

  return (
    <div className="p-4 space-y-3">
      {/* AI 生成提示词 — 大文本框 */}
      <textarea
        className="w-full min-h-[180px] max-h-[400px] p-3 text-sm leading-relaxed bg-muted/40 border border-border/60 rounded-xl resize-none focus:outline-none focus:border-primary/40 transition-colors placeholder:text-muted-foreground/70"
        placeholder="描述你想生成的文本内容…"
        value={aiPrompt}
        onChange={(e) => setAiPrompt(e.target.value)}
      />

      {/* 底部工具栏 */}
      <div className="flex items-center justify-end">
        <ExecuteButton
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          }
          credits={0}
          executing={generating}
          disabled={!aiPrompt.trim()}
          onClick={handleGenerate}
        />
      </div>
    </div>
  )
}
