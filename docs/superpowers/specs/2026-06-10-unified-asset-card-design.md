# 统一资产卡片组件设计

## 背景

资产模块（`/assets`）和创作模块右侧资产面板（`AssetsLibraryTab`）各自实现了独立的卡片组件，外观和行为不一致。需要将两者统一为共享的 `AssetCard` 组件，以创作模块的视觉风格为基准，同时保留资产页的独有功能。

## 方案

提取共享 `AssetCard` 组件，两个模块统一使用。

## 涉及文件

| 文件 | 操作 |
|------|------|
| `components/assets/asset-card.tsx` | 新建 — 共享卡片组件 |
| `components/assets/image-carousel-card.tsx` | 不删除（其他模块可能引用） |
| `components/assets/video-card.tsx` | 不删除（其他模块可能引用） |
| `components/generation/assets-library-tab.tsx` | 改造 — 移除局部 AssetLibraryCard，改用共享组件 |
| `app/(dashboard)/assets/page.tsx` | 改造 — 替换卡片，移除 groupByBatch |

## AssetCard Props

```typescript
interface AssetCardProps {
  asset: AssetItem
  onClick?: (asset: AssetItem) => void
  draggable?: boolean
  onDownload?: () => void
  onReuse?: () => void
  onDelete?: () => void
  isReusing?: boolean
  deleting?: boolean
}
```

## 外观规范

- 比例：`aspect-square`、`rounded-2xl`
- 悬停：黑色半透明遮罩（`bg-black/0` → `group-hover:bg-black/40`）
- 悬停内容：底部 prompt 预览（`text-[11px]`、2行截断）+ 右下角操作按钮
- 视频：播放图标覆盖层（Play icon）
- 图片：`object-cover` 填充
- 删除中：`Loader2` 旋转占位

## 操作按钮

- 下载（Download）：始终显示（创作模块和资产页共用）
- 复用（RotateCcw）：仅资产页，通过 `onReuse` prop 控制
- 删除（Trash2）：仅资产页，通过 `onDelete` prop 控制

## 资产页改动

- 移除 `ImageCarouselCard` / `VideoCard` 的使用，统一用 `AssetCard`
- 移除 `groupByBatch` 函数，改为扁平展示（与创作模块一致）
- 保留：日期筛选、回收站、复用、删除、无限滚动、日期分组标题

## 创作模块改动

- 移除文件内局部 `AssetLibraryCard`
- Import 共享 `AssetCard`
- 传 `draggable`、`onClick`（走 onSelectBatch 逻辑）
- 不传 `onReuse`、`onDelete`

## 数据

统一使用 `AssetItem` 类型（`useAssets` hook 返回），无需额外数据转换。
