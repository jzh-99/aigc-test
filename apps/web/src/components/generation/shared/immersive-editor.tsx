'use client'

import { ImagePlus } from 'lucide-react'
import { MentionEditor } from '@/components/shared/mention-editor'
import type { MentionResource } from '@/components/shared/mention-editor'
import { MediaThumbnailGrid } from './media-thumbnail-grid'
import type { MediaGridItem } from './media-grid-types'

interface ImmersiveEditorProps {
  /** 缩略图网格条目 */
  gridItems: MediaGridItem[]
  /** 是否显示添加按钮 */
  showAddButton: boolean
  /** 添加按钮回调 */
  onAddClick: () => void
  /** 添加按钮禁用状态 */
  addButtonDisabled?: boolean
  /** 删除媒体项回调 */
  onRemoveItem: (id: string) => void
  /** 网格空状态提示文案 */
  gridEmptyText?: string
  /** 网格空状态图标 */
  gridEmptyIcon?: React.ComponentType<{ className?: string }>
  /** 网格空状态点击回调 */
  onGridEmptyClick?: () => void
  /** 网格空状态额外 className */
  gridEmptyClassName?: string

  // MentionEditor props 透传
  /** 文本值（受控） */
  editorValue: string
  /** 文本变更回调 */
  editorOnChange: (v: string) => void
  /** @ 提及资源列表 */
  editorResources: MentionResource[]
  /** 占位文字 */
  editorPlaceholder?: string
  /** 是否禁用编辑器 */
  editorDisabled?: boolean
  /** 编辑器最大字符数；传 null 表示不限长 */
  editorMaxLength?: number | null
  /** 是否显示编辑器字数计数 */
  editorShowCharacterCount?: boolean
  /** @ 标签样式 */
  editorMentionClassName?: (kind: string) => string
  /** @ 标签图标 */
  editorMentionIcon?: (kind: string) => React.ComponentType<{ className?: string }>
  /** 选择器空状态文案 */
  editorEmptyText?: string

  // 容器
  /** 容器额外 className */
  className?: string
  /** 是否禁用整体交互 */
  disabled?: boolean
}

/**
 * 沉浸式编辑器容器
 * 统一缩略图网格 + MentionEditor 文本输入
 * 拖拽覆盖层覆盖整个区域
 */
export function ImmersiveEditor({
  gridItems,
  showAddButton,
  onAddClick,
  addButtonDisabled,
  onRemoveItem,
  gridEmptyText,
  gridEmptyIcon,
  onGridEmptyClick,
  gridEmptyClassName,
  editorValue,
  editorOnChange,
  editorResources,
  editorPlaceholder,
  editorDisabled,
  editorMaxLength,
  editorShowCharacterCount,
  editorMentionClassName,
  editorMentionIcon,
  editorEmptyText,
  className,
  disabled,
}: ImmersiveEditorProps): React.ReactElement {
  return (
    <div className={`flex flex-col flex-1 min-h-0 gap-2${className ? ` ${className}` : ''}`}>
      {/* 缩略图网格区域 */}
      {gridItems.length > 0 && (
        <div className="shrink-0">
          <MediaThumbnailGrid
            items={gridItems}
            showAddButton={showAddButton}
            onAddClick={onAddClick}
            addButtonDisabled={addButtonDisabled ?? disabled}
            onRemoveItem={onRemoveItem}
            emptyText={gridEmptyText}
            emptyIcon={gridEmptyIcon}
            onEmptyClick={onGridEmptyClick}
            emptyClassName={gridEmptyClassName}
          />
        </div>
      )}

      {/* 空状态时：上传引导 + 编辑器 */}
      {gridItems.length === 0 && (
        <MediaThumbnailGrid
          items={[]}
          showAddButton={false}
          onAddClick={onAddClick}
          onRemoveItem={onRemoveItem}
          emptyText={gridEmptyText ?? '点击或拖拽上传素材'}
          emptyIcon={gridEmptyIcon ?? ImagePlus}
          onEmptyClick={onGridEmptyClick ?? onAddClick}
          emptyClassName={gridEmptyClassName}
        />
      )}

      {/* 文本编辑器 */}
      <div className="flex-1 min-h-0">
        <MentionEditor
          value={editorValue}
          onChange={editorOnChange}
          resources={editorResources}
          placeholder={editorPlaceholder}
          className="h-full"
          editorClassName="h-full min-h-full bg-transparent px-0 py-1 rounded-none cursor-text focus:ring-0"
          disabled={editorDisabled ?? disabled}
          maxLength={editorMaxLength}
          showCharacterCount={editorShowCharacterCount}
          mentionClassName={editorMentionClassName}
          mentionIcon={editorMentionIcon}
          emptyText={editorEmptyText}
        />
      </div>
    </div>
  )
}
