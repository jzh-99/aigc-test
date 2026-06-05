'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpenCheck, CheckCircle2, Loader2, Sparkles, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PictureBookStepper } from '@/components/picture-book/picture-book-stepper'
import { StepAssets } from '@/components/picture-book/step-assets'
import { StepPreview } from '@/components/picture-book/step-preview'
import { StepScriptOutline } from '@/components/picture-book/step-script-outline'
import { StepStoryboard } from '@/components/picture-book/step-storyboard'
import { usePictureBookProject } from '@/hooks/picture-book/use-picture-book-project'
import { generatePictureBookAssetPrompts, generatePictureBookAssets, generatePictureBookStoryboardAudio, generatePictureBookStoryboardImages, generatePictureBookStoryboardPrompts } from '@/lib/picture-book/api'
import type { PictureBookStepId } from '@/lib/picture-book/types'

function chineseOnlyText(value: string | undefined): string {
  const text = value ?? ''
  if (!/[\u4e00-\u9fff]/.test(text)) return ''
  return text
    .split('\n')
    .filter(line => /[\u4e00-\u9fff]/.test(line))
    .join('\n')
}

function isPendingGenerationStatus(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'processing'
}

const STORYBOARD_PROMPTS_FAILED_ERROR = 'storyboard_prompts_failed'

