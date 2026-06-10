'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogClose,
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
import { Clapperboard, Columns3, Maximize2, Minimize2, TableProperties, X } from 'lucide-react'
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
  { key: 'dialogue', label: '台词', width: 'min-w-[120px]', defaultVisible: true, required: false },
  { key: 'character1', label: '角色1', width: 'w-[100px]', defaultVisible: true, required: false },
  { key: 'characterDesc1', label: '角色描述1', width: 'min-w-[120px]', defaultVisible: true, required: false },
  { key: 'character2', label: '角色2', width: 'w-[100px]', defaultVisible: false, required: false },
  { key: 'characterDesc2', label: '角色描述2', width: 'min-w-[120px]', defaultVisible: false, required: false },
  { key: 'characterAction', label: '角色动作', width: 'w-[90px]', defaultVisible: false, required: false },
  { key: 'lightAtmosphere', label: '光线氛围', width: 'min-w-[120px]', defaultVisible: false, required: false },
  { key: 'soundEffect', label: '音效', width: 'min-w-[100px]', defaultVisible: false, required: false },
  { key: 'sceneTags', label: '场景标签', width: 'w-[120px]', defaultVisible: false, required: false },
  { key: 'compositionPrompt', label: '构图提示词', width: 'min-w-[160px]', defaultVisible: false, required: false },
  { key: 'cameraMotionPrompt', label: '运镜提示词', width: 'min-w-[140px]', defaultVisible: true, required: false },
] as const

/** 默认可见列的 key 集合 */
const DEFAULT_VISIBLE = new Set<string>(
  ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
)

const TOOL_BUTTON_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/60'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  shots: ShotItem[]
  title?: string
}

/** 文本截断单元格，hover 显示 tooltip */
function TruncatedCell({ text, maxW = 'max-w-[200px]' }: { text: string; maxW?: string }) {
  if (!text) return <span className="text-muted-foreground/35">—</span>
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span className={cn('block truncate cursor-default leading-relaxed', maxW)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="z-[80] max-w-xs whitespace-pre-wrap text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** 场景标签渲染为 tag */
function SceneTagsCell({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return <span className="text-muted-foreground/35">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center rounded-full border border-violet-800/70 bg-violet-950/40 px-2 py-0.5 text-[10px] font-medium text-violet-300 whitespace-nowrap"
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
    return (
      <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-md border border-violet-800/70 bg-violet-950/40 px-2 font-semibold text-violet-300">
        {value}
      </span>
    )
  }

  if (column.key === 'duration') {
    return <span className="font-mono text-[11px] text-muted-foreground">{value}s</span>
  }

  if (column.key === 'shotType') {
    return (
      <span className="inline-flex items-center rounded-full border border-violet-800/70 bg-violet-950/40 px-2 py-0.5 text-[10px] font-medium text-violet-300 whitespace-nowrap">
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
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          'z-[70] flex flex-col gap-0 overflow-hidden border-violet-900/60 bg-background p-0 shadow-2xl shadow-violet-950/10',
          '[&>button:last-child]:hidden',
          isFullscreen
            ? 'w-screen h-screen max-w-none max-h-none rounded-none'
            : 'max-w-[90vw] max-h-[85vh] sm:rounded-xl',
        )}
      >
        {/* 顶部标题栏 */}
        <DialogHeader className="relative shrink-0 flex-row items-center justify-between space-y-0 border-b border-violet-900/70 bg-violet-950/20 px-4 py-3">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-violet-700/60 to-transparent" />
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-800 bg-violet-950/50 text-violet-300">
              <Clapperboard size={16} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-semibold text-foreground">
                {title}
              </DialogTitle>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <TableProperties size={12} className="text-violet-500" />
                <span>共 {shots.length} 个镜头</span>
                <span className="text-muted-foreground/40">/</span>
                <span>{visibleColumns.length} 个字段可见</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* 字段显隐 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={TOOL_BUTTON_CLASS}
                  title="字段设置"
                >
                  <Columns3 size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[80] w-48">
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
              className={TOOL_BUTTON_CLASS}
              title={isFullscreen ? '退出全屏' : '全屏查看'}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>

            <DialogClose
              className={TOOL_BUTTON_CLASS}
              title="关闭"
            >
              <X size={15} />
              <span className="sr-only">关闭</span>
            </DialogClose>
          </div>
        </DialogHeader>

        {/* 表格区域 */}
        <div className="flex-1 overflow-auto bg-gradient-to-b from-background to-muted/20">
          {shots.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-violet-800 bg-violet-950/30 text-violet-500">
                <Clapperboard size={22} />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">暂无分镜数据</p>
                <p className="mt-1 text-xs text-muted-foreground">执行分镜拆分后，这里会展示完整镜头表。</p>
              </div>
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-background/95 shadow-sm backdrop-blur">
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        col.width,
                        'border-b border-violet-900/50 px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap',
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
                      'group transition-colors',
                      idx % 2 === 0 ? 'bg-background/90' : 'bg-violet-950/10',
                      'hover:bg-violet-950/25',
                    )}
                  >
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          col.width,
                          'border-b border-border/50 px-3 py-2.5 align-top text-foreground/85',
                          col.key === 'shotNumber' && 'text-center',
                          col.key === 'duration' && 'text-center',
                          col.key === 'sceneDescription' && 'font-medium text-foreground',
                        )}
                      >
                        <CellContent shot={shot} column={col} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
