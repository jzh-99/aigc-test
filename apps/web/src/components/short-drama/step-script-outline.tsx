'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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

const SUMMARY_HEADINGS = ['集数', '故事类型', '目标受众', '核心梗', '一句话故事', '人物小传', '故事梗概'] as const

type SummaryHeading = (typeof SUMMARY_HEADINGS)[number]

function useTypewriterText(targetText: string, active: boolean, speedMs = 12): string {
  const [displayText, setDisplayText] = useState('')

  useEffect(() => {
    if (!active) {
      setDisplayText('')
      return
    }
    if (!targetText) {
      setDisplayText('')
      return
    }
    if (displayText.length >= targetText.length) return

    const timer = window.setTimeout(() => {
      const step = targetText.length - displayText.length > 80 ? 4 : 2
      setDisplayText(targetText.slice(0, displayText.length + step))
    }, speedMs)

    return () => window.clearTimeout(timer)
  }, [active, displayText.length, speedMs, targetText])

  return displayText
}

function TypewriterStreamBlock({
  value,
  className,
}: {
  value: string
  className: string
}) {
  return (
    <div className={className}>
      {value}
      <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse rounded-sm bg-current" />
    </div>
  )
}

function parseScriptSummary(value: string): Partial<Record<SummaryHeading, string>> {
  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const sections: Partial<Record<SummaryHeading, string[]>> = {}
  let current: SummaryHeading | null = null

  for (const line of lines) {
    if ((SUMMARY_HEADINGS as readonly string[]).includes(line)) {
      current = line as SummaryHeading
      sections[current] = []
      continue
    }

    if (!current) continue
    sections[current]?.push(line)
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, sectionLines]) => [key, sectionLines.join('\n')])
  ) as Partial<Record<SummaryHeading, string>>
}

function parseCharacterBios(value: string): Array<{ name: string; body: string }> {
  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const bios: Array<{ name: string; body: string[] }> = []

  for (const line of lines) {
    const isCharacterName = !line.includes('：') && !line.includes(':')
    if (isCharacterName) {
      bios.push({ name: line, body: [] })
      continue
    }

    const current = bios[bios.length - 1]
    if (current) current.body.push(line)
  }

  return bios
    .filter(bio => bio.name && bio.body.length > 0)
    .map(bio => ({ name: bio.name, body: bio.body.join('\n') }))
}

function SummaryTextBlock({ title, children }: { title: string; children?: string }) {
  if (!children) return null

  return (
    <section className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/45 dark:shadow-none">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-foreground">
        {children}
      </div>
    </section>
  )
}

