'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

interface GenerationSettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
}

/** 通用设置抽屉 — 承载图片/视频生成的高级参数 */
export function GenerationSettingsSheet({ open, onOpenChange, title, children }: GenerationSettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:max-w-[360px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>调整生成参数，获得更理想的效果</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
