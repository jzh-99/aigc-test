'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PictureBookStepper } from '@/components/picture-book/picture-book-stepper'
import { StepAssets } from '@/components/picture-book/step-assets'
import { StepPreview } from '@/components/picture-book/step-preview'
import { StepScriptOutline } from '@/components/picture-book/step-script-outline'
import { StepStoryboard } from '@/components/picture-book/step-storyboard'
import { usePictureBookProject } from '@/hooks/picture-book/use-picture-book-project'
import { generatePictureBookAssetPrompts, generatePictureBookAssets, generatePictureBookStoryboardAudio, generatePictureBookStoryboardImages, generatePictureBookStoryboardPrompts } from '@/lib/picture-book/api'
import type { PictureBookStepId } from '@/lib/picture-book/types'
import { useState } from 'react'

export default function PictureBookEditorPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const project = usePictureBookProject(projectId)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const state = project.state

  const setActiveStep = (step: PictureBookStepId) => {
    if (!state) return
    project.updateState({ ...state, steps: { ...state.steps, active: step } })
  }

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setLoadingAction(key)
    try {
      await action()
      await project.mutate()
      await project.syncBatches()
      toast.success('操作已提交')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setLoadingAction(null)
    }
  }

  if (project.isLoading || !state) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      <header className="sticky top-[-1rem] z-20 border-b bg-card/95 backdrop-blur md:top-[-1.5rem]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link href="/toby-studio/picture-book" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回 AI绘本
          </Link>
          <div className="text-sm text-muted-foreground">
            {project.saving ? '草稿保存中' : state.draft.dirty ? '有未保存草稿' : '草稿已保存'}
          </div>
        </div>
        <PictureBookStepper active={state.steps.active} completed={state.steps.completed} onChange={setActiveStep} />
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">{project.project?.title ?? '未命名绘本'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{project.project?.style} · {project.project?.pageCount ?? project.project?.page_count} 页 · qwen3.6-plus / seedream-5.0-lite / speech-2.8-hd</p>
          </div>
          <Button variant="outline" onClick={() => void project.syncBatches()}>同步生成结果</Button>
        </div>

        {state.steps.active === 'script' && <StepScriptOutline state={state} onChange={project.updateState} />}
        {state.steps.active === 'assets' && (
          <StepAssets
            state={state}
            onChange={project.updateState}
            loading={Boolean(loadingAction)}
            onGeneratePrompts={() => runAction('assets-prompts', () => generatePictureBookAssetPrompts(projectId))}
            onGenerateImages={() => runAction('assets-images', () => generatePictureBookAssets(projectId))}
          />
        )}
        {state.steps.active === 'storyboard' && (
          <StepStoryboard
            state={state}
            onChange={project.updateState}
            loading={Boolean(loadingAction)}
            onGeneratePrompts={() => runAction('storyboard-prompts', () => generatePictureBookStoryboardPrompts(projectId))}
            onGenerateImages={() => runAction('storyboard-images', () => generatePictureBookStoryboardImages(projectId))}
            onGenerateAudio={() => runAction('storyboard-audio', () => generatePictureBookStoryboardAudio(projectId, {}))}
          />
        )}
        {state.steps.active === 'preview' && <StepPreview state={state} />}
      </main>
    </div>
  )
}
