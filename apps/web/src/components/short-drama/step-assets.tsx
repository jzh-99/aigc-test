'use client'

import { useState } from 'react'
import { Loader2, Sparkles, Check, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ShortDramaState, ShortDramaAssetKind } from '@aigc/types'
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

const ASSET_TABS: { id: 'all' | ShortDramaAssetKind; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'character', label: '角色' },
  { id: 'scene', label: '场景' },
  { id: 'prop', label: '道具' },
]

export function StepAssets({ projectId, state, onStateChange }: StepAssetsProps) {
  const [activeTab, setActiveTab] = useState<'all' | ShortDramaAssetKind>('all')
  const [generatingPrompts, setGeneratingPrompts] = useState(false)
  const [generatingImages, setGeneratingImages] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isLocked = state.locks.assets

  const assets = state.assets.items
  const filteredAssets = activeTab === 'all'
    ? assets
    : assets.filter(a => a.kind === activeTab)

  const handleGeneratePrompts = async () => {
    setGeneratingPrompts(true)
    try {
      await generateShortDramaAssetPrompts(projectId)
      onStateChange()
      toast.success('素材描述生成完成')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingPrompts(false)
    }
  }

  const handleBatchGenerate = async () => {
    const pendingAssets = assets.filter(a => !a.imageUrl && a.status !== 'pending')
    if (pendingAssets.length === 0) {
      toast.info('没有需要生成的素材')
      return
    }
    setGeneratingImages(true)
    try {
      await generateShortDramaAssets(projectId, {
        assetIds: pendingAssets.map(a => a.id),
        scope: 'global',
      })
      onStateChange()
      toast.success(`已提交 ${pendingAssets.length} 个素材生成`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingImages(false)
    }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          locks: { ...state.locks, assets: true },
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
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {ASSET_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {!isLocked && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleGeneratePrompts} disabled={generatingPrompts}>
              {generatingPrompts ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              生成描述
            </Button>
            <Button size="sm" variant="outline" onClick={handleBatchGenerate} disabled={generatingImages}>
              {generatingImages ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
              批量生图
            </Button>
          </div>
        )}
      </div>

      {filteredAssets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          暂无素材，点击「生成描述」开始
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredAssets.map(asset => (
            <div key={asset.id} className="rounded-lg border p-3 space-y-2">
              <div className="aspect-square bg-muted rounded-md flex items-center justify-center overflow-hidden">
                {asset.imageUrl ? (
                  <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {asset.status === 'pending' ? '生成中...' : '待生成'}
                  </span>
                )}
              </div>
              <div className="text-xs font-medium line-clamp-1">{asset.name}</div>
              <div className="text-xs text-muted-foreground line-clamp-2">{asset.description}</div>
            </div>
          ))}
        </div>
      )}

      {!isLocked && assets.length > 0 && (
        <Button onClick={handleConfirm} disabled={confirming} className="w-full">
          {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          确认素材，进入分集
        </Button>
      )}

      {isLocked && (
        <div className="text-center text-sm text-muted-foreground py-4">
          素材已锁定确认
        </div>
      )}
    </div>
  )
}
