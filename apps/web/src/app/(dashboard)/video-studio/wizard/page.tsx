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
import type { WizardState } from '@/hooks/video-studio/use-wizard-state'

function WizardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectName = searchParams.get('name') ?? '未命名项目'
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
    // workspaceId is null until the auth store hydrates — wait for it
    if (workspaceId === null || workspaceId === undefined) return
    // already fetched (effect ran twice in StrictMode)
    if (fetchedRef.current) return
    fetchedRef.current = true

    if (!workspaceId) {
      // logged out or no workspace — skip server, use localStorage
      setServerLoaded(true)
      return
    }

    fetchWithAuth<{ wizard_state?: WizardState }>(`/video-studio/projects/${projectId}`)
      .then((project) => {
        if (project?.wizard_state) setServerState(project.wizard_state)
      })
      .catch(() => { /* new project — localStorage is the fallback */ })
      .finally(() => setServerLoaded(true))
  }, [workspaceId, projectId])

  const storageKey = `video-studio:${projectId}`
  const wizard = useWizardState(storageKey, projectId, projectName, serverState)

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
            initial={wizard.describeData}
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
            onVideoReady={wizard.setShotVideo}
            onComplete={() => {
              wizard.completeStep('video')
              router.push('/video-studio')
            }}
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
