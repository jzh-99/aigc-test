'use client'

import { ResultCard } from './result-card'
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
          {batch.tasks.map((task) => (
            <motion.div key={task.id} variants={itemVariants} layout>
              <ResultCard task={task} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
