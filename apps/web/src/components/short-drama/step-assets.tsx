'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Loader2, Sparkles, Check, Upload, ZoomIn } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import type { ShortDramaState, ShortDramaAsset, ShortDramaAssetKind } from '@aigc/types'
import { areShortDramaAssetsReady } from '@aigc/types'
import {
  generateShortDramaAssetPrompts,
  generateShortDramaAssets,
  saveShortDramaProject,
} from '@/lib/short-drama/api'

interface StepAssetsProps {
  projectId: string
  state: ShortDramaState
  onStateChange: () => void
}

const ASSET_TABS: { id: ShortDramaAssetKind; label: string }[] = [
  { id: 'character', label: '角色' },
  { id: 'scene', label: '场景' },
  { id: 'requisite', label: '道具' },
]

function AssetImagePreview({
  asset,
  src,
  fitClass,
  onPreview,
}: {
  asset: ShortDramaAsset
  src: string
  fitClass: string
  onPreview: () => void
}) {
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading')

  useEffect(() => {
    setLoadState('loading')
  }, [src])

  return (
    <button
      type="button"
      onClick={onPreview}
      disabled={loadState !== 'loaded'}
      className="group relative h-full w-full overflow-hidden text-left disabled:cursor-default"
      aria-label={loadState === 'loaded' ? `放大查看${asset.name}` : `${asset.name}图片加载中`}
    >
      {loadState !== 'loaded' && (
        <span className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-muted/55 text-xs text-muted-foreground dark:bg-slate-900/75">
          {loadState === 'loading' ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-primary/70" />
              图片加载中
            </>
          ) : (
            <>
              <ImageIcon className="h-5 w-5 text-muted-foreground/70" />
              图片暂不可用
            </>
          )}
        </span>
      )}
      <img
        src={src}
        alt={asset.name}
        onLoad={() => setLoadState('loaded')}
        onError={() => setLoadState('error')}
        className={`h-full w-full transition-transform duration-300 group-hover:scale-105 ${fitClass} ${loadState === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
      />
      {loadState === 'loaded' && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
          <span className="flex h-10 w-10 scale-90 items-center justify-center rounded-full bg-black/55 text-white opacity-0 shadow-lg backdrop-blur-sm transition-all group-hover:scale-100 group-hover:opacity-100">
            <ZoomIn className="h-5 w-5" />
          </span>
        </span>
      )}
    </button>
  )
}

export function StepAssets({ projectId, state, onStateChange }: StepAssetsProps) {
  const [activeTab, setActiveTab] = useState<ShortDramaAssetKind>('character')
  const [generatingPrompts, setGeneratingPrompts] = useState(false)
  const [generatingImages, setGeneratingImages] = useState(false)
  const [generatingAssetId, setGeneratingAssetId] = useState<string | null>(null)
  const [submittedAssetIds, setSubmittedAssetIds] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const [assetPromptStreamText, setAssetPromptStreamText] = useState('')
  const [assetPromptProgressMessage, setAssetPromptProgressMessage] = useState('')
  const [assetPromptWarningMessage, setAssetPromptWarningMessage] = useState('')
  const autoPromptKeyRef = useRef<string | null>(null)
  const isLocked = state.locks.assets

  const assets = state.assets.items
  const assetsReady = areShortDramaAssetsReady(state)
  const requiredAssets = assets.filter(asset => asset.kind === 'character' || asset.kind === 'scene' || asset.kind === 'requisite')
  const completedRequiredAssets = requiredAssets.filter(asset => asset.status === 'completed' && !!asset.imageUrl).length
  const getKindProgress = (kind: ShortDramaAssetKind) => {
    const kindAssets = assets.filter(asset => asset.kind === kind)
    const completed = kindAssets.filter(asset => asset.status === 'completed' && !!asset.imageUrl).length
    return { completed, total: kindAssets.length }
  }
  const processedOutlineCount = state.assets.processedOutlineCount
  const totalOutlineCount = state.script.outlines.length
  const isAssetPromptGenerating = state.assets.status === 'generating'
  const canContinuePrompts = processedOutlineCount > 0 && processedOutlineCount < totalOutlineCount
  const promptButtonText = processedOutlineCount >= totalOutlineCount && totalOutlineCount > 0
    ? '描述已生成'
    : canContinuePrompts
      ? '继续生成描述'
      : '生成描述'
  const filteredAssets = assets.filter(a => a.kind === activeTab)
  const previewAsset = previewAssetId ? assets.find(asset => asset.id === previewAssetId) : null

  const getAssetGenerationLabel = (asset: (typeof assets)[number]) => {
    if (generatingAssetId === asset.id) return '提交中...'
    if (submittedAssetIds.has(asset.id)) return '任务已提交'
    if (asset.status === 'pending') return '任务已提交'
    if (asset.status === 'generating') return '生成中...'
    if (asset.status === 'failed') return '生成失败'
    return '待生成'
  }

  useEffect(() => {
    setSubmittedAssetIds((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const asset of assets) {
        if (!next.has(asset.id)) continue
        if (asset.status === 'pending' || asset.status === 'generating') continue
        next.delete(asset.id)
        changed = true
      }
      return changed ? next : prev
    })
  }, [assets])

  const handleGeneratePrompts = async () => {
    setGeneratingPrompts(true)
    setAssetPromptStreamText('')
    setAssetPromptProgressMessage('')
    setAssetPromptWarningMessage('')
    try {
      const result = await generateShortDramaAssetPrompts(projectId, {
        onChunk: (text) => setAssetPromptStreamText((prev) => `${prev}${text}`),
        onProgress: (progress) => setAssetPromptProgressMessage(progress.message),
        onWarning: (warning) => {
          setAssetPromptWarningMessage(warning.message)
          toast.warning(warning.message)
        },
      })
      onStateChange()
      if (result.partial) {
        toast.warning(result.warning ?? '素材描述已部分生成，请补充 A豆后继续生成')
      } else {
        toast.success('素材描述生成完成')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingPrompts(false)
    }
  }

  useEffect(() => {
    const autoPromptKey = `${projectId}:${processedOutlineCount}:${totalOutlineCount}`
    const shouldAutoGenerate =
      !isLocked &&
      totalOutlineCount > 0 &&
      processedOutlineCount < totalOutlineCount &&
      !isAssetPromptGenerating &&
      !generatingPrompts &&
      autoPromptKeyRef.current !== autoPromptKey

    if (!shouldAutoGenerate) return

    autoPromptKeyRef.current = autoPromptKey
    void handleGeneratePrompts()
  }, [projectId, isLocked, processedOutlineCount, totalOutlineCount, isAssetPromptGenerating, generatingPrompts])

  const handleGenerateOne = async (assetId: string) => {
    const targetAsset = assets.find(asset => asset.id === assetId)
    if (!targetAsset) {
      toast.error('素材不存在，请刷新页面后重试')
      return
    }
    if (!targetAsset.description.trim()) {
      toast.warning('请先补充素材描述')
      return
    }

    setGeneratingAssetId(assetId)
    try {
      await generateShortDramaAssets(projectId, {
        assetIds: [assetId],
        scope: 'global',
      })
      setSubmittedAssetIds((prev) => new Set(prev).add(assetId))
      onStateChange()
      toast.success(`已提交「${targetAsset.name}」生成`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingAssetId(null)
    }
  }

  const handleDescriptionBlur = async (assetId: string, value: string) => {
    const nextDescription = value.trim()
    const targetAsset = assets.find(asset => asset.id === assetId)
    if (!targetAsset || targetAsset.description === nextDescription) return

    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          assets: {
            ...state.assets,
            items: assets.map(asset =>
              asset.id === assetId ? { ...asset, description: nextDescription } : asset
            ),
          },
        },
      })
      onStateChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存描述失败')
    }
  }

  const handleNameBlur = async (assetId: string, value: string) => {
    const nextName = value.trim()
    if (!nextName) {
      toast.error('名称不能为空')
      return
    }

    const targetAsset = assets.find(asset => asset.id === assetId)
    if (!targetAsset || targetAsset.name === nextName) return

    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          assets: {
            ...state.assets,
            items: assets.map(asset =>
              asset.id === assetId ? { ...asset, name: nextName } : asset
            ),
          },
        },
      })
      onStateChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存名称失败')
    }
  }

  const handleAliasesBlur = async (assetId: string, value: string) => {
    const nextAliases = Array.from(new Set(
      value
        .split(/[,\n，、;；/|]+/)
        .map(alias => alias.trim())
        .filter(Boolean)
    ))
    const targetAsset = assets.find(asset => asset.id === assetId)
    if (!targetAsset) return

    const currentAliases = targetAsset.aliases ?? []
    if (currentAliases.join('\n') === nextAliases.join('\n')) return

    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          assets: {
            ...state.assets,
            items: assets.map(asset =>
              asset.id === assetId ? { ...asset, aliases: nextAliases } : asset
            ),
          },
        },
      })
      onStateChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存别名失败')
    }
  }

  const handleBatchGenerate = async () => {
    // 过滤出需要生成的素材：没有图片 且 状态不是 pending/generating
    const pendingAssets = requiredAssets.filter(a =>
      !a.imageUrl &&
      a.status !== 'pending' &&
      a.status !== 'generating'
    )

    if (pendingAssets.length === 0) {
      toast.info('没有需要生成的素材')
      return
    }

    // 验证 assetIds 是否有效
    const assetIds = pendingAssets.map(a => a.id).filter(id => typeof id === 'string' && id.length > 0)

    if (assetIds.length === 0) {
      toast.error('素材数据异常，请刷新页面后重试')
      return
    }

    setGeneratingImages(true)
    try {
      // 后端限制每批最多 20 个素材，需要分批提交
      const BATCH_SIZE = 20
      const batches: string[][] = []
      for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
        batches.push(assetIds.slice(i, i + BATCH_SIZE))
      }

      // 依次提交每批素材
      for (let i = 0; i < batches.length; i++) {
        await generateShortDramaAssets(projectId, {
          assetIds: batches[i],
          scope: 'global',
        })
      }

      onStateChange()
      toast.success(`已提交 ${assetIds.length} 个素材生成${batches.length > 1 ? `（分 ${batches.length} 批）` : ''}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingImages(false)
    }
  }

  const handleConfirm = async () => {
    if (!assetsReady) {
      toast.warning('角色、场景和道具图全部生成结束后，才能进入分集')
      return
    }
    setConfirming(true)
    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          locks: { ...state.locks, assets: true },
          assets: { ...state.assets, status: 'completed' },
          steps: { active: 'episodes', completed: [...state.steps.completed, 'assets'] },
        },
      })
      onStateChange()
      toast.success('素材已确认')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '确认失败')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-950">角色、场景与道具素材</p>
            <p className="mt-1 text-xs text-muted-foreground">
              已完成 {completedRequiredAssets} / {requiredAssets.length}，全部出图后才能进入分集制作
            </p>
          </div>
          <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-medium ${
            assetsReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {assetsReady ? '素材已准备好' : '等待素材出图'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {ASSET_TABS.map(tab => (
              (() => {
                const progress = getKindProgress(tab.id)
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                      activeTab === tab.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] leading-none ${
                      activeTab === tab.id ? 'bg-white/18 text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                      {progress.completed}/{progress.total}
                    </span>
                  </button>
                )
              })()
            ))}
          </div>
          {!isLocked && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleGeneratePrompts} disabled={generatingPrompts}>
                {generatingPrompts ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                {promptButtonText}
              </Button>
              <Button size="sm" variant="outline" onClick={handleBatchGenerate} disabled={generatingImages}>
                {generatingImages ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
                批量生图
              </Button>
            </div>
          )}
        </div>
      </div>

      {assetPromptWarningMessage && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-medium">生成已暂停</div>
          <p className="mt-1">{assetPromptWarningMessage}</p>
          <p className="mt-1 text-xs">
            已提取 {processedOutlineCount} / {totalOutlineCount} 集，可补充 A豆后继续生成剩余集数的角色、场景和道具。
          </p>
        </div>
      )}

      {generatingPrompts && assetPromptProgressMessage && (
        <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
          {assetPromptProgressMessage}
        </div>
      )}

      {generatingPrompts && assetPromptStreamText && (
        <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
          {assetPromptStreamText}
        </div>
      )}

      {filteredAssets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          暂无角色、场景或道具素材
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredAssets.map(asset => {
            const isAssetGenerating =
              generatingAssetId === asset.id ||
              submittedAssetIds.has(asset.id) ||
              asset.status === 'pending' ||
              asset.status === 'generating'
            const generationLabel = getAssetGenerationLabel(asset)
            const shouldShowImage = Boolean(asset.imageUrl) && !isAssetGenerating
            const isCharacter = asset.kind === 'character'
            const imageSrc = asset.imageUrl ? `${asset.imageUrl}?t=${new Date(asset.updatedAt).getTime()}` : ''

            return (
            <div key={asset.id} className="overflow-hidden rounded-xl border bg-card shadow-sm transition-colors hover:border-primary/30">
              <div className={`${isCharacter ? 'aspect-[9/16]' : 'aspect-video'} flex items-center justify-center overflow-hidden bg-muted/40 dark:bg-slate-900/70`}>
                {shouldShowImage ? (
                  <AssetImagePreview
                    asset={asset}
                    src={imageSrc}
                    fitClass={isCharacter ? 'object-contain' : 'object-cover'}
                    onPreview={() => setPreviewAssetId(asset.id)}
                  />
                ) : (
                  <span className="rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                    {generationLabel}
                  </span>
                )}
              </div>
              <div className="space-y-2 p-3">
                <input
                  defaultValue={asset.name}
                  onBlur={e => handleNameBlur(asset.id, e.target.value)}
                  disabled={isLocked}
                  className="h-7 w-full rounded-md border border-transparent bg-transparent px-1 text-xs font-semibold text-foreground outline-none transition-colors hover:border-border focus:border-primary/40 focus:bg-background disabled:cursor-not-allowed disabled:opacity-70"
                  aria-label={`${asset.name}名称`}
                />
                <textarea
                  defaultValue={asset.description}
                  onBlur={e => handleDescriptionBlur(asset.id, e.target.value)}
                  disabled={isLocked}
                  className="min-h-[56px] w-full resize-none rounded-lg border border-transparent bg-muted/40 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground outline-none transition-colors hover:border-border focus:border-primary/40 focus:bg-background disabled:cursor-not-allowed disabled:opacity-70"
                  aria-label={`${asset.name}描述`}
                />
                {asset.kind === 'character' && (
                  <input
                    defaultValue={(asset.aliases ?? []).join('、')}
                    onBlur={e => handleAliasesBlur(asset.id, e.target.value)}
                    disabled={isLocked}
                    placeholder="别名：祁同伟、祁厅长、老祁"
                    className="h-7 w-full rounded-md border border-transparent bg-muted/30 px-2 text-xs text-muted-foreground outline-none transition-colors hover:border-border focus:border-primary/40 focus:bg-background disabled:cursor-not-allowed disabled:opacity-70"
                    aria-label={`${asset.name}别名`}
                  />
                )}
                {!isLocked && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleGenerateOne(asset.id)}
                    disabled={isAssetGenerating || generatingImages}
                    className="h-8 w-full text-xs"
                  >
                    {isAssetGenerating ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {isAssetGenerating ? generationLabel : asset.kind === 'scene' ? '生成场景' : asset.kind === 'requisite' ? '生成道具' : '生成形象'}
                  </Button>
                )}
              </div>
            </div>
          )})}
        </div>
      )}

      {!isLocked && assets.length > 0 && (
        <Button onClick={handleConfirm} disabled={confirming || !assetsReady} className="w-full">
          {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          {assetsReady ? '确认素材，进入分集' : '等待角色、场景和道具全部生成'}
        </Button>
      )}

      {isLocked && assetsReady && (
        <div className="text-center text-sm text-muted-foreground py-4">
          素材已锁定确认
        </div>
      )}

      {isLocked && !assetsReady && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-center text-sm text-amber-800">
          素材已确认过，但仍有角色、场景或道具图未完成，请等待全部生成结束后再进入分集
        </div>
      )}

      {previewAsset?.imageUrl && (
        <ImageLightbox
          url={`${previewAsset.imageUrl}?t=${new Date(previewAsset.updatedAt).getTime()}`}
          alt={previewAsset.name}
          onClose={() => setPreviewAssetId(null)}
          footer={
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{previewAsset.name}</div>
              <div className="mt-1 line-clamp-2 text-xs text-white/60">{previewAsset.description}</div>
            </div>
          }
        />
      )}
    </div>
  )
}
