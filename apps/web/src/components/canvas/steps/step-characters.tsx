'use client'

import { useState, useCallback } from 'react'
import { Loader2, CheckCircle2, ArrowRight, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { executeCanvasNode } from '@/lib/canvas/canvas-api'
import { MODEL_CODE_MAP } from '@/components/canvas/panels/panel-constants'

interface ImageCardProps {
  name: string
  type: 'character' | 'scene'
  selectedUrl: string | null
  onSelect: (url: string | null) => void
  canvasId: string
}

function ImageCard({ name, type, selectedUrl, onSelect, canvasId }: ImageCardProps) {
  const token = useAuthStore((s) => s.accessToken)
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const [loading, setLoading] = useState(false)
  const [urls, setUrls] = useState<string[]>(selectedUrl ? [selectedUrl] : [])

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      // Create a temporary node id for this generation
      const tempNodeId = `steps_${type}_${name}_${Date.now()}`
      const prompt = type === 'character'
        ? `${name}，角色参考图，三视图（正面、侧面、背面），白色背景，写实风格`
        : `${name}，场景参考图，无人物，写实风格，宽幅构图`
      const aspectRatio = type === 'character' ? '1:1' : '16:9'
      const modelCode = MODEL_CODE_MAP['gemini']?.['2k'] ?? 'gemini-3.1-flash-image-preview-2k'

      await executeCanvasNode({
        canvasId,
        canvasNodeId: tempNodeId,
        type: 'image_gen',
        config: {
          prompt,
          model: modelCode,
          aspectRatio,
          quantity: 3,
          resolution: '2k',
        },
        workspaceId: workspaceId ?? undefined,
      }, token ?? undefined)

      // Poll for results
      const execStore = useCanvasExecutionStore.getState()
      const outputs = execStore.nodes[tempNodeId]?.outputs ?? []
      const resultUrls = outputs.map((o) => o.url).filter(Boolean) as string[]
      if (resultUrls.length > 0) {
        setUrls(resultUrls)
        onSelect(resultUrls[0])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }, [name, type, canvasId, workspaceId, token, onSelect])

  return (
    <div className="border rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-muted-foreground">{type === 'character' ? '角色' : '场景'}</span>
          <h3 className="font-semibold">{name}</h3>
        </div>
        {selectedUrl && <CheckCircle2 className="w-5 h-5 text-green-500" />}
      </div>

      {urls.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((url, i) => (
            <button
              key={i}
              onClick={() => onSelect(url)}
              className={`relative rounded-lg overflow-hidden border-2 transition-colors ${
                selectedUrl === url ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
              }`}
            >
              <img src={url} alt="" className="w-full aspect-square object-cover" />
              {selectedUrl === url && (
                <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
                  <CheckCircle2 className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="h-24 bg-muted/40 rounded-lg flex items-center justify-center text-muted-foreground text-sm">
          尚未生成
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={generate}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-primary text-primary-foreground py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {loading ? '生成中…' : urls.length > 0 ? '重新生成' : '生成参考图'}
        </button>
        <label className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer px-2 py-1.5 border rounded-lg transition-colors">
          <Upload className="w-3.5 h-3.5" />
          上传
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const url = URL.createObjectURL(file)
              setUrls([url])
              onSelect(url)
            }}
          />
        </label>
      </div>
    </div>
  )
}

interface Props {
  canvasId: string
  characters: string[]
  scenes: string[]
  characterImages: Record<string, string | null>
  sceneImages: Record<string, string | null>
  onSelectCharacterImage: (name: string, url: string | null) => void
  onSelectSceneImage: (name: string, url: string | null) => void
  onComplete: () => void
}

export function StepCharacters({
  canvasId,
  characters,
  scenes,
  characterImages,
  sceneImages,
  onSelectCharacterImage,
  onSelectSceneImage,
  onComplete,
}: Props) {
  const allSelected =
    characters.every((c) => characterImages[c]) &&
    scenes.every((s) => sceneImages[s])

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Step 3 · 角色 & 场景</h2>
        <p className="text-sm text-muted-foreground mt-1">为每个角色和场景生成参考图，选定后用于视频生成</p>
      </div>

      {characters.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">角色</h3>
          {characters.map((c) => (
            <ImageCard
              key={c}
              name={c}
              type="character"
              canvasId={canvasId}
              selectedUrl={characterImages[c] ?? null}
              onSelect={(url) => onSelectCharacterImage(c, url)}
            />
          ))}
        </div>
      )}

      {scenes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">场景</h3>
          {scenes.map((s) => (
            <ImageCard
              key={s}
              name={s}
              type="scene"
              canvasId={canvasId}
              selectedUrl={sceneImages[s] ?? null}
              onSelect={(url) => onSelectSceneImage(s, url)}
            />
          ))}
        </div>
      )}

      {(characters.length > 0 || scenes.length > 0) && (
        <button
          onClick={onComplete}
          disabled={!allSelected}
          className="flex items-center gap-2 text-sm bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {allSelected ? '全部已选定，进入视频合成' : `还有 ${[...characters.filter(c => !characterImages[c]), ...scenes.filter(s => !sceneImages[s])].length} 项未选定`}
          {allSelected && <ArrowRight className="w-4 h-4" />}
        </button>
      )}
    </div>
  )
}