function ScriptSummaryView({ value }: { value: string }) {
  const sections = parseScriptSummary(value)
  const characterBios = sections.人物小传 ? parseCharacterBios(sections.人物小传) : []
  const hasStructuredContent = SUMMARY_HEADINGS.some(heading => sections[heading])

  if (!hasStructuredContent) {
    return (
      <div className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-6">
        {value}
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: '集数', value: sections.集数 },
          { label: '故事类型', value: sections.故事类型 },
          { label: '目标受众', value: sections.目标受众 },
        ].map(item => (
          <div key={item.label} className="rounded-xl bg-muted/45 px-4 py-3 dark:bg-slate-900/70">
            <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-base font-semibold leading-6 text-foreground">{item.value || '-'}</div>
          </div>
        ))}
      </div>

      <SummaryTextBlock title="核心梗">{sections.核心梗}</SummaryTextBlock>
      <SummaryTextBlock title="一句话故事">{sections.一句话故事}</SummaryTextBlock>

      {characterBios.length > 0 ? (
        <section className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/45 dark:shadow-none">
          <h4 className="text-xs font-medium text-muted-foreground">人物小传</h4>
          <div className="mt-3 space-y-3">
            {characterBios.map(bio => (
              <div key={bio.name} className="rounded-xl bg-muted/45 p-3 dark:bg-slate-900/70">
                <div className="text-sm font-semibold text-foreground">{bio.name}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                  {bio.body}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <SummaryTextBlock title="人物小传">{sections.人物小传}</SummaryTextBlock>
      )}

      <SummaryTextBlock title="故事梗概">{sections.故事梗概}</SummaryTextBlock>
    </div>
  )
}

export function StepScriptOutline({ projectId, state, onStateChange }: StepScriptOutlineProps) {
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [generatingOutlines, setGeneratingOutlines] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [summaryStreamText, setSummaryStreamText] = useState('')
  const [outlineStreamText, setOutlineStreamText] = useState('')
  const [outlineProgressMessage, setOutlineProgressMessage] = useState('')
  const [streamWarningMessage, setStreamWarningMessage] = useState('')
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState(state.script.refinedPrompt ?? '')
  const [savingSummary, setSavingSummary] = useState(false)
  const typedSummaryStreamText = useTypewriterText(summaryStreamText, generatingSummary)
  const typedOutlineStreamText = useTypewriterText(outlineStreamText, generatingOutlines)
  const isLocked = state.locks.script
  const isSummaryGenerating = generatingSummary || (state.script.status === 'generating' && !state.script.refinedPrompt)
  const isOutlinesGenerating =
    generatingOutlines ||
    (
      state.script.status === 'generating' &&
      Boolean(state.script.refinedPrompt) &&
      state.script.outlines.length < state.settings.episodeCount
    )

  const handleGenerateSummary = async () => {
    setGeneratingSummary(true)
    setSummaryStreamText('')
    setStreamWarningMessage('')
    try {
      await generateShortDramaScriptSummary(projectId, {
        onChunk: (text) => setSummaryStreamText((prev) => `${prev}${text}`),
        onProgress: (progress) => setSummaryStreamText((prev) => prev || progress.message),
      })
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
    setOutlineStreamText('')
    setOutlineProgressMessage('')
    setStreamWarningMessage('')
    try {
      const result = await generateShortDramaEpisodeOutlines(projectId, {
        onChunk: (text) => setOutlineStreamText((prev) => `${prev}${text}`),
        onProgress: (progress) => setOutlineProgressMessage(progress.message),
        onWarning: (warning) => {
          setStreamWarningMessage(warning.message)
          toast.warning(warning.message)
        },
      })
      onStateChange()
      if (result.partial) {
        toast.warning(result.warning ?? '大纲已部分生成，请补充 A豆后继续生成')
      } else {
        toast.success('大纲生成完成')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingOutlines(false)
    }
  }

  const handleEditSummary = () => {
    setSummaryDraft(state.script.refinedPrompt ?? '')
    setEditingSummary(true)
  }

  const handleSaveSummary = async () => {
    const nextSummary = summaryDraft.trim()
    if (!nextSummary) {
      toast.error('摘要不能为空')
      return
    }

    setSavingSummary(true)
    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          script: {
            ...state.script,
            refinedPrompt: nextSummary,
          },
        },
      })
      setEditingSummary(false)
      onStateChange()
      toast.success('摘要已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingSummary(false)
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
          <h3 className="font-medium">剧本摘要</h3>
          {!isLocked && (
            <div className="flex items-center gap-2">
              {state.script.refinedPrompt && !editingSummary && (
                <Button size="sm" variant="outline" onClick={handleEditSummary}>
                  编辑摘要
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleGenerateSummary} disabled={isSummaryGenerating || editingSummary}>
                {isSummaryGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                {isSummaryGenerating ? '摘要生成中' : state.script.refinedPrompt ? '摘要已生成' : '生成摘要'}
              </Button>
            </div>
          )}
        </div>
        {editingSummary ? (
          <div className="space-y-3 rounded-2xl border bg-white/80 p-4 shadow-sm">
            <textarea
              value={summaryDraft}
              onChange={event => setSummaryDraft(event.target.value)}
              className="min-h-[360px] w-full resize-y rounded-xl border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              placeholder="按结构编辑剧本摘要..."
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingSummary(false)}
                disabled={savingSummary}
              >
                取消
              </Button>
              <Button size="sm" onClick={handleSaveSummary} disabled={savingSummary}>
                {savingSummary && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                保存摘要
              </Button>
            </div>
          </div>
        ) : state.script.refinedPrompt ? (
          <ScriptSummaryView value={state.script.refinedPrompt} />
        ) : null}
        {generatingSummary && typedSummaryStreamText && (
          <TypewriterStreamBlock
            value={typedSummaryStreamText}
            className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-slate-700 whitespace-pre-wrap"
          />
        )}
        {!generatingSummary && isSummaryGenerating && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
            摘要生成中，页面会自动刷新状态...
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">分集剧本 ({state.script.outlines.length} 集)</h3>
          {!isLocked && state.script.refinedPrompt && (
            <Button size="sm" variant="outline" onClick={handleGenerateOutlines} disabled={isOutlinesGenerating}>
              {isOutlinesGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              {isOutlinesGenerating
                ? '大纲生成中'
                : state.script.outlines.length > 0 && state.script.outlines.length < state.settings.episodeCount
                ? '继续生成大纲'
                : '生成大纲'}
            </Button>
          )}
        </div>
        {streamWarningMessage && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="font-medium">生成已暂停</div>
            <p className="mt-1">{streamWarningMessage}</p>
            <p className="mt-1 text-xs">
              已生成 {state.script.outlines.length} / {state.settings.episodeCount} 集，可补充 A豆后继续生成剩余集数。
            </p>
          </div>
        )}

        {generatingOutlines && outlineProgressMessage && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
            {outlineProgressMessage}
          </div>
        )}
        {!generatingOutlines && isOutlinesGenerating && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
            大纲生成中，页面会自动刷新状态...
          </div>
        )}

        {generatingOutlines && typedOutlineStreamText && (
          <TypewriterStreamBlock
            value={typedOutlineStreamText}
            className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
          />
        )}
        {state.script.outlines.length > 0 && (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {state.script.outlines.map(outline => (
              <div key={outline.episodeNumber} className="p-3 rounded-lg border">
                <div className="font-medium text-sm">第 {outline.episodeNumber} 集：{outline.title}</div>
                <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  {outline.summary}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isLocked && state.script.outlines.length === state.settings.episodeCount && (
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
