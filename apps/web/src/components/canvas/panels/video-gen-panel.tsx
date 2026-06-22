import { Cpu, Music, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VideoMode } from '@/lib/canvas/types'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import { calculateReferenceVideoDurationSeconds, getVideoCategoryKeys, parseCategoryReferences, type ModelItem, type VideoCategory } from '@aigc/types'
import { VideoConfigPopover } from '@/components/generation/shared/video-config-popover'
import { ResourceMentionTextarea } from './resource-mention-textarea'
import { PopoverSelect, ExecuteButton, PanelToolbar } from './panel-shared'
import type { CanvasReferenceMentionResource } from './resource-mentions'

const VIDEO_MODE_TO_CATEGORY: Record<VideoMode, VideoCategory> = {
  multiref: 'multimodal',
  keyframe: 'frames',
}

const CATEGORY_TO_VIDEO_MODE: Record<VideoCategory, VideoMode> = {
  multimodal: 'multiref',
  frames: 'keyframe',
}

function getReferenceBadgeClass(resource: CanvasReferenceMentionResource): string {
  if (resource.type === 'video') return 'bg-violet-600 text-white'
  if (resource.type === 'audio') return 'bg-emerald-600 text-white'
  return 'bg-blue-600 text-white'
}

function ReferencePreviewItem({
  resource,
  onRemoveReference,
}: {
  resource: CanvasReferenceMentionResource
  onRemoveReference: (resourceId: string) => void
}) {
  const isImage = resource.type === 'image'
  const isVideo = resource.type === 'video'
  const isAudio = resource.type === 'audio'
  const previewImageUrl = isVideo ? resource.thumbnailUrl : resource.url

  return (
    <div
      data-testid={`canvas-reference-preview-${resource.mentionLabel}`}
      className="group/reference relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/40 shadow-sm"
      title={`${resource.mentionLabel} · ${resource.sourceLabel}`}
    >
      {(isImage || (isVideo && previewImageUrl)) && (
        <img src={previewImageUrl ?? resource.url} alt={resource.mentionLabel} className="h-full w-full object-cover" loading="lazy" />
      )}
      {isVideo && !previewImageUrl && (
        <video src={resource.url} className="h-full w-full bg-black object-cover" muted playsInline preload="metadata" aria-label={resource.mentionLabel} />
      )}
      {isAudio && (
        <div className="flex h-full w-full items-center justify-center bg-emerald-50">
          <Music className="h-5 w-5 text-emerald-600" />
        </div>
      )}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/10">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow">
            <Play className="ml-0.5 h-3 w-3 text-violet-700" />
          </div>
        </div>
      )}
      <span className={cn('absolute left-0.5 top-0.5 rounded px-0.5 text-[8px] font-bold leading-4 shadow', getReferenceBadgeClass(resource))}>
        @{resource.mentionLabel}
      </span>
      <button
        type="button"
        data-testid={`canvas-reference-remove-${resource.mentionLabel}`}
        aria-label="取消引用"
        title={`取消引用${resource.mentionLabel}`}
        onClick={(event) => { event.stopPropagation(); onRemoveReference(resource.id) }}
        className="pointer-events-none absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/95 text-muted-foreground opacity-0 shadow transition group-hover/reference:pointer-events-auto group-hover/reference:opacity-100 group-focus-within/reference:pointer-events-auto group-focus-within/reference:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

function ReferencePreviewStrip({
  resources,
  onRemoveReference,
}: {
  resources: CanvasReferenceMentionResource[]
  onRemoveReference: (resourceId: string) => void
}) {
  if (resources.length === 0) return null

  return (
    <div
      data-testid="canvas-reference-preview-strip"
      className="flex max-w-full gap-1.5 overflow-x-auto rounded-xl border border-border/60 bg-muted/25 px-2 py-1.5"
    >
      {resources.map((resource) => (
        <ReferencePreviewItem key={resource.id} resource={resource} onRemoveReference={onRemoveReference} />
      ))}
    </div>
  )
}

