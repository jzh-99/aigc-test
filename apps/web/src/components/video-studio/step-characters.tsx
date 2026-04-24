'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Loader2, CheckCircle2, ArrowRight, Upload, RefreshCw, ChevronDown, ChevronUp, Play, X, ZoomIn } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { generateAssetPrompts } from '@/lib/video-studio-api'
import { apiPost, apiGet } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { ScriptResult } from '@/lib/video-studio-api'

interface AssetItem {
  name: string
  type: 'character' | 'scene'
  description: string
  prompt: string
  urls: string[]
  selectedUrl: string | null
}

async function generateImages(prompt: string, aspectRatio: string, workspaceId: string, quantity: number): Promise<string[]> {
  const batch = await apiPost<BatchResponse>('/generate/image', {
    idempotency_key: `vs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    workspace_id: workspaceId,
    quantity,
    model: 'seedream-5.0-lite',
    prompt,
    params: { aspect_ratio: aspectRatio, resolution: '2k' },
  })

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const updated = await apiGet<BatchResponse>(`/batches/${batch.id}`)
    if (updated.status === 'completed' || updated.status === 'partial_complete') {
      return updated.tasks
        .map((t) => t.asset?.storage_url ?? t.asset?.original_url)
        .filter(Boolean) as string[]
    }
    if (updated.status === 'failed') throw new Error('图片生成失败')
  }
  throw new Error('生成超时')
}

interface ImageCardProps {
  item: AssetItem
  workspaceId: string
  onUpdate: (updated: Partial<AssetItem>) => void
  registerGenerate: (name: string, type: AssetItem['type'], fn: () => Promise<void>) => void
}

function ImageCard({ item, workspaceId, onUpdate, registerGenerate }: ImageCardProps) {
  const [loading, setLoading] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState(item.prompt)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const generate = useCallback(async (promptOverride?: string) => {
    setLoading(true)
    try {
      const isCharacter = item.type === 'character'
      const aspectRatio = isCharacter ? '1:1' : '16:9'
      const quantity = 1
      const urls = await generateImages(promptOverride ?? editedPrompt, aspectRatio, workspaceId, quantity)
      onUpdate({ urls, selectedUrl: urls[0] ?? null, prompt: promptOverride ?? editedPrompt })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }, [editedPrompt, item.type, workspaceId, onUpdate])

  const generateRef = useRef(generate)
  generateRef.current = generate
  useEffect(() => {
    registerGenerate(item.name, item.type, () => generateRef.current())
  }, [item.name, item.type, registerGenerate])

  return (
    <div className="border rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-muted-foreground">{item.type === 'character' ? '角色' : '场景'}</span>
          <h3 className="font-semibold text-sm truncate">{item.name}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {item.selectedUrl && <CheckCircle2 className="w-4 h-4 text-green-500" />}
          <button
            onClick={() => setShowDetail(!showDetail)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {showDetail && (
        <div className="space-y-2 text-xs">
          <div className="p-2 bg-muted/40 rounded-lg">
            <p className="text-muted-foreground mb-0.5">描述</p>
            <p className="leading-relaxed">{item.description || '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">提示词（可编辑）</p>
            <textarea
              className="w-full h-20 p-2 bg-muted/40 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary text-xs leading-relaxed"
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
            />
          </div>
        </div>
      )}

      {item.urls.length > 0 ? (
        <div className={`grid gap-2 ${item.urls.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
          {item.urls.map((url, i) => (
            <button
              key={i}
              onClick={() => setLightboxUrl(url)}
              className={`relative rounded-lg overflow-hidden border-2 transition-colors group/img ${
                item.selectedUrl === url ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
              }`}
            >
              <img src={url} alt="" className="w-full aspect-square object-cover" />
              {item.selectedUrl === url && (
                <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
                  <CheckCircle2 className="w-3 h-3 text-white" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="h-20 bg-muted/40 rounded-lg flex items-center justify-center text-muted-foreground text-xs">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '尚未生成'}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative max-w-2xl w-full bg-card rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-3 right-3 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <img src={lightboxUrl} alt="" className="w-full object-contain max-h-[70vh]" />
            <div className="p-4 flex items-center justify-between">
              <p className="text-sm font-medium">{item.name}</p>
              <button
                onClick={() => {
                  onUpdate({ selectedUrl: lightboxUrl })
                  setLightboxUrl(null)
                }}
                className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg transition-colors ${
                  item.selectedUrl === lightboxUrl
                    ? 'bg-green-600 text-white cursor-default'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                {item.selectedUrl === lightboxUrl ? '已选为定稿' : '选为定稿'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => generate()}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-primary text-primary-foreground py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {loading ? '生成中…' : item.urls.length > 0 ? '重新生成' : '生成参考图'}
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
              onUpdate({ urls: [url], selectedUrl: url })
            }}
          />
        </label>
      </div>
    </div>
  )
}

interface Props {
  scriptData: Omit<ScriptResult, 'success'>
  style: string
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  onSelectCharacterImage: (name: string, url: string) => void
  onSelectSceneImage: (name: string, url: string) => void
  onComplete: () => void
}

export function StepCharacters({ scriptData, style, characterImages, sceneImages, onSelectCharacterImage, onSelectSceneImage, onComplete }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId) ?? ''
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [items, setItems] = useState<AssetItem[]>(() => [
    ...scriptData.characters.map((c) => ({
      name: c.name,
      type: 'character' as const,
      description: c.description,
      // Three-view sheet prompt for characters
      prompt: `${c.name}, ${c.description}, character reference sheet, three views: front view, side view, back view, full body, white background, cinematic, ${style}`,
      urls: characterImages[c.name] ? [characterImages[c.name]] : [],
      selectedUrl: characterImages[c.name] ?? null,
    })),
    ...scriptData.scenes.map((s) => ({
      name: s.name,
      type: 'scene' as const,
      description: s.description,
      prompt: `${s.name}, ${s.description}, no people, wide shot, cinematic, ${style}`,
      urls: sceneImages[s.name] ? [sceneImages[s.name]] : [],
      selectedUrl: sceneImages[s.name] ?? null,
    })),
  ])

  // Registry for batch generation — each card registers its own generate fn
  const generateFnsRef = useRef<Record<string, () => Promise<void>>>({})
  const registerGenerate = useCallback((name: string, type: AssetItem['type'], fn: () => Promise<void>) => {
    generateFnsRef.current[`${type}:${name}`] = fn
  }, [])

  const generateAllPrompts = useCallback(async () => {
    if (!token) return
    setLoadingPrompts(true)
    try {
      const res = await generateAssetPrompts({
        characters: scriptData.characters,
        scenes: scriptData.scenes,
        style,
      }, token)
      setItems((prev) => prev.map((item) => {
        if (item.type === 'character') {
          const found = res.characters.find((c) => c.name === item.name)
          // Append three-view keywords to AI-generated prompt
          if (found) return { ...item, prompt: `${found.prompt}, character reference sheet, three views: front view, side view, back view, full body, white background` }
        } else {
          const found = res.scenes.find((s) => s.name === item.name)
          if (found) return { ...item, prompt: found.prompt }
        }
        return item
      }))
      toast.success('提示词已优化')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '优化失败')
    } finally {
      setLoadingPrompts(false)
    }
  }, [scriptData, style, token])

  const batchGenerate = useCallback(async () => {
    setBatchRunning(true)
    const fns = items
      .map((item) => generateFnsRef.current[`${item.type}:${item.name}`])
      .filter(Boolean)
    const results = await Promise.allSettled(fns.map((fn) => fn()))
    setBatchRunning(false)
    const successCount = results.filter((r) => r.status === 'fulfilled').length
    if (successCount > 0) toast.success(`批量生成完成，${successCount}/${fns.length} 成功`)
  }, [items])

  const updateItem = (name: string, type: 'character' | 'scene', updated: Partial<AssetItem>) => {
    setItems((prev) => prev.map((item) =>
      item.name === name && item.type === type ? { ...item, ...updated } : item
    ))
    if (updated.selectedUrl) {
      if (type === 'character') onSelectCharacterImage(name, updated.selectedUrl)
      else onSelectSceneImage(name, updated.selectedUrl)
    }
  }

  const allSelected = items.every((item) => item.selectedUrl)
  const characters = items.filter((i) => i.type === 'character')
  const scenes = items.filter((i) => i.type === 'scene')

  return (
    <div className="flex h-full">
      {/* Left: controls */}
      <div className="w-[260px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">角色 & 场景图</h2>
          <p className="text-xs text-muted-foreground mt-0.5">为每个角色和场景生成参考图</p>
        </div>

        <button
          onClick={generateAllPrompts}
          disabled={loadingPrompts || batchRunning}
          className="w-full flex items-center justify-center gap-2 text-xs border border-border py-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          {loadingPrompts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✨'}
          AI 优化提示词
        </button>

        <button
          onClick={batchGenerate}
          disabled={batchRunning || loadingPrompts}
          className="w-full flex items-center justify-center gap-2 text-xs bg-primary text-primary-foreground py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {batchRunning ? '批量生成中…' : `批量生成全部 (${items.length})`}
        </button>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>{items.filter((i) => i.selectedUrl).length} / {items.length} 已选定</p>
        </div>

        {allSelected && (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
          >
            确认，生成视频
            <ArrowRight className="w-4 h-4" />
          </button>
        )}

        {!allSelected && items.some((i) => i.selectedUrl) && (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 text-sm border border-border py-2.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            跳过，直接生成视频
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Right: cards */}
      <div className="flex-1 p-5 overflow-y-auto space-y-5">
        {characters.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">角色参考图（三视图）</h3>
            <div className="grid grid-cols-2 gap-3">
              {characters.map((item) => (
                <ImageCard
                  key={item.name}
                  item={item}
                  workspaceId={workspaceId}
                  onUpdate={(u) => updateItem(item.name, 'character', u)}
                  registerGenerate={registerGenerate}
                />
              ))}
            </div>
          </div>
        )}

        {scenes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">场景参考图</h3>
            <div className="grid grid-cols-2 gap-3">
              {scenes.map((item) => (
                <ImageCard
                  key={item.name}
                  item={item}
                  workspaceId={workspaceId}
                  onUpdate={(u) => updateItem(item.name, 'scene', u)}
                  registerGenerate={registerGenerate}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
