'use client'

import { useMemo, useState } from 'react'
import { ResultCard } from './result-card'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import type { BatchResponse } from '@aigc/types'
import { motion, AnimatePresence } from 'framer-motion'

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const itemVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: 'easeOut' as const } },
}

interface BatchResultGridProps {
  batch: BatchResponse | null
}

export function BatchResultGrid({ batch }: BatchResultGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const previewUrls = useMemo(() => {
    if (!batch) return []
    return batch.tasks
      .map((task) => task.asset?.storage_url ?? task.asset?.original_url)
      .filter((url): url is string => Boolean(url))
  }, [batch])

  const taskPreviewIndex = useMemo(() => {
    if (!batch) return new Map<string, number>()

    const map = new Map<string, number>()
    let idx = 0
    for (const task of batch.tasks) {
      const url = task.asset?.storage_url ?? task.asset?.original_url
      if (url) {
        map.set(task.id, idx)
        idx += 1
      }
    }
    return map
  }, [batch])

  if (!batch) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg">输入提示词开始创作</p>
          <p className="text-sm mt-1">生成结果将显示在这里</p>
        </div>
      </div>
    )
  }

  const currentUrl = lightboxIndex !== null ? previewUrls[lightboxIndex] : null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="truncate max-w-[300px]">{batch.prompt}</span>
        <span className="shrink-0">
          {batch.completed_count}/{batch.quantity} 完成
        </span>
      </div>
      <motion.div
        className="grid grid-cols-2 gap-3"
        variants={containerVariants}
        initial="hidden"
        animate="show"
        key={batch.id}
      >
        <AnimatePresence mode="popLayout">
          {batch.tasks.map((task) => {
            const previewIndex = taskPreviewIndex.get(task.id)
            return (
              <motion.div key={task.id} variants={itemVariants} layout>
                <ResultCard
                  task={task}
                  onPreview={previewIndex !== undefined ? () => setLightboxIndex(previewIndex) : undefined}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>

      {currentUrl && (
        <ImageLightbox
          url={currentUrl}
          onClose={() => setLightboxIndex(null)}
          onPrev={lightboxIndex! > 0 ? () => setLightboxIndex((i) => i! - 1) : undefined}
          onNext={lightboxIndex! < previewUrls.length - 1 ? () => setLightboxIndex((i) => i! + 1) : undefined}
        />
      )}
    </div>
  )
}
