'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ShotItem } from '@/lib/canvas/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  shots: ShotItem[]
  title?: string
}

function TruncatedCell({ text, maxW = 'max-w-[200px]' }: { text: string; maxW?: string }) {
  if (!text) return <span className="text-muted-foreground/40">—</span>
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span className={`block truncate cursor-default ${maxW}`}>{text}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

const COLUMNS = [
  { key: 'shotNumber', label: '镜头', width: 'w-[52px]' },
  { key: 'duration', label: '时长', width: 'w-[52px]' },
  { key: 'shotType', label: '景别', width: 'w-[72px]' },
  { key: 'sceneDescription', label: '场景描述', width: 'w-[200px]' },
  { key: 'character1', label: '角色1', width: 'w-[80px]' },
  { key: 'character2', label: '角色2', width: 'w-[80px]' },
  { key: 'emotion', label: '情绪', width: 'w-[100px]' },
  { key: 'dialogue', label: '台词', width: 'w-[120px]' },
  { key: 'compositionPrompt', label: '构图提示词', width: 'w-[200px]' },
  { key: 'cameraMotionPrompt', label: '运镜提示词', width: 'w-[160px]' },
] as const

export function StoryboardTableDialog({ open, onOpenChange, shots, title = '分镜表' }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="text-sm font-medium">
            {title}
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              共 {shots.length} 个镜头
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-auto flex-1">
          <table className="w-max min-w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.width} px-3 py-2 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap`}
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
                  className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                >
                  <td className="px-3 py-2 border-b border-border/50 text-center font-medium text-violet-600">
                    {shot.shotNumber}
                  </td>
                  <td className="px-3 py-2 border-b border-border/50 text-center text-muted-foreground">
                    {shot.duration}s
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 whitespace-nowrap">
                      {shot.shotType}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.sceneDescription} maxW="max-w-[200px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.character1} maxW="max-w-[80px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.character2} maxW="max-w-[80px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.emotion} maxW="max-w-[100px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.dialogue} maxW="max-w-[120px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.compositionPrompt} maxW="max-w-[200px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.cameraMotionPrompt} maxW="max-w-[160px]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
