'use client'

import Image from 'next/image'
import type { TaskResponse } from '@aigc/types'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, AlertCircle, Download, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadImage } from '@/lib/download'
import { translateTaskError } from '@/lib/error-messages'
import { motion } from 'framer-motion'

const fadeIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: 'easeOut' as const } },
}

interface ResultCardProps {
  task: TaskResponse
  onPreview?: () => void
}

export function ResultCard({ task, onPreview }: ResultCardProps) {
  const imageUrl = task.asset?.storage_url ?? task.asset?.original_url

  if (task.status === 'pending') {
    return (
      <motion.div {...fadeIn} className="relative aspect-square rounded-lg overflow-hidden border bg-card">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Badge variant="outline" className="bg-background/80">等待中</Badge>
        </div>
      </motion.div>
    )
  }

  if (task.status === 'processing') {
    return (
      <motion.div {...fadeIn} className="relative aspect-square rounded-lg overflow-hidden border bg-card">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-accent-purple" />
            <Badge variant="processing">生成中</Badge>
          </div>
        </div>
      </motion.div>
    )
  }

  if (task.status === 'failed') {
    return (
      <motion.div {...fadeIn} className="relative aspect-square rounded-lg overflow-hidden border bg-card">
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/5">
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <AlertCircle className="h-6 w-6 text-error" />
            <Badge variant="destructive">失败</Badge>
            {task.error_message && (
              <p className="text-xs text-muted-foreground line-clamp-2">{translateTaskError(task.error_message)}</p>
            )}
          </div>
        </div>
      </motion.div>
    )
  }

  // completed
  if (!imageUrl) {
    return (
      <motion.div {...fadeIn} className="relative aspect-square rounded-lg overflow-hidden border bg-card flex items-center justify-center">
        <p className="text-sm text-muted-foreground">图片处理中...</p>
      </motion.div>
    )
  }

  return (
    <motion.div {...fadeIn} className={cn(
      'group relative aspect-square rounded-lg overflow-hidden border bg-card cursor-pointer transition-shadow hover:shadow-md'
    )}>
      <Image
        src={imageUrl}
        alt="Generated image"
        fill
        className="object-cover"
        sizes="(max-width: 768px) 50vw, 25vw"
        unoptimized
      />
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end justify-end p-2 opacity-0 group-hover:opacity-100">
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 bg-background/80 hover:bg-background"
            onClick={(e) => {
              e.stopPropagation()
              onPreview?.()
            }}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 bg-background/80 hover:bg-background"
            onClick={(e) => {
              e.stopPropagation()
              downloadImage(imageUrl)
            }}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
