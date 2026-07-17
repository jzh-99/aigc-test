# 统一资产卡片组件 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将资产页和创作模块的资产卡片统一为共享 `AssetCard` 组件，以创作模块的视觉风格为基准。

**Architecture:** 新建 `components/assets/asset-card.tsx` 共享卡片组件，扩展自创作模块的 `AssetLibraryCard`。资产页和创作模块分别 import 使用，通过可选 props 区分功能差异。

**Tech Stack:** React 18、TypeScript、Tailwind CSS、Lucide React 图标

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `components/assets/asset-card.tsx` | 共享卡片组件 |
| 修改 | `components/generation/assets-library-tab.tsx` | 移除局部 AssetLibraryCard，改用共享组件 |
| 修改 | `app/(dashboard)/assets/page.tsx` | 替换卡片组件，移除 groupByBatch |

以下路径均相对于 `apps/web/src/`。

---

### Task 1: 新建共享 AssetCard 组件

**Files:**
- Create: `components/assets/asset-card.tsx`

- [ ] **Step 1: 创建 AssetCard 组件文件**

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { Play, Film, ImageIcon, Download, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import { downloadImage } from '@/lib/download'
import type { AssetItem } from '@/hooks/use-assets'

export interface AssetCardProps {
  /** 资产数据 */
  asset: AssetItem
  /** 点击卡片主体回调 */
  onClick?: (asset: AssetItem) => void
  /** 是否可拖拽（创作模块使用） */
  draggable?: boolean
  /** 下载回调，不传则使用内置下载 */
  onDownload?: () => void
  /** 复用回调（资产页使用） */
  onReuse?: () => void
  /** 删除回调（资产页使用） */
  onDelete?: () => void
  /** 是否正在复用中 */
  isReusing?: boolean
  /** 是否正在删除中 */
  deleting?: boolean
}

/** 统一资产卡片 — 图片/视频共用，支持拖拽、复用、删除等可选操作 */
export function AssetCard({
  asset,
  onClick,
  draggable,
  onDownload,
  onReuse,
  onDelete,
  isReusing,
  deleting,
}: AssetCardProps) {
  const url = asset.storage_url ?? asset.original_url
  if (!url) return null

  const thumbUrl = asset.thumbnail_url ?? url
  const isVideo = asset.type === 'video'

  // 删除中状态：显示旋转占位
  if (deleting) {
    return (
      <div className="aspect-square rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-white/20" />
      </div>
    )
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDownload) {
      onDownload()
    } else {
      downloadImage(url, isVideo ? 'video' : 'image')
    }
  }

  return (
    <div
      draggable={draggable}
      onClick={() => onClick?.(asset)}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData('application/x-aigc-asset-url', url)
              e.dataTransfer.setData('application/x-aigc-asset-type', asset.type)
              e.dataTransfer.setData('text/uri-list', url)
              e.dataTransfer.setData('text/plain', url)
              e.dataTransfer.effectAllowed = 'copy'
            }
          : undefined
      }
      className="group relative aspect-square rounded-2xl overflow-hidden border border-white/[0.06] bg-muted cursor-pointer active:cursor-grabbing"
      title={draggable ? '拖拽到左侧支持的参考区域' : undefined}
    >
      {/* 内容区域 */}
      {isVideo ? (
        <div className="absolute inset-0 bg-black flex items-center justify-center">
          <video
            src={url}
            className="absolute inset-0 w-full h-full object-cover opacity-60"
            muted
            preload="metadata"
          />
          <Play className="relative z-10 h-8 w-8 text-white drop-shadow-lg" />
        </div>
      ) : (
        <Image
          src={thumbUrl}
          alt={asset.batch.prompt || '图片资产'}
          fill
          className="object-cover"
          sizes="200px"
          unoptimized
        />
      )}

      {/* 悬停遮罩 + 内容 */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
          {/* prompt 预览 */}
          <p className="text-[11px] text-white line-clamp-2 leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            {asset.batch.prompt || (isVideo ? '视频资产' : '图片资产')}
          </p>

          {/* 类型标签 — 仅创作模块卡片显示 */}
          {draggable && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-white/70">
              {isVideo ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
              <span>拖拽作为参考</span>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="absolute bottom-2 right-2 flex gap-1">
            {/* 复用 */}
            {onReuse && (
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-full bg-black/50 hover:bg-black/70 text-white border-0 transition disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation()
                  onReuse()
                }}
                disabled={isReusing}
                title="复用"
              >
                {isReusing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {/* 删除 */}
            {onDelete && (
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-full bg-black/50 hover:bg-red-600/70 text-white border-0 transition"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {/* 下载 */}
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-full bg-black/50 hover:bg-black/70 text-white border-0 transition"
              onClick={handleDownload}
              title="下载"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/assets/asset-card.tsx
git commit -m "feat: 新建共享 AssetCard 统一资产卡片组件"
```

---

### Task 2: 改造创作模块 AssetsLibraryTab

**Files:**
- Modify: `components/generation/assets-library-tab.tsx`

- [ ] **Step 1: 替换 import 和移除局部 AssetLibraryCard**

在文件顶部添加 import：
```tsx
import { AssetCard } from '@/components/assets/asset-card'
```

移除文件底部的局部 `AssetLibraryCard` 函数（约第 160-212 行）。

- [ ] **Step 2: 替换卡片渲染**

将 `assets-library-tab.tsx` 中第 82-86 行的：
```tsx
{assets.map((asset) => (
  <AssetLibraryCard key={asset.id} asset={asset} onOpenPreview={handleOpenPreview} />
))}
```

替换为：
```tsx
{assets.map((asset) => (
  <AssetCard
    key={asset.id}
    asset={asset}
    draggable
    onClick={handleOpenPreview}
  />
))}
```

- [ ] **Step 3: 清理不再使用的 import**

移除不再需要的 import（`Image`、`ImageIcon`、`Play`、`Film`、`Download`、`Button` 中按需保留）。

保留的 import：
- `Loader2`、`ChevronDown` — 加载更多按钮
- `Button` — 加载更多按钮
- `useAssets`、`AssetItem` — 数据
- `useTeamFeatures` — 视频标签
- `useState` — 状态
- `ImageLightbox`、`Dialog`、`DialogContent` — 弹窗
- `downloadImage` — 弹窗内下载

移除的 import：
- `Image`（next/image）
- `ImageIcon`、`Play`、`Film`、`Download`（lucide-react）

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/generation/assets-library-tab.tsx
git commit -m "refactor: 创作模块资产面板改用共享 AssetCard"
```

---

### Task 3: 改造资产页 Assets Page

**Files:**
- Modify: `app/(dashboard)/assets/page.tsx`

- [ ] **Step 1: 替换 import**

移除：
```tsx
import { ImageCarouselCard } from '@/components/assets/image-carousel-card'
import { VideoCard } from '@/components/assets/video-card'
```

添加：
```tsx
import { AssetCard } from '@/components/assets/asset-card'
```

- [ ] **Step 2: 移除 groupByBatch 函数和 BatchGroup 接口**

移除第 39-69 行的 `BatchGroup` 接口和 `groupByBatch` 函数。

- [ ] **Step 3: 移除 handleEnlargeById 函数**

移除第 126-129 行的 `handleEnlargeById` 函数（不再需要，`AssetCard` 的 `onClick` 直接传 `asset` 对象）。

- [ ] **Step 4: 替换卡片渲染区域**

将第 279-319 行的日期分组内的卡片渲染：
```tsx
{grouped.map(({ date, items }) => {
  const batchGroups = assetType === 'image' ? groupByBatch(items) : null
  return (
  <section key={date}>
    <div className="asset-date-heading">
      <h3 className="text-[13px] font-medium tracking-wide text-white/35 whitespace-nowrap">{date}</h3>
      <span className="text-[11px] text-white/18">{items.length} 个</span>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {assetType === 'image' && batchGroups
        ? batchGroups.map((group) => (
            <ImageCarouselCard
              key={group.batchId}
              images={group.images}
              onImageClick={handleEnlargeById}
              onDelete={handleDelete}
              onReuse={handleReuse}
              isReusing={group.images.some((img) => reusingId === img.id)}
              deletingId={deletingId}
            />
          ))
        : items.map((asset) =>
            deletingId === asset.id ? (
              <div key={asset.id} className="aspect-video rounded-[10px] border bg-muted flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <VideoCard
                key={asset.id}
                asset={asset}
                onPlay={handleEnlarge}
                onDelete={handleDelete}
                onReuse={handleReuse}
                isReusing={reusingId === asset.id}
              />
            )
          )}
    </div>
  </section>
  )
})}
```

替换为：
```tsx
{grouped.map(({ date, items }) => (
  <section key={date}>
    <div className="asset-date-heading">
      <h3 className="text-[13px] font-medium tracking-wide text-white/35 whitespace-nowrap">{date}</h3>
      <span className="text-[11px] text-white/18">{items.length} 个</span>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          onClick={handleEnlarge}
          onDelete={() => handleDelete(asset.id)}
          onReuse={() => handleReuse(asset)}
          isReusing={reusingId === asset.id}
          deleting={deletingId === asset.id}
        />
      ))}
    </div>
  </section>
))}
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app/\(dashboard\)/assets/page.tsx
git commit -m "refactor: 资产页卡片统一使用共享 AssetCard 组件"
```

---

## 自检清单

- [x] **Spec 覆盖**：共享组件（Task 1）✓、创作模块改造（Task 2）✓、资产页改造（Task 3）✓
- [x] **无占位符**：所有步骤包含完整代码
- [x] **类型一致性**：`AssetCardProps` 在 Task 1 定义，Task 2/3 使用一致的 props 名称（`onClick`、`draggable`、`onDelete`、`onReuse`、`isReusing`、`deleting`）
- [x] **无破坏性变更**：`ImageCarouselCard` 和 `VideoCard` 组件文件保留不删，`video-studio/step-video.tsx` 不受影响
