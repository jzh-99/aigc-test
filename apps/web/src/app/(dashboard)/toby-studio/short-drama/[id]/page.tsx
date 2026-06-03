'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, Check, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { useShortDramaProject } from '@/hooks/short-drama/use-short-drama-project'
import { ShortDramaStepper } from '@/components/short-drama/short-drama-stepper'
import { StepScriptOutline } from '@/components/short-drama/step-script-outline'
import { StepAssets } from '@/components/short-drama/step-assets'
import { StepEpisodes } from '@/components/short-drama/step-episodes'
import { saveShortDramaProject } from '@/lib/short-drama/api'
import { Button } from '@/components/ui/button'
import { canEnterShortDramaStep, type ShortDramaStepId } from '@aigc/types'

export default function ShortDramaEditorPage() {
  const params = useParams()
  const projectId = params.id as string

  const { project, state, isLoading, error, mutate } = useShortDramaProject(projectId)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)

  useEffect(() => {
    setTitleDraft(project?.title ?? '')
  }, [project?.title])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !project || !state) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-muted-foreground">
        {error?.message ?? '项目加载失败'}
      </div>
    )
  }

  const handleStepClick = async (step: ShortDramaStepId) => {
    if (step === state.steps.active) return
    if (!canEnterShortDramaStep(state, step)) return
    await saveShortDramaProject(projectId, {
      state: { ...state, steps: { ...state.steps, active: step } },
    })
    mutate()
  }

  const handleStateChange = () => {
    mutate()
  }

  const handleSaveTitle = async () => {
    const nextTitle = titleDraft.trim()
    if (!nextTitle) {
      toast.error('剧名不能为空')
      return
    }
    if (nextTitle === project.title) {
      setEditingTitle(false)
      return
    }

    setSavingTitle(true)
    try {
      await saveShortDramaProject(projectId, { title: nextTitle })
      setEditingTitle(false)
      mutate()
      toast.success('剧名已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingTitle(false)
    }
  }

  const activeStep = canEnterShortDramaStep(state, state.steps.active)
    ? state.steps.active
    : canEnterShortDramaStep(state, 'assets')
      ? 'assets'
      : 'script'
  const displayState = activeStep === state.steps.active
    ? state
    : { ...state, steps: { ...state.steps, active: activeStep } }

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      <div className="sticky top-[-1rem] z-20 flex h-16 items-center border-b bg-card/95 px-5 backdrop-blur md:top-[-1.5rem] md:px-8">
        <Link href="/toby-studio/short-drama" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回 AI短剧
        </Link>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="border-b border-border/70 pb-5">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground">AI SHORT DRAMA</p>
          <div className="mt-2 flex items-center gap-2">
            {editingTitle ? (
              <>
                <input
                  value={titleDraft}
                  onChange={event => setTitleDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') handleSaveTitle()
                    if (event.key === 'Escape') {
                      setTitleDraft(project.title)
                      setEditingTitle(false)
                    }
                  }}
                  className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-xl font-bold text-foreground outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                  autoFocus
                />
                <Button size="icon" onClick={handleSaveTitle} disabled={savingTitle} aria-label="保存剧名">
                  {savingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    setTitleDraft(project.title)
                    setEditingTitle(false)
                  }}
                  disabled={savingTitle}
                  aria-label="取消编辑剧名"
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-foreground">{project.title}</h1>
                <Button size="icon" variant="ghost" onClick={() => setEditingTitle(true)} aria-label="编辑剧名">
                  <Pencil className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        <ShortDramaStepper state={displayState} onStepClick={handleStepClick} />

        <div className="mt-6">
          {activeStep === 'script' && (
            <StepScriptOutline projectId={projectId} state={state} onStateChange={handleStateChange} />
          )}
          {activeStep === 'assets' && (
            <StepAssets projectId={projectId} state={state} onStateChange={handleStateChange} />
          )}
          {activeStep === 'episodes' && (
            <StepEpisodes projectId={projectId} state={state} onStateChange={handleStateChange} />
          )}
        </div>
      </div>
    </div>
  )
}
