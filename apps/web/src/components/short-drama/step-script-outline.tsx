'use client'

import { useState } from 'react'
import { Loader2, Sparkles, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ShortDramaState } from '@aigc/types'
import {
  generateShortDramaScriptSummary,
  generateShortDramaEpisodeOutlines,
  saveShortDramaProject,
} from '@/lib/short-drama/api'

interface StepScriptOutlineProps {
  projectId: string
  state: ShortDramaState
  onStateChange: () => void
}

export function StepScriptOutline({ projectId, state, onStateChange }: StepScriptOutlineProps) {
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [generatingOutlines, setGeneratingOutlines] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isLocked = state.locks.script

  const handleGenerateSummary = async () => {
    setGeneratingSummary(true)
    try {
      await generateShortDramaScriptSummary(projectId)
      onStateChange()
      toast.success('摘要生成完成')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingSummary(false)
    }
  }

  const handleGenerateOutlines = async () => {
    setGeneratingOutlines(true)
    try {
      await generateShortDramaEpisodeOutlines(projectId)
      onStateChange()
      toast.success('大纲生成完成')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingOutlines(false)
    }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          locks: { ...state.locks, script: true },
          steps: { active: 'assets', completed: [...state.steps.completed, 'script'] },
        },
      })
      onStateChange()
      toast.success('剧本已确认')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '确认失败')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-medium">原始创意</h3>
        <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
          {state.script.originalPrompt || '（无）'}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">AI 摘要</h3>
          {!isLocked && (
            <Button size="sm" variant="outline" onClick={handleGenerateSummary} disabled={generatingSummary}>
              {generatingSummary ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              {state.script.refinedPrompt ? '重新生成' : '生成摘要'}
            </Button>
          )}
        </div>
        {state.script.refinedPrompt && (
          <p className="text-sm bg-muted/50 p-3 rounded-lg">{state.script.refinedPrompt}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">分集大纲 ({state.script.outlines.length} 集)</h3>
          {!isLocked && state.script.refinedPrompt && (
            <Button size="sm" variant="outline" onClick={handleGenerateOutlines} disabled={generatingOutlines}>
              {generatingOutlines ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              {state.script.outlines.length > 0 ? '重新生成' : '生成大纲'}
            </Button>
          )}
        </div>
        {state.script.outlines.length > 0 && (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {state.script.outlines.map(outline => (
              <div key={outline.episodeNumber} className="p-3 rounded-lg border">
                <div className="font-medium text-sm">第 {outline.episodeNumber} 集：{outline.title}</div>
                <p className="text-xs text-muted-foreground mt-1">{outline.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isLocked && state.script.outlines.length > 0 && (
        <Button onClick={handleConfirm} disabled={confirming} className="w-full">
          {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          确认剧本，进入素材
        </Button>
      )}

      {isLocked && (
        <div className="text-center text-sm text-muted-foreground py-4">
          剧本已锁定确认
        </div>
      )}
    </div>
  )
}
