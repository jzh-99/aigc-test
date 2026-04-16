'use client'

import { useState, useMemo } from 'react'
import { Zap } from 'lucide-react'
import type { AgentStep, StepParams } from '@/lib/canvas/agent-types'
import { estimateStepCredits } from '@/hooks/canvas/use-canvas-agent'
import {
  IMAGE_MODEL_OPTIONS,
  MODEL_CODE_MAP,
  VIDEO_MODEL_OPTIONS,
  SEEDANCE_DURATION_OPTIONS,
  VIDEO_ASPECT_RATIOS_SEEDANCE,
  VIDEO_ASPECT_RATIOS_VEO,
  ASPECT_RATIOS_IMAGE,
} from '@/components/canvas/panels/panel-constants'
import type { ImageModelType, ImageResolution } from '@/lib/canvas/types'

interface Props {
  step: AgentStep
  onConfirm: (params: StepParams) => void
  disabled?: boolean
  completed?: boolean  // true for historical steps that are no longer active
}

const DEFAULT_IMAGE_PARAMS: StepParams = {
  modelType: 'gemini',
  resolution: '2k',
  aspectRatio: '1:1',
}

const DEFAULT_VIDEO_PARAMS: StepParams = {
  videoModel: 'seedance-2.0',
  duration: 5,
  aspectRatio: 'adaptive',
}

export function GuideStepCard({ step, onConfirm, disabled, completed }: Props) {
  const isImage = step.nodeType === 'image_gen'
  const isVideo = step.nodeType === 'video_gen'
  const needsParams = step.needsRun && (isImage || isVideo)

  const [params, setParams] = useState<StepParams>(
    isVideo ? DEFAULT_VIDEO_PARAMS : DEFAULT_IMAGE_PARAMS,
  )

  const credits = useMemo(() => estimateStepCredits(step, params), [step, params])

  const selectedModel = isImage
    ? IMAGE_MODEL_OPTIONS.find((m) => m.value === params.modelType)
    : VIDEO_MODEL_OPTIONS.find((m) => m.value === params.videoModel)

  const resolutionOptions = isImage && selectedModel
    ? (selectedModel as typeof IMAGE_MODEL_OPTIONS[number]).resolutions
    : []

  const isSeedance = isVideo && (selectedModel as typeof VIDEO_MODEL_OPTIONS[number])?.isSeedance
  const aspectRatios = isSeedance ? VIDEO_ASPECT_RATIOS_SEEDANCE : VIDEO_ASPECT_RATIOS_VEO

  return (
    <div className={`rounded-lg border bg-muted/30 p-3 space-y-3 text-sm ${completed ? 'border-border opacity-60' : 'border-border'}`}>
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Step {step.stepIndex + 1} / {step.totalSteps}
          </span>
          {completed && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">已完成</span>
          )}
        </div>
        <p className="font-medium text-foreground mt-0.5">{step.label}</p>
        {step.instruction && (
          <p className="text-xs text-muted-foreground mt-1">{step.instruction}</p>
        )}
        {step.nodeIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            本步骤将执行 {step.nodeIds.length} 个节点
          </p>
        )}
      </div>

      {/* Params — hidden for completed steps */}
      {needsParams && !completed && (
        <div className="space-y-2">
          {isImage && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">模型</span>
                <select
                  value={params.modelType}
                  onChange={(e) => {
                    const mt = e.target.value as ImageModelType
                    const model = IMAGE_MODEL_OPTIONS.find((m) => m.value === mt)
                    const res = model?.resolutions.includes(params.resolution as ImageResolution)
                      ? params.resolution
                      : model?.resolutions[0]
                    setParams((p) => ({ ...p, modelType: mt, resolution: res }))
                  }}
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                >
                  {IMAGE_MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">分辨率</span>
                <select
                  value={params.resolution}
                  onChange={(e) => setParams((p) => ({ ...p, resolution: e.target.value as ImageResolution }))}
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                >
                  {resolutionOptions.map((r) => (
                    <option key={r} value={r}>{r.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">比例</span>
                <select
                  value={params.aspectRatio}
                  onChange={(e) => setParams((p) => ({ ...p, aspectRatio: e.target.value }))}
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                >
                  {ASPECT_RATIOS_IMAGE.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {isVideo && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">模型</span>
                <select
                  value={params.videoModel}
                  onChange={(e) => setParams((p) => ({ ...p, videoModel: e.target.value }))}
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                >
                  {VIDEO_MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              {isSeedance && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-12 shrink-0">时长</span>
                  <select
                    value={params.duration}
                    onChange={(e) => setParams((p) => ({ ...p, duration: Number(e.target.value) }))}
                    className="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                  >
                    {SEEDANCE_DURATION_OPTIONS.filter((o) => o.value > 0).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">比例</span>
                <select
                  value={params.aspectRatio}
                  onChange={(e) => setParams((p) => ({ ...p, aspectRatio: e.target.value }))}
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                >
                  {aspectRatios.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Credit estimate */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
            <Zap className="w-3 h-3 text-yellow-500" />
            <span>预计消耗 <span className="text-foreground font-medium">{credits}</span> 积分</span>
          </div>
        </div>
      )}

      <button
        onClick={() => onConfirm(params)}
        disabled={disabled || completed}
        className="w-full text-xs bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {completed ? '已执行' : step.needsRun ? '确认并批量执行 →' : '下一步 →'}
      </button>
    </div>
  )
}
