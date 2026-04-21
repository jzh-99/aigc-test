'use client'

import { useState, useCallback } from 'react'
import { Loader2, Play, CheckCircle2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { executeVideoNode } from '@/lib/canvas/canvas-api'

interface Shot { id: string; label: string; content: string }

interface ShotCardProps {
  shot: Shot
  refImages: string[]
  canvasId: string
  result: string | null
  onResult: (url: string) => void
}

function ShotCard({ shot, refImages, canvasId, result, onResult }: ShotCardProps) {
  const token = useAuthStore((s) => s.accessToken)
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const [loading, setLoading] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const nodeId = `steps_video_${shot.id}`
      await executeVideoNode({
        canvasId,
        canvasNodeId: nodeId,
        workspaceId: workspaceId ?? undefined,
        prompt: shot.content,
        model: 'seedance-2.0',
        videoMode: 'multiref',
        aspectRatio: '16:9',
        duration: 5,
        referenceImages: refImages.slice(0, 3),
      }, token ?? undefined)

      const execStore = useCanvasExecutionStore.getState()
      const outputs = execStore.nodes[nodeId]?.outputs ?? []
      const url = outputs.find((o) => o.url)?.url
      if (url) onResult(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '视频生成失败')
    } finally {
      setLoading(false)
    }
  }, [shot, refImages, canvasId, workspaceId, token, onResult])

  return (
    <div className="border rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-muted-foreground">{shot.label}</span>
          <p className="text-sm mt-0.5 line-clamp-2">{shot.content}</p>
        </div>
        {result && <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 ml-2" />}
      </div>

      {result ? (
        <video
          src={result}
          className="w-full rounded-lg aspect-video bg-black"
          controls
          muted
          loop
          playsInline
        />
      ) : (
        <div className="h-24 bg-muted/40 rounded-lg flex items-center justify-center">
          <Play className="w-8 h-8 text-muted-foreground/30" />
        </div>
      )}

      <button
        onClick={generate}
        disabled={loading}
        className="w-full flex items-center justify-center gap-1.5 text-xs bg-primary text-primary-foreground py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {loading ? '生成中…' : result ? '重新生成' : '生成视频'}
      </button>
    </div>
  )
}

interface Props {
  canvasId: string
  shots: Shot[]
  characterImages: Record<string, string | null>
  sceneImages: Record<string, string | null>
  onComplete: () => void
}

export function StepVideo({ canvasId, shots, characterImages, sceneImages, onComplete }: Props) {
  const [results, setResults] = useState<Record<string, string>>({})
  const [generatingAll, setGeneratingAll] = useState(false)
  const token = useAuthStore((s) => s.accessToken)
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)

  const refImages = [
    ...Object.values(characterImages).filter(Boolean) as string[],
    ...Object.values(sceneImages).filter(Boolean) as string[],
  ]

  const generateAll = useCallback(async () => {
    setGeneratingAll(true)
    let failed = 0
    for (const shot of shots) {
      try {
        const nodeId = `steps_video_${shot.id}`
        await executeVideoNode({
          canvasId,
          canvasNodeId: nodeId,
          workspaceId: workspaceId ?? undefined,
          prompt: shot.content,
          model: 'seedance-2.0',
          videoMode: 'multiref',
          aspectRatio: '16:9',
          duration: 5,
          referenceImages: refImages.slice(0, 3),
        }, token ?? undefined)
        const execStore = useCanvasExecutionStore.getState()
        const url = execStore.nodes[nodeId]?.outputs.find((o) => o.url)?.url
        if (url) setResults((prev) => ({ ...prev, [shot.id]: url }))
      } catch {
        failed++
      }
    }
    if (failed > 0) toast.error(`${failed} 个视频生成失败`)
    setGeneratingAll(false)
  }, [shots, refImages, canvasId, workspaceId, token])

  const doneCount = Object.keys(results).length
  const allDone = doneCount === shots.length && shots.length > 0

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">Step 5 · 视频合成</h2>
          <p className="text-sm text-muted-foreground mt-1">为每个分镜生成视频片段</p>
        </div>
        <button
          onClick={generateAll}
          disabled={generatingAll || shots.length === 0}
          className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
        >
          {generatingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {generatingAll ? `生成中 ${doneCount}/${shots.length}` : '全部生成'}
        </button>
      </div>

      {shots.length === 0 ? (
        <div className="border rounded-xl bg-card p-8 text-center text-muted-foreground">
          请先完成分镜步骤
        </div>
      ) : (
        <div className="space-y-4">
          {shots.map((shot) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              refImages={refImages}
              canvasId={canvasId}
              result={results[shot.id] ?? null}
              onResult={(url) => setResults((prev) => ({ ...prev, [shot.id]: url }))}
            />
          ))}
        </div>
      )}

      {allDone && (
        <button
          onClick={onComplete}
          className="flex items-center gap-2 text-sm bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          项目完成！
        </button>
      )}
    </div>
  )
}
