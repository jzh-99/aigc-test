'use client'

import { ArrowRight } from 'lucide-react'

interface Props {
  onComplete: () => void
}

export function StepAudio({ onComplete }: Props) {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Step 4 · 配音 & BGM</h2>
        <p className="text-sm text-muted-foreground mt-1">为视频添加 AI 配音和背景音乐</p>
      </div>

      <div className="border rounded-xl bg-card p-8 text-center space-y-3">
        <p className="text-4xl">🎵</p>
        <p className="font-medium">配音 & BGM 功能即将推出</p>
        <p className="text-sm text-muted-foreground">目前可以跳过此步骤，直接进行视频合成</p>
      </div>

      <button
        onClick={onComplete}
        className="flex items-center gap-2 text-sm bg-muted text-foreground px-5 py-2.5 rounded-lg hover:bg-muted/80 transition-colors"
      >
        跳过，进入视频合成
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
