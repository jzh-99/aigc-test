'use client'

import { useState, useMemo } from 'react'
import { Zap } from 'lucide-react'
import type { AgentStep, StepParams } from '@/lib/canvas/agent-types'
import type { ModelItem } from '@aigc/types'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import {
  SEEDANCE_DURATION_OPTIONS,
  VIDEO_ASPECT_RATIOS_SEEDANCE,
  VIDEO_ASPECT_RATIOS_VEO,
  ASPECT_RATIOS_IMAGE,
} from '@/components/canvas/panels/panel-constants'

interface Props {
  step: AgentStep
  onConfirm: (params: StepParams) => void
  disabled?: boolean
  completed?: boolean
  imageModels?: ModelItem[]
  videoModels?: ModelItem[]
}

export function GuideStepCard({ step, onConfirm, disabled, completed, imageModels = [], videoModels = [] }: Props) {
  const isImage = step.nodeType === 'image_gen'
  const isVideo = step.nodeType === 'video_gen'
  const needsParams = step.needsRun && (isImage || isVideo)

  const defaultImageModel = imageModels[0]?.code ?? ''
  const defaultVideoModel = videoModels[0]?.code ?? ''

  const defaultImageResolution = useMemo(() => {
    const m = imageModels[0]
    if (!m) return '2k'
    return extractSchemaEnums(m.params_schema, 'resolution')[0]?.value ?? '2k'
  }, [imageModels])

  const [params, setParams] = useState<StepParams>(() =>
    isVideo
      ? { videoModel: defaultVideoModel, duration: 5, aspectRatio: 'adaptive' }
      : { modelType: defaultImageModel, resolution: defaultImageResolution, aspectRatio: '1:1' }
  )

  const selectedImageModel = isImage ? imageModels.find((m) => m.code === params.modelType) : undefined
  const selectedVideoModel = isVideo ? videoModels.find((m) => m.code === params.videoModel) : undefined

  const resolutionOptions = useMemo(() => {
    if (!selectedImageModel) return []
    return extractSchemaEnums(selectedImageModel.params_schema, 'resolution').map((e) => e.value)
  }, [selectedImageModel])

  const isSeedance = isVideo && (params.videoModel ?? '').startsWith('seedance-')
  const aspectRatios = isSeedance ? VIDEO_ASPECT_RATIOS_SEEDANCE : VIDEO_ASPECT_RATIOS_VEO

  // 积分估算：从 params_pricing 读取
  const credits = useMemo(() => {
    if (isImage && selectedImageModel) {
      const price = getPriceByResolution(selectedImageModel, params.resolution ?? '2k')
      return step.nodeIds.length * price
    }
    if (isVideo && selectedVideoModel) {
      const pricing = selectedVideoModel.params_pricing[0]
      if (pricing) {
        return step.nodeIds.length * pricing.unit_price * (params.duration ?? 5)
      }
    }
    return 0
  }, [isImage, isVideo, selectedImageModel, selectedVideoModel, params, step.nodeIds.length])

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
                    const mt = e.target.value
                    const m = imageModels.find((m) => m.code === mt)
                    const enums = m ? extractSchemaEnums(m.params_schema, 'resolution') : []
                    const res = enums.some((en) => en.value === params.resolution)
                      ? params.resolution
                      : enums[0]?.value
                    setParams((p) => ({ ...p, modelType: mt, resolution: res }))
                  }}
                  className="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                >
                  {imageModels.map((m) => (
                    <option key={m.code} value={m.code}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">分辨率</span>
                <select
                  value={params.resolution}
                  onChange={(e) => setParams((p) => ({ ...p, resolution: e.target.value }))}
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
                  {videoModels.map((m) => (
                    <option key={m.code} value={m.code}>{m.name}</option>
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

          {credits > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
              <Zap className="w-3 h-3 text-yellow-500" />
              <span>预计消耗 <span className="text-foreground font-medium">{credits}</span> 积分</span>
            </div>
          )}
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
