'use client'

import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Sparkles, X } from 'lucide-react'
import type { InspirationItem } from '@/components/dashboard/creative-home-data'

interface InspirationLightboxProps {
  item: InspirationItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 灵感图片沉浸式大图预览弹窗，支持「做同款」跳转创作页 */
export function InspirationLightbox({ item, open, onOpenChange }: InspirationLightboxProps) {
  const router = useRouter()

  if (!item) return null

  /** 点击「做同款」：关闭弹窗并跳转创作页，带入 prompt 和模型 */
  const handleMakeSimilar = () => {
    onOpenChange(false)
    const params = new URLSearchParams({
      mode: 'image',
      prompt: item.description,
      model: 'gpt-image-2',
    })
    router.push(`/generation?${params.toString()}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 w-screen h-screen max-w-none max-h-none translate-x-0 translate-y-0 border-none bg-[#080D1A]/80 p-0 overflow-hidden backdrop-blur-md rounded-none [&>button:last-child]:hidden" style={{ animationDuration: '400ms' }}>
        {/* 关闭按钮 */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* 全屏沉浸式图片 */}
        <div className="relative flex items-center justify-center w-full h-full">
          <img
            src={item.imageUrl}
            alt={item.title}
            className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-6rem)] object-contain"
          />

          {/* 底部渐变遮罩 + 信息浮层 */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#080D1A]/60 via-[#080D1A]/20 to-transparent px-10 pb-8 pt-24">
            <DialogTitle className="text-base font-medium text-white/90">
              {item.title}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-sm leading-relaxed text-white/50 line-clamp-2">
              {item.description}
            </DialogDescription>
            {/* 做同款 — 半透明低调样式，hover 时才强调 */}
            <button
              onClick={handleMakeSimilar}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-white/60 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white/90"
            >
              <Sparkles className="h-3.5 w-3.5" />
              做同款
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
