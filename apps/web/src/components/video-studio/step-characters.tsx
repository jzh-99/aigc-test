'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Loader2, CheckCircle2, ArrowRight, Upload, RefreshCw, ChevronDown, ChevronUp, Play, X, ZoomIn, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { generateAssetPrompts } from '@/lib/video-studio-api'
import type { ScriptResult } from '@/lib/video-studio-api'
import { apiPost } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import { usePendingBatchWatcher } from '@/hooks/video-studio/use-pending-batch-watcher'
import type { PendingImageBatchTarget } from '@/hooks/video-studio/use-wizard-state'
import { IMAGE_MODEL_CREDITS } from '@/lib/credits'
import { MODEL_CODE_MAP } from '@/components/canvas/panels/panel-constants'

type ImageModel = 'gemini' | 'gpt-image-2' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0'
type ImageResolution = '1k' | '2k' | '3k' | '4k'

interface ImageParams {
  characterModel: ImageModel
  characterResolution: ImageResolution
  sceneModel: ImageModel
  sceneResolution: ImageResolution
  quantity: number
}

const IMAGE_MODEL_OPTIONS: Array<{ value: ImageModel; label: string; resolutions: ImageResolution[] }> = [
  { value: 'seedream-5.0-lite', label: 'Seedream 5.0', resolutions: ['2k', '3k'] },
  { value: 'seedream-4.5',      label: 'Seedream 4.5', resolutions: ['2k', '4k'] },
  { value: 'seedream-4.0',      label: 'Seedream 4.0', resolutions: ['1k', '2k', '4k'] },
  { value: 'nano-banana-pro',   label: '全能图片Pro',   resolutions: ['1k', '2k', '4k'] },
  { value: 'gemini',            label: '全能图片2',     resolutions: ['1k', '2k', '4k'] },
  { value: 'gpt-image-2',       label: '超能图片2',     resolutions: ['2k'] },
]

const DEFAULT_IMAGE_PARAMS: ImageParams = { characterModel: 'seedream-5.0-lite', characterResolution: '2k', sceneModel: 'gemini', sceneResolution: '2k', quantity: 1 }

interface AssetItem {
  name: string
  type: 'character' | 'scene'
  description: string
  prompt: string
  urls: string[]
  selectedUrl: string | null
  shared?: boolean
}