interface VideoGenPanelProps {
  promptDraft: string
  setPromptDraft: (value: string) => void
  flushPromptDraft: () => void
  upstreamTextNodeLabels: string[]
  mentionResources: CanvasReferenceMentionResource[]
  multirefImages: string[]
  multirefVideos: string[]
  multirefVideoDurations: number[]
  multirefAudios: string[]
  keyframeImages: Array<{ url: string; edgeId: string }>
  displayedKeyframes: Array<{ url: string; edgeId: string }>
  keyframeSwapped: boolean
  setKeyframeSwapped: (value: boolean | ((v: boolean) => boolean)) => void
  videoModel: string
  videoMode: VideoMode
  videoAspect: string
  videoDuration: number
  generateAudio: boolean
  executing: boolean
  hasPrompt: boolean
  models?: ModelItem[]
  videoResolution: string
  onVideoResolutionChange: (value: string) => void
  onVideoModelChange: (value: string) => void
  onVideoModeChange: (value: VideoMode) => void
  onUpdateCfg: (patch: Record<string, unknown>) => void
  onRemoveReference: (resourceId: string) => void
  onExecute: () => void
}

export function VideoGenPanel({
  promptDraft,
  setPromptDraft,
  flushPromptDraft,
  upstreamTextNodeLabels,
  mentionResources,
  multirefImages,
  multirefVideos,
  multirefVideoDurations,
  multirefAudios,
  keyframeImages,
  displayedKeyframes,
  setKeyframeSwapped,
  videoModel,
  videoMode,
  videoAspect,
  videoDuration,
  generateAudio,
  executing,
  hasPrompt,
  models,
  videoResolution,
  onVideoResolutionChange,
  onVideoModelChange,
  onVideoModeChange,
  onUpdateCfg,
  onRemoveReference,
  onExecute,
}: VideoGenPanelProps) {
  const currentDbModel = models?.find((m) => m.code === videoModel)
  const isSeedance = currentDbModel ? currentDbModel.code.startsWith('seedance-') : false

  const filteredModels = (models ?? []).filter((m) => {
    const categories = parseCategoryReferences(m.category_references)
    return Boolean(categories[VIDEO_MODE_TO_CATEGORY[videoMode]])
  })

  const currentCategories = parseCategoryReferences(currentDbModel?.category_references)
  const availableModes = getVideoCategoryKeys(currentCategories)

  const aspectRatioOptions = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio')
  const durationOptions = extractSchemaEnums(currentDbModel?.params_schema, 'time_length').map((item) => {
    const num = Number(item.value)
    return { value: num, label: num === -1 ? '自动' : `${num}s` }
  })
  const resolutionOptions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution').map((e) => e.value)
  const showResolutionSelector = resolutionOptions.length > 1

  const videoUnitPrice = currentDbModel
    ? getPriceByResolution(currentDbModel, videoResolution || resolutionOptions[0] || '')
    : 0
  const referenceDuration = videoMode === 'multiref' ? calculateReferenceVideoDurationSeconds(multirefVideoDurations) : 0
  // 自动时长时用默认秒数预估（与后端 calculateVideoEstimatedCredits 逻辑一致）
  const DEFAULT_VIDEO_AUTO_DURATION_SECS = 5
  const videoCredits = currentDbModel && isSeedance
    ? (videoDuration > 0
      ? (videoDuration + referenceDuration) * videoUnitPrice
      : videoUnitPrice * DEFAULT_VIDEO_AUTO_DURATION_SECS + referenceDuration * videoUnitPrice)
    : videoUnitPrice
  // Popover 选项列表
  const modelOptions = filteredModels.map((m) => ({ value: m.code, label: m.name }))
  const aspectPopOptions = aspectRatioOptions.map((ar) => ({ value: ar.value, label: ar.label }))
  const currentModelLabel = modelOptions.find((option) => option.value === videoModel)?.label ?? videoModel
  const currentResolutionLabel = videoResolution
    ? videoResolution.toUpperCase()
    : resolutionOptions[0]?.toUpperCase()
  const selectedResolution = videoResolution || resolutionOptions[0] || ''
  const currentAspectLabel = aspectPopOptions.find((option) => option.value === videoAspect)?.label ?? videoAspect
  const currentDurationLabel = durationOptions.find((option) => option.value === videoDuration)?.label ?? `${videoDuration}s`
  const configSummary = [
    currentResolutionLabel,
    currentAspectLabel,
    isSeedance ? currentDurationLabel : null,
    isSeedance ? (generateAudio ? '有声' : '无声') : null,
  ].filter(Boolean).join(' - ')

  return (
    <div className="p-4 space-y-3">
      {/* 视频模式切换 — 紧凑 segment control */}
      <div className="flex rounded-lg overflow-hidden border border-border/60 text-[11px] font-medium">
        {availableModes.map((category) => {
          const mode = CATEGORY_TO_VIDEO_MODE[category]
          const label = currentCategories[category]?.label ?? category
          return (
            <button
              key={category}
              data-testid={`video-mode-${mode}`}
              onClick={() => onVideoModeChange(mode)}
              disabled={!currentCategories[category]}
              className={cn(
                'flex-1 py-1.5 transition-colors',
                videoMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* 上游文本节点标签 */}
      {upstreamTextNodeLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {upstreamTextNodeLabels.map((label, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
              [{label}]+
            </span>
          ))}
        </div>
      )}

      {/* 提示词大文本框 */}
      <ResourceMentionTextarea
        minHeightClassName="min-h-[180px]"
        placeholder="描述视频内容..."
        value={promptDraft}
        resources={mentionResources}
        onChange={setPromptDraft}
        onBlur={flushPromptDraft}
      />

      {/* 多模态参考素材预览 */}
      {videoMode === 'multiref' && (
        mentionResources.length > 0 && (
          <ReferencePreviewStrip resources={mentionResources} onRemoveReference={onRemoveReference} />
        )
      )}

      {/* 关键帧预览 */}
      {videoMode === 'keyframe' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-muted-foreground">
              {keyframeImages.length === 0 ? '文生视频' : keyframeImages.length === 1 ? '首帧生视频' : '首帧 → 尾帧'}
            </label>
            {keyframeImages.length === 2 && (
              <button
                data-testid="video-keyframe-swap"
                onClick={() => setKeyframeSwapped((v) => !v)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/40 hover:bg-muted text-muted-foreground transition-colors"
                title="交换首尾帧"
              >
                ⇄ 交换
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {[0, 1].map((idx) => {
              const frame = displayedKeyframes[idx]
              const label = idx === 0 ? '首' : '尾'
              return (
                <div
                  key={idx}
                  className={cn(
                    'relative w-14 h-14 rounded-lg border flex items-center justify-center text-[10px] text-muted-foreground font-medium',
                    frame ? 'group/reference border-border/60' : 'border-dashed border-muted-foreground/30 bg-muted/20'
                  )}
                >
                  {frame ? (
                    <>
                      <img src={frame.url} alt="" className="w-full h-full object-cover rounded-lg" />
                      <span className="absolute -top-1 -left-1 text-[9px] bg-amber-500 text-white rounded px-1 font-bold">{label}</span>
                      <button
                        type="button"
                        data-testid={`canvas-keyframe-remove-${idx}`}
                        aria-label="取消引用"
                        title={`取消引用${label}帧`}
                        onClick={(event) => { event.stopPropagation(); onRemoveReference(frame.edgeId) }}
                        className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow ring-1 ring-border transition group-hover/reference:pointer-events-auto group-hover/reference:opacity-100 group-focus-within/reference:pointer-events-auto group-focus-within/reference:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </>
                  ) : (
                    <span>{label}帧</span>
                  )}
                </div>
              )
            })}
            {keyframeImages.length === 0 && <span className="text-[10px] text-muted-foreground">连接图片节点</span>}
          </div>
        </div>
      )}

      {/* 底部工具栏：Popover 属性 + 执行按钮 */}
      <div className="flex items-center justify-between pt-1">
        <PanelToolbar>
          {/* 模型选择 */}
          <PopoverSelect
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="模型"
            value={videoModel}
            options={modelOptions}
            onChange={onVideoModelChange}
            displayValue={currentModelLabel}
            valueClassName="max-w-[150px]"
          />

          <VideoConfigPopover
            summary={configSummary}
            videoResolution={selectedResolution}
            resolutionOptions={showResolutionSelector ? resolutionOptions : resolutionOptions.slice(0, 1)}
            videoAspect={videoAspect}
            aspectOptions={aspectPopOptions}
            videoDuration={videoDuration}
            durationOptions={durationOptions}
            isSeedance={isSeedance}
            generateAudio={generateAudio}
            onResolutionChange={onVideoResolutionChange}
            onAspectRatioChange={(val) => onUpdateCfg({ aspectRatio: val })}
            onDurationChange={(val) => onUpdateCfg({ duration: val })}
            onGenerateAudioChange={(val) => onUpdateCfg({ generateAudio: val })}
          />
        </PanelToolbar>

        <ExecuteButton
          icon={<Play className="h-4 w-4" />}
          credits={videoCredits}
          executing={executing}
          disabled={!hasPrompt}
          onClick={onExecute}
        />
      </div>
    </div>
  )
}
