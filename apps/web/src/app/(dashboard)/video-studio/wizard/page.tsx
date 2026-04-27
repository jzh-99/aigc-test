'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { WizardLayout } from '@/components/video-studio/wizard-layout'
import { StepDescribe } from '@/components/video-studio/step-describe'
import { StepScript } from '@/components/video-studio/step-script'
import { StepStoryboard } from '@/components/video-studio/step-storyboard'
import { StepCharacters } from '@/components/video-studio/step-characters'
import { StepVideo } from '@/components/video-studio/step-video'
import { useWizardState } from '@/hooks/video-studio/use-wizard-state'
import { useAuthStore } from '@/stores/auth-store'
import { fetchWithAuth } from '@/lib/api-client'
import { toast } from 'sonner'
import type { WizardState } from '@/hooks/video-studio/use-wizard-state'
import type { AppNode, AppEdge, CanvasNodeType } from '@/lib/canvas/types'

function makeNode(id: string, type: CanvasNodeType, position: { x: number; y: number }, config: Record<string, unknown>): AppNode {
  return {
    id,
    type,
    position,
    data: { type, config, label: '' } as unknown as AppNode['data'],
  }
}

function makeEdge(id: string, source: string, target: string, sourceHandle?: string, targetHandle?: string): AppEdge {
  return { id, source, target, sourceHandle, targetHandle } as AppEdge
}

function WizardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectName = searchParams.get('name') ?? '未命名项目'
  const projectType = (searchParams.get('type') ?? 'single') as 'single' | 'series'
  const episodeCount = Number(searchParams.get('episodes') ?? '1')
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)

  const [projectId] = useState(() => {
    const existing = searchParams.get('id')
    if (existing) return existing
    return crypto.randomUUID()
  })

  useEffect(() => {
    if (!searchParams.get('id')) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('id', projectId)
      router.replace(`/video-studio/wizard?${params.toString()}`)
    }
  }, [projectId, searchParams, router])

  const [serverState, setServerState] = useState<WizardState | null>(null)
  const [serverLoaded, setServerLoaded] = useState(false)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (workspaceId === null || workspaceId === undefined) return
    if (fetchedRef.current) return
    fetchedRef.current = true

    if (!workspaceId) {
      setServerLoaded(true)
      return
    }

    fetchWithAuth<{ wizard_state?: WizardState }>(`/video-studio/projects/${projectId}`)
      .then((project) => {
        if (project?.wizard_state) setServerState(project.wizard_state)
      })
      .catch(() => {})
      .finally(() => setServerLoaded(true))
  }, [workspaceId, projectId])

  const storageKey = `video-studio:${projectId}`
  const wizard = useWizardState(storageKey, projectId, projectName, serverState)

  const handleVideoComplete = async (opts?: { exportToCanvas?: boolean }) => {
    wizard.completeStep('video')
    if (!opts?.exportToCanvas) {
      router.push('/video-studio')
      return
    }
    if (!workspaceId) { router.push('/video-studio'); return }
    try {
      toast.loading('正在创建画布…', { id: 'canvas-export' })
      const canvas = await fetchWithAuth<{ id: string }>('/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${projectName} 工作流`, workspace_id: workspaceId }),
      })

      const nodes: AppNode[] = []
      const edges: AppEdge[] = []
      const COL = 320
      const ROW = 220

      // Column 0: description text
      const descNodeId = 'n-desc'
      nodes.push(makeNode(descNodeId, 'text_input', { x: 0, y: 0 }, {
        text: wizard.describeData?.description ?? '',
      }))

      // Column 1: script writer
      const scriptNodeId = 'n-script'
      nodes.push(makeNode(scriptNodeId, 'script_writer', { x: COL, y: 0 }, {
        style: wizard.describeData?.style ?? '',
        duration: wizard.describeData?.duration ?? 60,
        result: wizard.scriptData?.script ?? '',
      }))
      edges.push(makeEdge('e-desc-script', descNodeId, scriptNodeId))

      // Column 2: storyboard splitter
      const sbNodeId = 'n-storyboard'
      nodes.push(makeNode(sbNodeId, 'storyboard_splitter', { x: COL * 2, y: 0 }, {
        shotCount: wizard.shots.length,
      }))
      edges.push(makeEdge('e-script-sb', scriptNodeId, sbNodeId))

      // Columns 3-5: per-shot nodes
      wizard.shots.forEach((shot, i) => {
        const y = i * ROW
        const refUrl = wizard.shotImages[shot.id]
          ?? (shot.characters?.[0] ? wizard.characterImages[shot.characters[0]] : undefined)
          ?? (shot.scene ? wizard.sceneImages[shot.scene] : undefined)
          ?? ''

        const refNodeId = `n-ref-${shot.id}`
        nodes.push(makeNode(refNodeId, 'asset', { x: COL * 3, y }, {
          url: refUrl, mimeType: 'image/jpeg',
        }))
        edges.push(makeEdge(`e-sb-ref-${i}`, sbNodeId, refNodeId))

        const vidGenNodeId = `n-vidgen-${shot.id}`
        nodes.push(makeNode(vidGenNodeId, 'video_gen', { x: COL * 4, y }, {
          prompt: shot.content,
          model: 'seedance-2.0',
          mode: 'multiref',
          duration: shot.duration,
        }))
        edges.push(makeEdge(`e-ref-vidgen-${i}`, refNodeId, vidGenNodeId))

        const outNodeId = `n-out-${shot.id}`
        const videoUrl = wizard.shotVideos[shot.id] ?? ''
        nodes.push(makeNode(outNodeId, 'asset', { x: COL * 5, y }, {
          url: videoUrl, mimeType: 'video/mp4',
        }))
        edges.push(makeEdge(`e-vidgen-out-${i}`, vidGenNodeId, outNodeId))
      })

      await fetchWithAuth(`/canvases/${canvas.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structure_data: { nodes, edges }, version: 0 }),
      })

      // Write node outputs for video_gen nodes so videos show as completed
      await Promise.allSettled(
        wizard.shots
          .filter((s) => wizard.shotVideos[s.id])
          .map((s) =>
            fetchWithAuth(`/canvases/${canvas.id}/node-outputs/${`n-vidgen-${s.id}`}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ output_urls: [wizard.shotVideos[s.id]], is_selected: true }),
            }).catch(() => {})
          )
      )

      toast.success('画布已创建', { id: 'canvas-export' })
      router.push(`/canvas/editor/${canvas.id}`)
    } catch (err) {
      toast.error('创建画布失败', { id: 'canvas-export' })
      router.push('/video-studio')
    }
  }

  if (!serverLoaded) return null

  const headerRight = (
    <Link
      href="/video-studio"
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      返回项目列表
    </Link>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden -m-4 md:-m-6">
      <WizardLayout
        statuses={wizard.statuses}
        activeStep={wizard.activeStep}
        onStepClick={wizard.setActiveStep}
        projectName={projectName}
        headerRight={headerRight}
      >
        {wizard.activeStep === 'describe' && (
          <StepDescribe
            initial={wizard.draftDescribeData ?? wizard.describeData}
            projectType={projectType}
            episodeCount={episodeCount}
            onDraftChange={wizard.setDraftDescribeData}
            onComplete={(data) => {
              wizard.setDescribeData(data)
              wizard.completeStep('describe')
            }}
          />
        )}

        {wizard.activeStep === 'script' && wizard.describeData && (
          <StepScript
            describeData={wizard.describeData}
            initial={wizard.scriptData}
            scriptHistory={wizard.scriptHistory ?? []}
            onComplete={(data) => {
              wizard.setScriptData(data)
              wizard.completeStep('script')
            }}
          />
        )}

        {wizard.activeStep === 'storyboard' && wizard.describeData && wizard.scriptData && (
          <StepStoryboard
            describeData={wizard.describeData}
            script={wizard.scriptData.script}
            characters={wizard.scriptData.characters}
            scenes={wizard.scriptData.scenes}
            characterImages={wizard.characterImages}
            sceneImages={wizard.sceneImages}
            initial={wizard.shots.length > 0 ? wizard.shots : undefined}
            onComplete={(shots) => {
              wizard.setShots(shots)
              wizard.completeStep('storyboard')
            }}
          />
        )}

        {wizard.activeStep === 'characters' && wizard.scriptData && wizard.describeData && (
          <StepCharacters
            scriptData={wizard.scriptData}
            style={wizard.describeData.style}
            characterImages={wizard.characterImages}
            sceneImages={wizard.sceneImages}
            projectId={projectId}
            onSelectCharacterImage={wizard.setCharacterImage}
            onSelectSceneImage={wizard.setSceneImage}
            onComplete={() => wizard.completeStep('characters')}
          />
        )}

        {wizard.activeStep === 'video' && wizard.describeData && (
          <StepVideo
            shots={wizard.shots}
            shotImages={wizard.shotImages}
            shotVideos={wizard.shotVideos}
            describeData={wizard.describeData}
            characterImages={wizard.characterImages}
            sceneImages={wizard.sceneImages}
            projectId={projectId}
            projectName={projectName}
            onVideoReady={wizard.setShotVideo}
            onComplete={handleVideoComplete}
          />
        )}
      </WizardLayout>
    </div>
  )
}

export default function WizardPage() {
  return (
    <Suspense>
      <WizardContent />
    </Suspense>
  )
}
