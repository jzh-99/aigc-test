'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ShortDramaAsset } from '@aigc/types'
import { uploadShortDramaImage, uploadShortDramaAsset } from '@/lib/short-drama/api'

interface AssetLibraryPanelProps {
  assets: ShortDramaAsset[]
  episodeNumber: number
  projectId: string
  /** 当前集分镜中引用到的素材 ID 集合，用于"本集"过滤 */
  episodeMentionedAssetIds: Set<string>
  onStateChange: () => void
}

// 最大上传文件大小 10MB
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024
// 支持的图片类型
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function AssetLibraryPanel({ assets, episodeNumber, projectId, episodeMentionedAssetIds, onStateChange }: AssetLibraryPanelProps) {
  const [activeKind, setActiveKind] = useState<'character' | 'scene' | 'requisite'>('character')
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  // 是否展示全部素材（关闭时只展示本集）
  const [showAll, setShowAll] = useState(false)

  // 上传对话框状态
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadKind, setUploadKind] = useState<'character' | 'scene' | 'requisite'>('character')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 根据开关状态过滤素材：本集 = 当前集分镜中引用的素材，全部 = 所有素材
  const relevantAssets = assets.filter(
    asset => asset.kind === 'character' || asset.kind === 'scene' || asset.kind === 'requisite'
  )
  const allAssets = showAll
    ? relevantAssets
    : relevantAssets.filter(asset => episodeMentionedAssetIds.has(asset.id))
  const filteredAssets = allAssets.filter(asset => asset.kind === activeKind)
  const characterCount = allAssets.filter(asset => asset.kind === 'character').length
  const sceneCount = allAssets.filter(asset => asset.kind === 'scene').length
  const requisiteCount = allAssets.filter(asset => asset.kind === 'requisite').length
  const previewAsset = previewAssetId ? allAssets.find(asset => asset.id === previewAssetId) : null
  const imageFitClass = activeKind === 'character' ? 'object-contain' : 'object-cover'

  // 打开上传对话框
  const handleUploadClick = () => {
    setUploadFile(null)
    setUploadPreview(null)
    setUploadName('')
    setUploadKind(activeKind) // 默认选中当前 tab 的类别
    setUploadOpen(true)
  }

  // 选择文件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 校验文件类型
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error('仅支持 JPG/PNG/WEBP 格式')
      return
    }

    // 校验文件大小
    if (file.size > MAX_UPLOAD_SIZE) {
      toast.error('图片大小不能超过 10MB')
      return
    }

    setUploadFile(file)
    setUploadPreview(URL.createObjectURL(file))
    // 自动用文件名（去掉后缀）作为默认名称
    setUploadName(file.name.replace(/\.[^.]+$/, ''))

    // 清空 input 以便重复选择同名文件
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // 确认上传
  const handleUploadConfirm = async () => {
    if (!uploadFile) {
      toast.error('请先选择图片')
      return
    }
    if (!uploadName.trim()) {
      toast.error('请输入素材名称')
      return
    }

    setUploading(true)
    try {
      // 第 1 步：上传图片文件到 TOS
      const { url } = await uploadShortDramaImage(projectId, uploadFile)

      // 第 2 步：创建素材记录（全局素材，可在任意集引用）
      await uploadShortDramaAsset(projectId, {
        storageKey: url,
        scope: 'global',
        name: uploadName.trim(),
        kind: uploadKind,
      })

      toast.success(`素材「${uploadName.trim()}」上传成功`)
      setUploadOpen(false)
      onStateChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <aside className="rounded-2xl border bg-card/80 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-sm font-semibold">素材库</h3>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              id="show-all-assets"
              checked={showAll}
              onCheckedChange={setShowAll}
            />
            <label
              htmlFor="show-all-assets"
              className="min-w-6 cursor-pointer select-none text-[11px] text-muted-foreground"
            >
              {showAll ? '全部' : '本集'}
            </label>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={handleUploadClick}
        >
          <Upload className="h-3 w-3" />
          上传
        </Button>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { id: 'character' as const, label: '角色', count: characterCount },
          { id: 'scene' as const, label: '场景', count: sceneCount },
          { id: 'requisite' as const, label: '道具', count: requisiteCount },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveKind(tab.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              activeKind === tab.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label} {tab.count}
          </button>
        ))}
      </div>
      {allAssets.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无素材</p>
      ) : (
        <div className={`grid max-h-[calc(100vh-18rem)] gap-2 overflow-y-auto pr-1 ${
          activeKind === 'character' ? 'grid-cols-2' : 'grid-cols-1'
        }`}>
          {filteredAssets.map(asset => (
            <button
              key={asset.id}
              type="button"
              onClick={() => asset.imageUrl && setPreviewAssetId(asset.id)}
              disabled={!asset.imageUrl}
              className={`flex h-full flex-col overflow-hidden rounded-xl border bg-background/60 text-left shadow-sm transition-colors hover:border-primary/30 disabled:cursor-default disabled:hover:border-border ${
                activeKind === 'character' ? 'min-h-[196px]' : 'min-h-[164px]'
              }`}
              aria-label={asset.imageUrl ? `放大查看${asset.name}` : asset.name}
            >
              <div className={`group relative block w-full shrink-0 overflow-hidden bg-slate-900/70 text-left ${
                activeKind === 'character' ? 'h-36' : 'aspect-video h-auto'
              }`}>
                {/* <span className={`absolute left-1.5 top-1.5 z-10 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm ${
                  asset.imageUrl
                    ? 'bg-emerald-500/15 text-emerald-200'
                    : 'bg-slate-800 text-slate-300'
                }`}>
                  {asset.imageUrl ? '已出图' : '未出图'}
                </span> */}
                {asset.imageUrl ? (
                  <>
                    <img src={asset.imageUrl} alt={asset.name} className={`h-full w-full transition-transform duration-300 group-hover:scale-105 ${imageFitClass}`} />
                    <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                  </>
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
                    暂无图片
                  </span>
                )}
              </div>
              <div className="flex h-12 shrink-0 items-start p-2">
                <div className="line-clamp-2 text-xs font-semibold leading-4 text-foreground">{asset.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {previewAsset?.imageUrl && (
        <ImageLightbox
          url={previewAsset.imageUrl}
          alt={previewAsset.name}
          onClose={() => setPreviewAssetId(null)}
          footer={
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{previewAsset.name}</div>
            </div>
          }
        />
      )}

      {/* 上传素材对话框 */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>上传素材</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* 文件选择区域 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">选择图片</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground file:cursor-pointer hover:file:bg-primary/90"
              />
              <p className="text-[11px] text-muted-foreground">支持 JPG/PNG/WEBP，最大 10MB</p>
            </div>

            {/* 图片预览 */}
            {uploadPreview && (
              <div className="flex justify-center">
                <img
                  src={uploadPreview}
                  alt="预览"
                  className="max-h-48 rounded-lg border object-contain"
                />
              </div>
            )}

            {/* 素材名称 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">素材名称</label>
              <input
                type="text"
                value={uploadName}
                onChange={e => setUploadName(e.target.value)}
                placeholder="输入素材名称"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
                maxLength={200}
              />
            </div>

            {/* 素材类别选择 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">素材类别</label>
              <div className="flex gap-2">
                {[
                  { id: 'character' as const, label: '角色' },
                  { id: 'scene' as const, label: '场景' },
                  { id: 'requisite' as const, label: '道具' },
                ].map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setUploadKind(option.id)}
                    disabled={uploading}
                    className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      uploadKind === option.id
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 归属信息 */}
            <p className="text-[11px] text-muted-foreground">
              将上传为全局{uploadKind === 'character' ? '角色' : uploadKind === 'scene' ? '场景' : '道具'}素材，可在任意集引用
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>
              取消
            </Button>
            <Button onClick={handleUploadConfirm} disabled={uploading || !uploadFile || !uploadName.trim()}>
              {uploading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {uploading ? '上传中...' : '确认上传'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