async function submitImageBatch(prompt: string, aspectRatio: string, workspaceId: string, model: ImageModel, resolution: ImageResolution, quantity: number, projectId: string): Promise<string> {
  if (!workspaceId) throw new Error('未选择工作区')
  const modelCode = MODEL_CODE_MAP[model as keyof typeof MODEL_CODE_MAP]?.[resolution as keyof (typeof MODEL_CODE_MAP)[keyof typeof MODEL_CODE_MAP]] ?? model
  const batch = await apiPost<BatchResponse>('/generate/image', {
    idempotency_key: `vs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    workspace_id: workspaceId,
    quantity,
    model: modelCode,
    prompt,
    params: { aspect_ratio: aspectRatio, resolution },
    ...(projectId ? { video_studio_project_id: projectId } : {}),
  })
  return batch.id
}

function appendStyleToPrompt(prompt: string, style: string) {
  const trimmedStyle = style.trim()
  if (!trimmedStyle || prompt.includes(trimmedStyle)) return prompt
  return `${prompt}, ${trimmedStyle}`
}

interface ImageCardProps {
  item: AssetItem
  workspaceId: string
  projectId: string
  imageParams: ImageParams
  activeStyle: string
  isPending: boolean
  onUpdate: (updated: Partial<AssetItem>) => void
  onBatchSubmitted: (batchId: string) => void
  registerGenerate: (name: string, type: AssetItem['type'], fn: () => Promise<boolean>) => void
}

function ImageCard({ item, workspaceId, projectId, imageParams, activeStyle, isPending, onUpdate, onBatchSubmitted, registerGenerate }: ImageCardProps) {
  const [loading, setLoading] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState(item.prompt)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const generate = useCallback(async (promptOverride?: string): Promise<boolean> => {
    setLoading(true)
    try {
      const isCharacter = item.type === 'character'
      const aspectRatio = isCharacter ? '1:1' : '16:9'
      const prompt = appendStyleToPrompt(promptOverride ?? editedPrompt, activeStyle)
      const model = isCharacter ? imageParams.characterModel : imageParams.sceneModel
      const resolution = isCharacter ? imageParams.characterResolution : imageParams.sceneResolution
      const batchId = await submitImageBatch(prompt, aspectRatio, workspaceId, model, resolution, imageParams.quantity, projectId)
      onBatchSubmitted(batchId)
      onUpdate({ prompt })
      toast.success(`${item.name}：任务已提交`)
      return true
    } catch (err) {
      toast.error(`${item.name}：${err instanceof Error ? err.message : '生成失败'}`)
      return false
    } finally {
      setLoading(false)
    }
  }, [editedPrompt, activeStyle, item.type, item.name, workspaceId, imageParams, projectId, onUpdate, onBatchSubmitted])

  const generateRef = useRef(generate)
  generateRef.current = generate
  useEffect(() => {
    registerGenerate(item.name, item.type, () => generateRef.current())
  }, [item.name, item.type, registerGenerate])

  return (
    <div className="border rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-muted-foreground">{item.shared ? '共享资产' : item.type === 'character' ? '角色' : '场景'}</span>
          <h3 className="font-semibold text-sm truncate">{item.name}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {item.shared && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
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
            <p className="text-muted-foreground">{item.shared ? '共享资产提示词' : '提示词（可编辑）'}</p>
            <textarea
              className="w-full h-20 p-2 bg-muted/40 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary text-xs leading-relaxed disabled:opacity-70"
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              disabled={item.shared}
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
          {loading || isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '尚未生成'}
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
                  if (item.shared) return
                  onUpdate({ selectedUrl: lightboxUrl })
                  setLightboxUrl(null)
                }}
                disabled={item.shared}
                className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg transition-colors ${
                  item.selectedUrl === lightboxUrl
                    ? 'bg-green-600 text-white cursor-default'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                {item.shared ? '共享资产' : item.selectedUrl === lightboxUrl ? '已选为定稿' : '选为定稿'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!item.shared && (
        <div className="flex gap-2">
          <button
            onClick={() => generate()}
            disabled={loading || isPending}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-primary text-primary-foreground py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading || isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {loading || isPending ? '生成中…' : item.urls.length > 0 ? `重新生成 · ${(IMAGE_MODEL_CREDITS[item.type === 'character' ? imageParams.characterModel : imageParams.sceneModel] ?? 10) * imageParams.quantity}积分` : `生成参考图 · ${(IMAGE_MODEL_CREDITS[item.type === 'character' ? imageParams.characterModel : imageParams.sceneModel] ?? 10) * imageParams.quantity}积分`}
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
      )}
    </div>
  )
}

const STYLE_PRESETS = [
  '真人写实',
  '皮克斯3D',
  '吉卜力',
  '赛璐璐动漫',
  '国风水墨',
  '赛博朋克',
  '奇幻史诗',
  '极简插画',
]

interface Props {
  projectId: string
  scriptData: Omit<ScriptResult, 'success'>
  style: string
  assetStyle?: string
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  characterImageHistory: Record<string, string[][]>
  sceneImageHistory: Record<string, string[][]>
  pendingImageBatches: Record<string, PendingImageBatchTarget>
  mode?: 'single' | 'series-shared' | 'episode'
  sharedCharacters?: Array<{ name: string; description: string; voiceDescription?: string }>
  sharedScenes?: Array<{ name: string; description: string }>
  sharedCharacterImages?: Record<string, string>
  sharedSceneImages?: Record<string, string>
  sharedCharacterImageHistory?: Record<string, string[][]>
  sharedSceneImageHistory?: Record<string, string[][]>
  onAddPendingImageBatch: (batchId: string, target: PendingImageBatchTarget) => void
  onClearPendingImageBatch: (batchId: string) => void
  onSelectCharacterImage: (name: string, url: string, batch?: string[]) => void
  onSelectSceneImage: (name: string, url: string, batch?: string[]) => void
  onAssetStyleChange?: (style: string) => void
  onComplete: () => void
}

function shouldGenerateCharacterImage(character: { name: string; description: string; visualPresence?: boolean }) {
  if (character.visualPresence === false) return false
  return !/(旁白|画外音|不出场|无需形象|不需要生成形象)/.test(`${character.name} ${character.description}`)
}

function buildAssetItems(params: {
  scriptData: Omit<ScriptResult, 'success'>
  style: string
  characterImages: Record<string, string>
  sceneImages: Record<string, string>
  characterImageHistory: Record<string, string[][]>
  sceneImageHistory: Record<string, string[][]>
  mode: 'single' | 'series-shared' | 'episode'
  sharedCharacters: Array<{ name: string; description: string; voiceDescription?: string }>
  sharedScenes: Array<{ name: string; description: string }>
  sharedCharacterImages: Record<string, string>
  sharedSceneImages: Record<string, string>
  sharedCharacterImageHistory: Record<string, string[][]>
  sharedSceneImageHistory: Record<string, string[][]>
}): AssetItem[] {
  const flatHistory = (history: Record<string, string[][]>, name: string): string[] =>
    (history[name] ?? []).flatMap((batch) => batch)

  const sharedCharacterNames = new Set(params.sharedCharacters.map((item) => item.name))
  const sharedSceneNames = new Set(params.sharedScenes.map((item) => item.name))
  const sharedCharacters = params.mode === 'episode' ? params.sharedCharacters.map((c) => ({
    name: c.name,
    type: 'character' as const,
    description: c.description,
    prompt: `${c.name}, ${c.description}, character reference sheet, three views: front view, side view, back view, full body, white background, cinematic, ${params.style}`,
    urls: flatHistory(params.sharedCharacterImageHistory, c.name).length > 0
      ? flatHistory(params.sharedCharacterImageHistory, c.name)
      : params.sharedCharacterImages[c.name] ? [params.sharedCharacterImages[c.name]] : [],
    selectedUrl: params.sharedCharacterImages[c.name] ?? null,
    shared: true,
  })) : []
  const sharedScenes = params.mode === 'episode' ? params.sharedScenes.map((s) => ({
    name: s.name,
    type: 'scene' as const,
    description: s.description,
    prompt: `${s.name}, ${s.description}, no people, wide shot, cinematic, ${params.style}`,
    urls: flatHistory(params.sharedSceneImageHistory, s.name).length > 0
      ? flatHistory(params.sharedSceneImageHistory, s.name)
      : params.sharedSceneImages[s.name] ? [params.sharedSceneImages[s.name]] : [],
    selectedUrl: params.sharedSceneImages[s.name] ?? null,
    shared: true,
  })) : []
  const localCharacters = params.scriptData.characters
    .filter(shouldGenerateCharacterImage)
    .filter((c) => params.mode !== 'episode' || !sharedCharacterNames.has(c.name))
    .map((c) => {
      const allUrls = flatHistory(params.characterImageHistory, c.name)
      return {
        name: c.name,
        type: 'character' as const,
        description: c.description,
        prompt: `${c.name}, ${c.description}, character reference sheet, three views: front view, side view, back view, full body, white background, cinematic, ${params.style}`,
        urls: allUrls.length > 0 ? allUrls : params.characterImages[c.name] ? [params.characterImages[c.name]] : [],
        selectedUrl: params.characterImages[c.name] ?? null,
      }
    })
  const localScenes = params.scriptData.scenes
    .filter((s) => params.mode !== 'episode' || !sharedSceneNames.has(s.name))
    .map((s) => {
      const allUrls = flatHistory(params.sceneImageHistory, s.name)
      return {
        name: s.name,
        type: 'scene' as const,
        description: s.description,
        prompt: `${s.name}, ${s.description}, no people, wide shot, cinematic, ${params.style}`,
        urls: allUrls.length > 0 ? allUrls : params.sceneImages[s.name] ? [params.sceneImages[s.name]] : [],
        selectedUrl: params.sceneImages[s.name] ?? null,
      }
    })
  return [...sharedCharacters, ...localCharacters, ...sharedScenes, ...localScenes]
}

export function StepCharacters({ projectId, scriptData, style: initialStyle, assetStyle, characterImages, sceneImages, characterImageHistory, sceneImageHistory, pendingImageBatches, mode = 'single', sharedCharacters = [], sharedScenes = [], sharedCharacterImages = {}, sharedSceneImages = {}, sharedCharacterImageHistory = {}, sharedSceneImageHistory = {}, onAddPendingImageBatch, onClearPendingImageBatch, onSelectCharacterImage, onSelectSceneImage, onAssetStyleChange, onComplete }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId) ?? ''
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [imageParams, setImageParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS)
  const initialAssetStyle = assetStyle ?? initialStyle
  const [activeStyle, setActiveStyle] = useState(initialAssetStyle)
  const [styleInput, setStyleInput] = useState(initialAssetStyle)
  const [items, setItems] = useState<AssetItem[]>(() => buildAssetItems({ scriptData, style: initialAssetStyle, characterImages, sceneImages, characterImageHistory, sceneImageHistory, mode, sharedCharacters, sharedScenes, sharedCharacterImages, sharedSceneImages, sharedCharacterImageHistory, sharedSceneImageHistory }))

  // Rebuild default prompts when style changes, preserving existing urls/selectedUrl
  const prevStyleRef = useRef(initialAssetStyle)
  useEffect(() => {
    if (activeStyle === prevStyleRef.current) return
    prevStyleRef.current = activeStyle
    onAssetStyleChange?.(activeStyle)
    setItems((prev) => prev.map((item) => {
      if (item.shared) return item
      const basePrompt = item.type === 'character'
        ? `${item.name}, ${item.description}, character reference sheet, three views: front view, side view, back view, full body, white background, cinematic`
        : `${item.name}, ${item.description}, no people, wide shot, cinematic`
      return { ...item, prompt: activeStyle ? `${basePrompt}, ${activeStyle}` : basePrompt }
    }))
  }, [activeStyle, onAssetStyleChange])

  // Registry for batch generation — each card registers its own generate fn
  const generateFnsRef = useRef<Record<string, () => Promise<boolean>>>({})
  const registerGenerate = useCallback((name: string, type: AssetItem['type'], fn: () => Promise<boolean>) => {
    generateFnsRef.current[`${type}:${name}`] = fn
  }, [])

  const updateItem = useCallback((name: string, type: 'character' | 'scene', updated: Partial<AssetItem>) => {
    setItems((prev) => prev.map((item) =>
      item.name === name && item.type === type ? { ...item, ...updated } : item
    ))
    if (updated.selectedUrl) {
      if (type === 'character') onSelectCharacterImage(name, updated.selectedUrl, updated.urls)
      else onSelectSceneImage(name, updated.selectedUrl, updated.urls)
    }
  }, [onSelectCharacterImage, onSelectSceneImage])

  usePendingBatchWatcher({
    pendingBatches: pendingImageBatches ?? {},
    failureMessage: '图片生成失败',
    emptyMessage: '图片生成完成但未返回URL',
    onCompleted: (target, urls) => {
      updateItem(target.name, target.type, { urls, selectedUrl: urls[0] ?? null })
      toast.success(`${target.name}：生成完成`)
    },
    onClear: onClearPendingImageBatch,
  })

  const pendingImageKeys = new Set(Object.values(pendingImageBatches ?? {}).map((target) => `${target.type}:${target.name}`))

  const generateAllPrompts = useCallback(async () => {
    if (!token) return
    setLoadingPrompts(true)
    try {
      const localItems = items.filter((item) => !item.shared)
      const res = await generateAssetPrompts({
        characters: localItems.filter((item) => item.type === 'character').map((item) => ({ name: item.name, description: item.description })),
        scenes: localItems.filter((item) => item.type === 'scene').map((item) => ({ name: item.name, description: item.description })),
        style: activeStyle,
      }, token)
      setItems((prev) => prev.map((item) => {
        if (item.shared) return item
        if (item.type === 'character') {
          const found = res.characters.find((c) => c.name === item.name)
          if (found) return { ...item, prompt: appendStyleToPrompt(`${found.prompt}, character reference sheet, three views: front view, side view, back view, full body, white background`, activeStyle) }
        } else {
          const found = res.scenes.find((s) => s.name === item.name)
          if (found) return { ...item, prompt: appendStyleToPrompt(found.prompt, activeStyle) }
        }
        return item
      }))
      toast.success('提示词已优化')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '优化失败')
    } finally {
      setLoadingPrompts(false)
    }
  }, [items, activeStyle, token])

  const batchGenerate = useCallback(async () => {
    setBatchRunning(true)
    const fns = items
      .filter((item) => !item.shared && !pendingImageKeys.has(`${item.type}:${item.name}`))
      .map((item) => generateFnsRef.current[`${item.type}:${item.name}`])
      .filter(Boolean)
    const results = await Promise.allSettled(fns.map((fn) => fn()))
    setBatchRunning(false)
    const submittedCount = results.filter((r) => r.status === 'fulfilled' && r.value === true).length
    if (submittedCount > 0) toast.success(`任务已提交，${submittedCount}/${fns.length} 个`)
  }, [items, pendingImageKeys])

  const localItems = items.filter((item) => !item.shared)
  const allSelected = items.every((item) => item.selectedUrl)
  const selectedLocalCount = localItems.filter((item) => item.selectedUrl).length
  const characters = items.filter((i) => i.type === 'character')
  const scenes = items.filter((i) => i.type === 'scene')
  const copy = mode === 'series-shared'
    ? { title: '主要人物 & 场景图', desc: '为整剧主要人物和场景生成共享参考图', confirm: '确认共享资产，创建分集项目', skip: '跳过，创建分集项目' }
    : mode === 'episode'
      ? { title: '角色 & 场景图', desc: '共享资产已自动加载，只需生成本集新增人物和场景', confirm: '确认，生成视频', skip: '跳过，直接生成视频' }
      : { title: '角色 & 场景图', desc: '为每个角色和场景生成参考图', confirm: '确认，生成视频', skip: '跳过，直接生成视频' }

  return (
    <div className="flex h-full">
      {/* Left: controls */}
      <div className="w-[260px] shrink-0 border-r p-5 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">{copy.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{copy.desc}</p>
        </div>

        {/* Style selector */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">画风</p>
          <div className="flex flex-wrap gap-1">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => { setActiveStyle(preset); setStyleInput(preset) }}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${activeStyle === preset ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'}`}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={styleInput}
            onChange={(e) => { setStyleInput(e.target.value); setActiveStyle(e.target.value) }}
            placeholder="自定义画风…"
            className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          onClick={generateAllPrompts}
          disabled={loadingPrompts || batchRunning}
          className="w-full flex items-center justify-center gap-2 text-xs border border-border py-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          {loadingPrompts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✨'}
          AI 优化提示词
        </button>

        {/* Image params panel */}
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowParams(!showParams)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted transition-colors"
          >
            <span className="text-muted-foreground">生成参数</span>
            <div className="flex items-center gap-2">
              <span className="text-foreground">角色 Seedream 5.0 · 场景 全能图片2 · ×{imageParams.quantity}</span>
              {showParams ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </div>
          </button>
          {showParams && (
            <div className="border-t p-3 space-y-3 bg-muted/20">
              <div className="rounded-lg bg-amber-50 text-amber-800 px-2.5 py-2 text-[11px] leading-relaxed">
                如果想要做真人风格视频，人物生成模型必选 Seedream 5.0，其他模型暂不支持真人视频。
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">人物模型</p>
                <div className="grid grid-cols-1 gap-1">
                  {IMAGE_MODEL_OPTIONS.filter((m) => m.value === 'seedream-5.0-lite').map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setImageParams((p) => ({ ...p, characterModel: m.value, characterResolution: m.resolutions.includes(p.characterResolution) ? p.characterResolution : m.resolutions[0] }))}
                      className={`text-left px-2 py-1 rounded text-xs transition-colors ${imageParams.characterModel === m.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      {m.label}
                      <span className="ml-1 opacity-60">{IMAGE_MODEL_CREDITS[m.value]}积分/张</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">人物分辨率</p>
                <div className="flex gap-1 flex-wrap">
                  {(IMAGE_MODEL_OPTIONS.find(m => m.value === imageParams.characterModel)?.resolutions ?? ['2k']).map((r) => (
                    <button
                      key={r}
                      onClick={() => setImageParams((p) => ({ ...p, characterResolution: r }))}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${imageParams.characterResolution === r ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'}`}
                    >
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">场景模型</p>
                <div className="grid grid-cols-1 gap-1">
                  {IMAGE_MODEL_OPTIONS.filter((m) => m.value === 'gemini').map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setImageParams((p) => ({ ...p, sceneModel: m.value, sceneResolution: m.resolutions.includes(p.sceneResolution) ? p.sceneResolution : m.resolutions[0] }))}
                      className={`text-left px-2 py-1 rounded text-xs transition-colors ${imageParams.sceneModel === m.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      {m.label}
                      <span className="ml-1 opacity-60">{IMAGE_MODEL_CREDITS[m.value]}积分/张</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">场景分辨率</p>
                <div className="flex gap-1 flex-wrap">
                  {(IMAGE_MODEL_OPTIONS.find(m => m.value === imageParams.sceneModel)?.resolutions ?? ['2k']).map((r) => (
                    <button
                      key={r}
                      onClick={() => setImageParams((p) => ({ ...p, sceneResolution: r }))}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${imageParams.sceneResolution === r ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'}`}
                    >
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">每张生成数量</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((q) => (
                    <button
                      key={q}
                      onClick={() => setImageParams((p) => ({ ...p, quantity: q }))}
                      className={`w-8 h-7 rounded text-xs transition-colors ${imageParams.quantity === q ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={batchGenerate}
          disabled={batchRunning || loadingPrompts}
          className="w-full flex items-center justify-center gap-2 text-xs bg-primary text-primary-foreground py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {batchRunning ? '批量生成中…' : `批量生成全部 (${localItems.length}) · ${localItems.reduce((sum, item) => sum + (IMAGE_MODEL_CREDITS[item.type === 'character' ? imageParams.characterModel : imageParams.sceneModel] ?? 10) * imageParams.quantity, 0)}积分`}
        </button>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>{items.filter((i) => i.selectedUrl).length} / {items.length} 已选定</p>
          {mode === 'episode' && localItems.length > 0 && <p>本集新增：{selectedLocalCount} / {localItems.length}</p>}
        </div>

        {allSelected && (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 text-sm bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 transition-colors"
          >
            {copy.confirm}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}

        {!allSelected && items.some((i) => i.selectedUrl) && (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 text-sm border border-border py-2.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            {copy.skip}
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
                  projectId={projectId}
                  imageParams={imageParams}
                  activeStyle={activeStyle}
                  isPending={pendingImageKeys.has(`character:${item.name}`)}
                  onUpdate={(u) => updateItem(item.name, 'character', u)}
                  onBatchSubmitted={(batchId) => onAddPendingImageBatch(batchId, { name: item.name, type: 'character' })}
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
                  projectId={projectId}
                  imageParams={imageParams}
                  activeStyle={activeStyle}
                  isPending={pendingImageKeys.has(`scene:${item.name}`)}
                  onUpdate={(u) => updateItem(item.name, 'scene', u)}
                  onBatchSubmitted={(batchId) => onAddPendingImageBatch(batchId, { name: item.name, type: 'scene' })}
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