function FloatingStepAction({
  icon,
  description,
  label,
  disabled,
  loading,
  onClick,
}: {
  icon: ReactNode
  description: string
  label: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <div className="fixed bottom-6 left-1/2 z-30 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 px-0 md:bottom-8">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card/95 p-3 text-card-foreground shadow-lg shadow-black/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:rounded-full sm:pl-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {icon}
          </span>
          <span className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">
            {description}
          </span>
        </div>
        <Button
          type="button"
          onClick={onClick}
          disabled={disabled || loading}
          className="h-10 shrink-0 rounded-full px-5 font-semibold"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {label}
          {!loading ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
        </Button>
      </div>
    </div>
  )
}

export default function PictureBookEditorPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const project = usePictureBookProject(projectId)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [confirmAssetsDialogOpen, setConfirmAssetsDialogOpen] = useState(false)
  const [confirmingScript, setConfirmingScript] = useState(false)
  const [confirmingAssets, setConfirmingAssets] = useState(false)
  const [confirmStreamText, setConfirmStreamText] = useState('')
  const [generatingAssetIds, setGeneratingAssetIds] = useState<string[]>([])
  const [generatingStoryboardImageIds, setGeneratingStoryboardImageIds] = useState<string[]>([])
  const [generatingStoryboardAudioIds, setGeneratingStoryboardAudioIds] = useState<string[]>([])
  const state = project.state

  useEffect(() => {
    if (!state || generatingAssetIds.length === 0) return
    const doneIds = new Set(
      state.assets.characters
        .concat(state.assets.backgrounds)
        .filter(item => item.status === 'completed' || item.status === 'failed')
        .map(item => item.id),
    )
    const nextIds = generatingAssetIds.filter(id => !doneIds.has(id))
    if (nextIds.length !== generatingAssetIds.length) setGeneratingAssetIds(nextIds)
  }, [generatingAssetIds, state])

  useEffect(() => {
    if (!state || generatingStoryboardImageIds.length === 0) return
    const doneIds = state.storyboard
      .filter(page => Boolean(page.imageUrl) || page.status === 'completed' || page.status === 'failed')
      .map(page => `page_${page.page}`)
    const doneSet = new Set(doneIds)
    const nextIds = generatingStoryboardImageIds.filter(id => !doneSet.has(id))
    if (nextIds.length !== generatingStoryboardImageIds.length) setGeneratingStoryboardImageIds(nextIds)
  }, [generatingStoryboardImageIds, state])

  useEffect(() => {
    if (!state || generatingStoryboardAudioIds.length === 0) return
    const doneIds = state.storyboard
      .filter(page => page.voice.zh && page.voice.en)
      .map(page => `page_${page.page}`)
    const doneSet = new Set(doneIds)
    const nextIds = generatingStoryboardAudioIds.filter(id => !doneSet.has(id))
    if (nextIds.length !== generatingStoryboardAudioIds.length) setGeneratingStoryboardAudioIds(nextIds)
  }, [generatingStoryboardAudioIds, state])

  const setActiveStep = (step: PictureBookStepId) => {
    if (!state) return
    if (step !== 'script' && !state.locks?.script) {
      toast.error('请先确认故事和分页内容')
      return
    }
    if ((step === 'storyboard' || step === 'preview') && !state.locks?.assets) {
      toast.error('请先确认角色 / 背景')
      return
    }
    project.updateState({ ...state, steps: { ...state.steps, active: step } })
  }

  const confirmScript = async () => {
    if (!state || confirmingScript) return
    setConfirmingScript(true)
    setConfirmStreamText('')
      const nextState = {
        ...state,
        locks: { ...state.locks, script: true },
      script: {
        ...state.script,
        pages: state.script.pages.map(page => ({
          ...page,
          visualPrompt: chineseOnlyText(page.visualPrompt),
        })),
      },
      steps: {
        active: 'assets' as const,
        completed: Array.from(new Set([...state.steps.completed, 'script' as const])),
      },
    }
    try {
      project.updateState(nextState)
      await project.flushDraft(nextState)
      const result = await generatePictureBookAssetPrompts(projectId)
      // SSE 返回的 state 已经包含更新，直接刷新
      await project.mutate()
      setConfirmDialogOpen(false)
      toast.success('故事和分页内容已确认，角色/背景提示词已生成', {
        duration: 5000,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '确认失败'
      toast.error(errorMessage, {
        duration: 5000,
        action: {
          label: '重试',
          onClick: () => {
            void confirmScript()
          },
        },
      })
    } finally {
      setConfirmingScript(false)
    }
  }

  const allAssets = state ? state.assets.characters.concat(state.assets.backgrounds) : []
  const allAssetsGenerated = allAssets.length > 0 && allAssets.every(item =>
    item.imageUrl && !generatingAssetIds.includes(item.id) && item.status !== 'pending' && item.status !== 'processing',
  )
  const storyboardReady = state ? state.storyboard.length > 0
    && state.storyboard.every(p => p.imageUrl && p.voice.zh && p.voice.en)
    && generatingStoryboardImageIds.length === 0
    && generatingStoryboardAudioIds.length === 0
    : false
  const showStoryboardPromptRegenerateCard = state?.draft.lastError === STORYBOARD_PROMPTS_FAILED_ERROR

  const generateAssetImages = async (target?: { kind: 'character' | 'background'; refId: string }) => {
    if (!state) return
    const pendingItems = target
      ? allAssets.filter(item => item.id === target.refId)
      : allAssets.filter(item => !item.imageUrl)
    if (!pendingItems.length) {
      toast.info('角色 / 背景图片已全部生成')
      return
    }
    const pendingSet = new Set(pendingItems.map(item => item.id))
    setGeneratingAssetIds(prev => [...new Set([...prev, ...pendingSet])])

    const markPending = (item: typeof allAssets[0]) =>
      pendingSet.has(item.id) ? { ...item, status: 'pending' as const } : item

    const nextState = {
      ...state,
      assets: {
        characters: state.assets.characters.map(markPending),
        backgrounds: state.assets.backgrounds.map(markPending),
      },
    }
    project.updateState(nextState)
    await runAction('assets-images', async () => {
      const targets = target ? [{ kind: target.kind, ref_id: target.refId }] : undefined
      const result = await generatePictureBookAssets(projectId, targets)
      if (result.failures.length > 0) {
        toast.warning(`已提交 ${result.batches.length} 个任务，${result.failures.length} 个任务失败`)
      }
      return result
    })
  }

  const generateOneStoryboardImage = async (refId: string) => {
    if (!state) return
    setGeneratingStoryboardImageIds(prev => [...new Set([...prev, refId])])
    project.updateState({
      ...state,
      storyboard: state.storyboard.map(page => `page_${page.page}` === refId
        ? { ...page, status: 'pending' as const, imageUrl: null }
        : page),
    })
    await runAction('storyboard-images', async () => {
      const result = await generatePictureBookStoryboardImages(projectId, [{ kind: 'page_image', ref_id: refId }])
      if (result.failures.length > 0) {
        toast.warning(`图片生成失败：${(result.failures[0] as any)?.message ?? '未知错误'}`)
      }
      return result
    })
  }

  const generateOneStoryboardAudio = async (refId: string, voiceZhId: string, voiceEnId: string) => {
    if (!state) return
    setGeneratingStoryboardAudioIds(prev => [...new Set([...prev, refId])])
    await runAction('storyboard-audio', async () => {
      const result = await generatePictureBookStoryboardAudio(projectId, { targets: [{ kind: 'page_audio_zh', ref_id: refId }, { kind: 'page_audio_en', ref_id: refId }], voice_zh_id: voiceZhId, voice_en_id: voiceEnId })
      if (result.failures.length > 0) {
        toast.warning(`语音生成失败：${(result.failures[0] as any)?.message ?? '未知错误'}`)
      }
      return result
    })
  }

  const confirmAssets = async () => {
    if (!state || confirmingAssets) return
    if (!allAssetsGenerated) {
      toast.error('请先生成所有角色 / 背景图片')
      return
    }
    setConfirmingAssets(true)
    const nextState = {
      ...state,
      locks: { ...state.locks, assets: true },
      steps: {
        active: 'storyboard' as const,
        completed: Array.from(new Set([...state.steps.completed, 'script' as const, 'assets' as const])),
      },
    }
    try {
      project.updateState(nextState)
      await project.flushDraft(nextState)
      const result = await generatePictureBookStoryboardPrompts(projectId)
      // SSE 返回的 state 已经包含更新，直接刷新
      await project.mutate()
      setConfirmAssetsDialogOpen(false)
      toast.success('角色/背景已确认，绘本分镜提示词已生成', {
        duration: 5000,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '确认失败'
      project.updateState({
        ...nextState,
        draft: { ...nextState.draft, lastError: STORYBOARD_PROMPTS_FAILED_ERROR },
      })
      toast.error(errorMessage, {
        duration: 5000,
        action: {
          label: '重试',
          onClick: () => {
            void confirmAssets()
          },
        },
      })
    } finally {
      setConfirmingAssets(false)
    }
  }

  const goToPreview = () => {
    if (!state) return
    if (!state.storyboard.length) {
      toast.error('请先生成绘本分镜')
      return
    }
    project.updateState({
      ...state,
      steps: {
        active: 'preview',
        completed: Array.from(new Set([...state.steps.completed, 'script' as const, 'assets' as const, 'storyboard' as const])),
      },
    })
  }

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setLoadingAction(key)
    try {
      await action()
      await project.syncBatches({ refreshCharges: true })
      toast.success('操作已提交，正在后台处理中')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '操作失败'
      toast.error(errorMessage, {
        duration: 5000,
        action: {
          label: '重试',
          onClick: () => {
            void runAction(key, action)
          },
        },
      })
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
        <PictureBookStepper
          active={state.steps.active}
          completed={state.steps.completed.filter(step => (step === 'script' ? state.locks?.script : step === 'assets' ? state.locks?.assets : true))}
          onChange={setActiveStep}
        />
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-32 md:px-6">
        {(() => {
          const allItems = state.assets.characters.concat(state.assets.backgrounds)
          const pendingAssets = allItems.filter(item => isPendingGenerationStatus(item.status))
          const pendingStoryboardImages = state.storyboard.filter(page => isPendingGenerationStatus(page.status))
          const pendingStoryboardAudio = state.storyboard.filter(page => !page.voice.zh || !page.voice.en)
          const hasPending = pendingAssets.length > 0 || pendingStoryboardImages.length > 0 || generatingStoryboardAudioIds.length > 0

          if (!hasPending) return null

          return (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
              <div className="flex items-start gap-3">
                <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">后台任务处理中</p>
                  <div className="space-y-0.5 text-xs text-blue-700 dark:text-blue-300">
                    {pendingAssets.length > 0 && <p>• 角色/背景图片生成中：{pendingAssets.length} 个</p>}
                    {pendingStoryboardImages.length > 0 && <p>• 分镜图片生成中：{pendingStoryboardImages.length} 页</p>}
                    {generatingStoryboardAudioIds.length > 0 && <p>• 语音生成中：{generatingStoryboardAudioIds.length} 页</p>}
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400">页面会自动刷新最新状态，请稍候...</p>
                </div>
              </div>
            </div>
          )
        })()}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">{project.project?.title ?? '未命名绘本'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{project.project?.style} · {project.project?.pageCount ?? project.project?.page_count} 页 · 按项目计费</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => void project.syncBatches()}>同步生成结果</Button>
            </div>
            <span className="text-xs text-muted-foreground">生成结果会自动同步，按钮用于立即刷新</span>
          </div>
        </div>

        {state.steps.active === 'script' && <StepScriptOutline state={state} onChange={project.updateState} locked={Boolean(state.locks?.script)} />}
        {state.steps.active === 'assets' && (
          <>
            {/* 资产为空时的兜底方案 */}
            {state.assets.characters.length === 0 && state.assets.backgrounds.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                      <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-amber-900 dark:text-amber-100">角色/背景提示词为空</h3>
                      <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                        看起来上一步生成角色/背景提示词失败了，或者数据未正确保存。您可以重新生成提示词，或者手动添加角色/背景。
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={async () => {
                        if (!state) return
                        setLoadingAction('regenerate-asset-prompts')
                        try {
                          const result = await generatePictureBookAssetPrompts(projectId)
                          await project.mutate()
                          toast.success('角色/背景提示词已重新生成', {
                            duration: 5000,
                          })
                        } catch (error) {
                          const errorMessage = error instanceof Error ? error.message : '重新生成失败'
                          toast.error(errorMessage, {
                            duration: 5000,
                          })
                        } finally {
                          setLoadingAction(null)
                        }
                      }}
                      disabled={loadingAction === 'regenerate-asset-prompts'}
                      className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
                    >
                      {loadingAction === 'regenerate-asset-prompts' ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <WandSparkles className="mr-2 h-4 w-4" />
                      )}
                      重新生成提示词
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!state) return
                        // 手动添加一个空的角色和背景
                        const nextState = {
                          ...state,
                          assets: {
                            characters: [{ id: 'character_1', name: '角色 1', prompt: '', imageUrl: null }],
                            backgrounds: [{ id: 'background_1', name: '背景 1', prompt: '', imageUrl: null }],
                          },
                        }
                        project.updateState(nextState)
                        toast.info('已添加空白模板，请编辑名称和提示词')
                      }}
                    >
                      手动添加
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <StepAssets
              state={state}
              onChange={project.updateState}
              loading={Boolean(loadingAction) || confirmingAssets}
              locked={Boolean(state.locks?.assets)}
              generatingIds={generatingAssetIds}
              imageGenerating={loadingAction === 'assets-images'}
              onGenerateImages={() => void generateAssetImages()}
              onGenerateOne={(kind, refId) => void generateAssetImages({ kind, refId })}
            />
          </>
        )}
        {state.steps.active === 'storyboard' && (
          <>
            {/* 分镜提示词生成失败时的兜底方案 */}
            {showStoryboardPromptRegenerateCard ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                      <BookOpenCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-amber-900 dark:text-amber-100">分镜提示词生成失败</h3>
                      <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                        上一步生成分镜提示词失败。您可以重新生成分镜提示词。
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={async () => {
                      if (!state) return
                      setLoadingAction('regenerate-storyboard-prompts')
                      try {
                        const result = await generatePictureBookStoryboardPrompts(projectId)
                        project.updateState({
                          ...result.state,
                          draft: { ...result.state.draft, lastError: undefined },
                        })
                        await project.mutate()
                        toast.success('分镜提示词已重新生成', {
                          duration: 5000,
                        })
                      } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : '重新生成失败'
                        toast.error(errorMessage, {
                          duration: 5000,
                        })
                      } finally {
                        setLoadingAction(null)
                      }
                    }}
                    disabled={loadingAction === 'regenerate-storyboard-prompts'}
                    className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
                  >
                    {loadingAction === 'regenerate-storyboard-prompts' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <WandSparkles className="mr-2 h-4 w-4" />
                    )}
                    重新生成分镜提示词
                  </Button>
                </div>
              </div>
            ) : null}

            <StepStoryboard
              state={state}
              onChange={project.updateState}
              loading={Boolean(loadingAction)}
              generatingImageIds={generatingStoryboardImageIds}
              generatingAudioIds={generatingStoryboardAudioIds}
              onGenerateImages={() => {
                const pendingIds = state.storyboard.filter(p => !p.imageUrl).map(p => `page_${p.page}`)
                setGeneratingStoryboardImageIds(prev => [...new Set([...prev, ...pendingIds])])
                void runAction('storyboard-images', () => generatePictureBookStoryboardImages(projectId))
              }}
              onGenerateAudio={(voiceZhId, voiceEnId) => {
                const pendingIds = state.storyboard.filter(p => !p.voice.zh || !p.voice.en).map(p => `page_${p.page}`)
                setGeneratingStoryboardAudioIds(prev => [...new Set([...prev, ...pendingIds])])
                void runAction('storyboard-audio', () => generatePictureBookStoryboardAudio(projectId, { voice_zh_id: voiceZhId, voice_en_id: voiceEnId }))
            }}
            onGenerateOneImage={(refId) => void generateOneStoryboardImage(refId)}
            onGenerateOneAudio={(refId, voiceZhId, voiceEnId) => void generateOneStoryboardAudio(refId, voiceZhId, voiceEnId)}
          />
          </>
        )}
        {state.steps.active === 'preview' && <StepPreview state={state} />}
      </main>

      {state.steps.active === 'script' ? (
        <FloatingStepAction
          icon={<BookOpenCheck className="h-4 w-4" />}
          description={state.locks?.script ? '故事和分页内容已确认，可继续查看角色和背景设定。' : '确认后将锁定故事和分页内容，并生成角色 / 背景提示词。'}
          label={state.locks?.script ? '查看资产库' : '确认并下一步'}
          loading={confirmingScript}
          onClick={() => {
            if (state.locks?.script) {
              setActiveStep('assets')
              return
            }
            setConfirmDialogOpen(true)
          }}
        />
      ) : null}

      {state.steps.active === 'assets' ? (
        <FloatingStepAction
          icon={<CheckCircle2 className="h-4 w-4" />}
          description={state.locks?.assets ? '角色和背景设定已应用到整本绘本中，可继续编辑分镜。' : '角色和背景设定会应用到整本绘本中，建议图片生成完成后再继续。'}
          label={state.locks?.assets ? '查看分镜' : '确认并下一步'}
          disabled={!state.locks?.assets && (!allAssetsGenerated || confirmingAssets)}
          loading={confirmingAssets}
          onClick={() => {
            if (state.locks?.assets) {
              setActiveStep('storyboard')
              return
            }
            if (!allAssetsGenerated) {
              toast.error('请先生成所有角色 / 背景图片')
              return
            }
            setConfirmAssetsDialogOpen(true)
          }}
        />
      ) : null}

      {state.steps.active === 'storyboard' ? (
        <FloatingStepAction
          icon={<WandSparkles className="h-4 w-4" />}
          description="分镜图片和双语语音确认后，可进入预览导出检查整本绘本。"
          label="下一步"
          disabled={!storyboardReady}
          onClick={goToPreview}
        />
      ) : null}

      <Dialog open={confirmDialogOpen} onOpenChange={(open) => {
        if (!confirmingScript) setConfirmDialogOpen(open)
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>确认故事和分页内容</DialogTitle>
            <DialogDescription>
              确认后，完整故事、环境描述和分页旁白将被锁定，不能再修改。系统会立即生成下一步“角色 / 背景”的提示词，成功后自动进入绘本资产库。
            </DialogDescription>
          </DialogHeader>

          {confirmingScript ? (
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                正在生成角色 / 背景提示词...
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {confirmStreamText || '等待 AI 返回内容'}
              </pre>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)} disabled={confirmingScript}>
              取消
            </Button>
            <Button onClick={() => void confirmScript()} disabled={confirmingScript}>
              {confirmingScript ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认并生成提示词
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAssetsDialogOpen} onOpenChange={(open) => {
        if (!confirmingAssets) setConfirmAssetsDialogOpen(open)
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>确认角色 / 背景</DialogTitle>
            <DialogDescription>
              确认后，角色和背景的名称、提示词、图片将被锁定，不能再修改。系统会立即生成下一步“绘本分镜”的提示词，成功后自动进入绘本分镜。
            </DialogDescription>
          </DialogHeader>

          {!allAssetsGenerated ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              当前还有角色 / 背景图片未生成完成，请等待自动同步或点击“同步生成结果”刷新后再确认。
            </div>
          ) : null}

          {confirmingAssets ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-4 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              正在生成绘本分镜提示词...
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAssetsDialogOpen(false)} disabled={confirmingAssets}>
              取消
            </Button>
            <Button onClick={() => void confirmAssets()} disabled={confirmingAssets || !allAssetsGenerated}>
              {confirmingAssets ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认并生成分镜提示词
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
