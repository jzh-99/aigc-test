'use client'

import { useState, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import type { DescribeData } from '@/hooks/video-studio/use-wizard-state'

const STYLE_PRESETS = ['现代都市', '古装', '科幻', '动漫', '纪录片', '悬疑', '奇幻', '商业广告', '微电影']
const RATIO_OPTIONS = [{ value: '16:9', label: '16:9 横屏' }, { value: '9:16', label: '9:16 竖屏' }, { value: '1:1', label: '1:1 方形' }]

interface Props {
  initial?: DescribeData | null
  projectType?: 'single' | 'series'
  episodeCount?: number
  onComplete: (data: DescribeData) => void
  onDraftChange?: (data: DescribeData) => void
}

export function StepDescribe({ initial, projectType = 'single', episodeCount = 1, onComplete, onDraftChange }: Props) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [duration, setDuration] = useState(initial?.duration ?? 60)
  const [aspectRatio, setAspectRatio] = useState(initial?.aspectRatio ?? '16:9')

  // style can be a preset or a custom string
  const initialStyle = initial?.style ?? '现代都市'
  const isCustomInitial = initialStyle !== '' && !STYLE_PRESETS.includes(initialStyle)
  const [selectedPreset, setSelectedPreset] = useState(isCustomInitial ? '自定义' : initialStyle)
  const [customStyle, setCustomStyle] = useState(isCustomInitial ? initialStyle : '')

  const style = selectedPreset === '自定义' ? customStyle : selectedPreset
  const canProceed = description.trim().length > 0 && style.trim().length > 0

  // Sync draft to parent on every change so switching steps doesn't lose edits
  useEffect(() => {
    if (!onDraftChange) return
    onDraftChange({ description, style, duration, aspectRatio })
  }, [description, style, duration, aspectRatio, onDraftChange])

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">描述你的视频</h2>
        <p className="text-sm text-muted-foreground mt-1">告诉 AI 你想要什么，越详细越好</p>
      </div>

      {projectType === 'series' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-primary">
          <span>📺</span>
          <span>系列剧集 · 共 {episodeCount} 集 — 此处描述整个系列的世界观和主线故事</span>
        </div>
      )}

      <div className="space-y-4 p-5 border rounded-xl bg-card">
        <div>
          <label className="text-sm font-medium block mb-1.5">故事/内容描述 <span className="text-destructive">*</span></label>
          <textarea
            className="w-full h-28 p-3 text-sm bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="例如：一个关于城市孤独者在深夜便利店偶遇的温情故事，主角是一个失眠的程序员和一个打工的大学生…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">视觉风格</label>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedPreset(s)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    selectedPreset === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'
                  }`}
                >
                  {s}
                </button>
              ))}
              <button
                onClick={() => setSelectedPreset('自定义')}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  selectedPreset === '自定义' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'
                }`}
              >
                自定义
              </button>
            </div>
            {selectedPreset === '自定义' && (
              <input
                type="text"
                className="mt-2 w-full p-2 text-sm bg-muted/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="例如：赛博朋克、水墨风、写实摄影…"
                value={customStyle}
                onChange={(e) => setCustomStyle(e.target.value)}
                autoFocus
              />
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">目标时长</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={15}
                  max={300}
                  step={15}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm font-medium w-12 text-right">{duration}秒</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">约 {Math.ceil(duration / 10)} 个镜头</p>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">画面比例</label>
              <div className="flex gap-2">
                {RATIO_OPTIONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setAspectRatio(r.value)}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${
                      aspectRatio === r.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => onComplete({ description, style, duration, aspectRatio })}
        disabled={!canProceed}
        className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-5 py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        下一步：生成剧本
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
