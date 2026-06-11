'use client'

import { useState } from 'react'
import type { MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Check, Copy, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { copyTextToClipboard } from '@/lib/clipboard'
import type { InspirationItem } from '@/components/dashboard/creative-home-data'

interface InspirationLightboxProps {
  item: InspirationItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 灵感图片沉浸式大图预览弹窗，支持「做同款」跳转创作页 */
export function InspirationLightbox({ item, open, onOpenChange }: InspirationLightboxProps) {
  const router = useRouter()
  const [copiedPrompt, setCopiedPrompt] = useState(false)

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

  const handleCopyPrompt = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    try {
      await copyTextToClipboard(item.description)
      setCopiedPrompt(true)
      toast.success('提示词已复制')
      setTimeout(() => setCopiedPrompt(false), 1400)
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-none bg-[radial-gradient(circle_at_50%_0%,#17233c_0%,#0a1224_42%,#050915_100%)] p-0 text-white shadow-none backdrop-blur-xl [&>button:last-child]:hidden" style={{ animationDuration: '400ms' }}>
        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-7 top-7 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-transparent text-white transition-colors hover:border-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/70 focus:ring-offset-2 focus:ring-offset-[#071025]"
          aria-label="关闭预览"
        >
          <X className="h-7 w-7" />
        </button>

        <div className="relative flex h-full w-full items-center justify-center px-6 py-20 sm:px-10 lg:px-16">
          <div className="grid w-full max-w-[1200px] grid-cols-1 items-center gap-9 md:grid-cols-[minmax(320px,548px)_minmax(280px,420px)] md:gap-24 lg:gap-32">
            <div className="flex justify-center md:justify-end">
              <img
                src={item.imageUrl}
                alt={item.title}
                className="h-auto max-h-[70vh] w-auto max-w-full object-contain shadow-[0_30px_120px_rgba(0,0,0,0.36)] md:max-h-[82vh]"
              />
            </div>

            <section className="flex max-w-[420px] flex-col items-start justify-center justify-self-center text-left md:justify-self-start">
              <DialogTitle className="text-[26px] font-semibold leading-tight text-white md:text-[28px]">
                {item.title}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="mt-7">
                  <p className="text-base leading-9 text-white/[0.58] md:text-[17px]">
                    {item.description}
                    <button
                      type="button"
                      onClick={handleCopyPrompt}
                      className="ml-2 inline-flex h-6 w-6 translate-y-0.5 items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.04] text-white/[0.55] transition-colors hover:border-white/[0.35] hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/[0.45]"
                      aria-label={copiedPrompt ? '提示词已复制' : '复制提示词'}
                      title={copiedPrompt ? '已复制' : '复制提示词'}
                    >
                      {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </p>
                </div>
              </DialogDescription>

              <button
                type="button"
                onClick={handleMakeSimilar}
                className="mt-8 inline-flex h-12 items-center gap-3 rounded-full border border-white/25 bg-white/[0.06] px-7 text-base text-white/[0.82] transition-colors hover:border-white/[0.45] hover:bg-white/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/[0.45]"
              >
                <Sparkles className="h-5 w-5" />
                做同款
              </button>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
