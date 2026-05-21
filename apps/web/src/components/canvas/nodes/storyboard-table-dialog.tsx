'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Maximize2, Minimize2, Columns3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ShotItem } from '@/lib/canvas/types'

interface ColumnDef {
  key: keyof ShotItem
  label: string
  width: string
  defaultVisible: boolean
  required: boolean
}

const ALL_COLUMNS: readonly ColumnDef[] = [
  { key: 'shotNumber', label: '镜号', width: 'w-[56px]', defaultVisible: true, required: true },
  { key: 'duration', label: '时长', width: 'w-[56px]', defaultVisible: true, required: false },
  { key: 'shotType', label: '景别', width: 'w-[72px]', defaultVisible: true, required: false },
  { key: 'sceneDescription', label: '场景描述', width: 'min-w-[160px]', defaultVisible: true, required: true },
  { key: 'emotion', label: '情绪', width: 'w-[90px]', defaultVisible: false, required: false },
  { key: 'dialogue', label: '台词', width: 'min-w-[120px]', defaultVisible: false, required: false },
  { key: 'character1', label: '角色1', width: 'w-[100px]', defaultVisible: true, required: false },
  { key: 'characterDesc1', label: '角色描述1', width: 'min-w-[120px]', defaultVisible: false, required: false },
  { key: 'character2', label: '角色2', width: 'w-[100px]', defaultVisible: false, required: false },
  { key: 'characterDesc2', label: '角色描述2', width: 'min-w-[120px]', defaultVisible: false, required: false },
  { key: 'characterAction', label: '角色动作', width: 'w-[90px]', defaultVisible: false, required: false },
  { key: 'lightAtmosphere', label: '光线氛围', width: 'min-w-[120px]', defaultVisible: false, required: false },
  { key: 'soundEffect', label: '音效', width: 'min-w-[100px]', defaultVisible: false, required: false },
  { key: 'sceneTags', label: '场景标签', width: 'w-[120px]', defaultVisible: false, required: false },
  { key: 'compositionPrompt', label: '构图提示词', width: 'min-w-[160px]', defaultVisible: false, required: false },
  { key: 'cameraMotionPrompt', label: '运镜提示词', width: 'min-w-[140px]', defaultVisible: false, required: false },
] as const

/** 默认可见列的 key 集合 */
const DEFAULT_VISIBLE = new Set<string>(
  ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
)

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  shots: ShotItem[]
  title?: string
}

/** 文本截断单元格，hover 显示 tooltip */
function TruncatedCell({ text, maxW = 'max-w-[200px]' }: { text: string; maxW?: string }) {
  if (!text) return <span className="text-muted-foreground/40">—</span>
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span className={cn('block truncate cursor-default', maxW)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** 场景标签渲染为 tag */
function SceneTagsCell({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return <span className="text-muted-foreground/40">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 whitespace-nowrap"
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

/** 渲染单元格内容 */
function CellContent({ shot, column }: { shot: ShotItem; column: ColumnDef }) {
  const value = shot[column.key]

  if (column.key === 'sceneTags') {
    return <SceneTagsCell tags={value as string[]} />
  }

  if (column.key === 'shotNumber') {
    return <span className="font-medium text-violet-600 dark:text-violet-400">{value}</span>
  }

  if (column.key === 'duration') {
    return <span>{value}s</span>
  }

  if (column.key === 'shotType') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 whitespace-nowrap">
        {String(value)}
      </span>
    )
  }

  return <TruncatedCell text={String(value ?? '')} maxW="max-w-[240px]" />
}

export function StoryboardTableDialog({ open, onOpenChange, shots, title = '分镜表' }: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(DEFAULT_VISIBLE)

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => visibleKeys.has(c.key)),
    [visibleKeys],
  )

  const toggleColumn = useCallback((key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col p-0 gap-0 overflow-hidden',
          isFullscreen
            ? 'w-screen h-screen max-w-none max-h-none rounded-none'
            : 'max-w-[90vw] max-h-[85vh] sm:rounded-lg',
        )}
      >
        {/* 顶部标题栏 */}
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0 flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-sm font-medium">
            {title}
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              共 {shots.length} 个镜头
            </span>
          </DialogTitle>

          <div className="flex items-center gap-1">
            {/* 字段显隐 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title="字段设置"
                >
                  <Columns3 size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs">显示字段</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ALL_COLUMNS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={visibleKeys.has(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                    disabled={col.required}
                    className="text-xs"
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 全屏切换 */}
            <button
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title={isFullscreen ? '退出全屏' : '全屏查看'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </DialogHeader>

        {/* 表格区域 */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      col.width,
                      'px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap',
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shots.map((shot, idx) => (
                <tr
                  key={shot.shotNumber}
                  className={cn(
                    'transition-colors',
                    idx % 2 === 0 ? 'bg-background' : 'bg-muted/20',
                    'hover:bg-muted/40',
                  )}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        col.width,
                        'px-3 py-2',
                        col.key === 'shotNumber' && 'text-center',
                        col.key === 'duration' && 'text-center text-muted-foreground',
                      )}
                    >
                      <CellContent shot={shot} column={col} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
