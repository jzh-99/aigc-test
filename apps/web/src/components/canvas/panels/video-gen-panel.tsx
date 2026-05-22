import { Film, ImageIcon, Loader2, Music, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VideoMode } from '@/lib/canvas/types'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import { calculateReferenceVideoDurationSeconds, getVideoCategoryKeys, parseVideoCategories, type ModelItem, type VideoCategory } from '@aigc/types'
import { ResourceMentionTextarea } from './resource-mention-textarea'
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

function ReferencePreviewItem({ resource }: { resource: CanvasReferenceMentionResource }) {
  const isImage = resource.type === 'image'
  const isVideo = resource.type === 'video'
  const isAudio = resource.type === 'audio'
  const previewImageUrl = isVideo ? resource.thumbnailUrl : resource.url

  return (
    <div
      data-testid={`canvas-reference-preview-${resource.mentionLabel}`}
      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40"
      title={`${resource.mentionLabel} · ${resource.sourceLabel}`}
    >
      {(isImage || (isVideo && previewImageUrl)) && (
        <img
          src={previewImageUrl ?? resource.url}
          alt={resource.mentionLabel}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      )}
      {isVideo && !previewImageUrl && (
        <video
          src={resource.url}
          className="h-full w-full bg-black object-cover"
          muted
          playsInline
          preload="metadata"
          aria-label={resource.mentionLabel}
        />
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
      <span className={cn('absolute left-1 top-1 rounded px-1 text-[9px] font-bold leading-4 shadow', getReferenceBadgeClass(resource))}>
        @{resource.mentionLabel}
      </span>
    </div>
  )
}

function ReferencePreviewGroup({
  title,
  count,
  type,
  resources,
}: {
  title: string
  count: number
  type: CanvasReferenceMentionResource['type']
  resources: CanvasReferenceMentionResource[]
}) {
  if (resources.length === 0) return null

  const Icon = type === 'video' ? Film : type === 'audio' ? Music : ImageIcon
  const iconClassName = type === 'video' ? 'text-violet-600' : type === 'audio' ? 'text-emerald-600' : 'text-blue-600'

  return (
    <div data-testid={`canvas-reference-preview-group-${type}`} className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <Icon className={cn('h-3 w-3', iconClassName)} />
        <span>{title} {count}</span>
      </div>
      <div
        data-testid={`canvas-reference-preview-list-${type}`}
        className="flex max-w-full gap-1.5 overflow-x-auto pb-1"
      >
        {resources.map((resource) => <ReferencePreviewItem key={resource.id} resource={resource} />)}
      </div>
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
  cameraFixed: boolean
  executing: boolean
  hasPrompt: boolean
  models?: ModelItem[]
  videoResolution: string
  onVideoResolutionChange: (value: string) => void
  onVideoModelChange: (value: string) => void
  onVideoModeChange: (value: VideoMode) => void
  onUpdateCfg: (patch: Record<string, unknown>) => void
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
  cameraFixed,
  executing,
  hasPrompt,
  models,
  videoResolution,
  onVideoResolutionChange,
  onVideoModelChange,
  onVideoModeChange,
  onUpdateCfg,
  onExecute,
}: VideoGenPanelProps) {
  const currentDbModel = models?.find((m) => m.code === videoModel)
  const isSeedance = currentDbModel ? currentDbModel.code.startsWith('seedance-') : false

  const filteredModels = (models ?? []).filter((m) => {
    const categories = parseVideoCategories(m.video_categories)
    return Boolean(categories[VIDEO_MODE_TO_CATEGORY[videoMode]])
  })

  const currentCategories = parseVideoCategories(currentDbModel?.video_categories)
  const availableModes = getVideoCategoryKeys(currentCategories)

  const aspectRatioOptions = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio')
  const durationOptions = extractSchemaEnums(currentDbModel?.params_schema, 'time_length').map((item) => {
    const num = Number(item.value)
    return { value: num, label: num === -1 ? '自动' : `${num}s` }
  })
  // 从模型 schema 读取分辨率可选项，超过 1 个才显示选择器
  const resolutionOptions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution').map((e) => e.value)
  const showResolutionSelector = resolutionOptions.length > 1

  const videoUnitPrice = currentDbModel
    ? getPriceByResolution(currentDbModel, videoResolution || resolutionOptions[0] || '', currentDbModel.credit_cost)
    : 0
  const referenceDuration = videoMode === 'multiref' ? calculateReferenceVideoDurationSeconds(multirefVideoDurations) : 0
  const videoCredits = currentDbModel && isSeedance
    ? (videoDuration > 0
      ? (videoDuration + referenceDuration) * videoUnitPrice
      : currentDbModel.credit_cost + referenceDuration * videoUnitPrice)
    : videoUnitPrice
  const imageMentionResources = mentionResources.filter((resource) => resource.type === 'image')
  const videoMentionResources = mentionResources.filter((resource) => resource.type === 'video')
  const audioMentionResources = mentionResources.filter((resource) => resource.type === 'audio')

  return (
    <div className="flex gap-0 divide-x divide-border">
      <div className="p-3 flex flex-col gap-2" style={{ width: 220 }}>
        <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-medium">
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
                  'flex-1 py-1 transition-colors',
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

        <label className="text-[11px] font-medium text-muted-foreground">提示词</label>
        {upstreamTextNodeLabels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {upstreamTextNodeLabels.map((label, i) => (
              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
                [{label}]+
              </span>
            ))}
          </div>
        )}
        <ResourceMentionTextarea
          minHeightClassName="min-h-[80px]"
          placeholder="描述视频内容..."
          value={promptDraft}
          resources={mentionResources}
          onChange={setPromptDraft}
          onBlur={flushPromptDraft}
        />

        {videoMode === 'multiref' && (
          <div className="space-y-1">
            {(multirefImages.length + multirefVideos.length + multirefAudios.length) === 0 ? (
              <div className="text-[10px] text-muted-foreground bg-muted/20 rounded-lg p-2 text-center">
                可连接图片、视频、音频节点
              </div>
            ) : (
              <div className="space-y-2">
                <ReferencePreviewGroup title="图片" count={multirefImages.length} type="image" resources={imageMentionResources} />
                <ReferencePreviewGroup title="视频" count={multirefVideos.length} type="video" resources={videoMentionResources} />
                <ReferencePreviewGroup title="音频" count={multirefAudios.length} type="audio" resources={audioMentionResources} />
              </div>
            )}
          </div>
        )}

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
                  className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted text-muted-foreground transition-colors"
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
                      'relative w-14 h-14 rounded border flex items-center justify-center text-[10px] text-muted-foreground font-medium',
                      frame ? 'border-border' : 'border-dashed border-muted-foreground/30 bg-muted/20'
                    )}
                  >
                    {frame ? (
                      <>
                        <img src={frame.url} alt="" className="w-full h-full object-cover rounded" />
                        <span className="absolute -top-1 -left-1 text-[9px] bg-amber-500 text-white rounded px-1 font-bold">{label}</span>
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
      </div>

      <div className="p-3 flex flex-col gap-2" style={{ width: 200 }}>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">模型</label>
          <div className="flex flex-col gap-1">
            {filteredModels.map((m) => {
              const isActive = videoModel === m.code
              return (
                <button
                  key={m.code}
                  onClick={() => onVideoModelChange(m.code)}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                    isActive ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-muted/40 border-transparent hover:bg-muted text-foreground'
                  )}
                >
                  <Film className="w-3 h-3 shrink-0" />
                  <span className="flex-1 truncate text-[10px]">{m.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 分辨率选择器：仅当模型 schema 提供超过 1 个选项时显示 */}
        {showResolutionSelector && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">分辨率</label>
            <div className="flex flex-wrap gap-1">
              {resolutionOptions.map((r) => (
                <button
                  key={r}
                  onClick={() => onVideoResolutionChange(r)}
                  className={cn(
                    'px-2 py-0.5 rounded text-[11px] font-medium border transition-colors',
                    videoResolution === r
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 border-transparent hover:bg-muted'
                  )}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">比例</label>
          <select
            value={videoAspect}
            onChange={(e) => onUpdateCfg({ aspectRatio: e.target.value })}
            className="w-full h-7 px-2 text-[11px] bg-muted/60 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {aspectRatioOptions.map((ar) => (
              <option key={ar.value} value={ar.value}>{ar.label}</option>
            ))}
          </select>
        </div>

        {isSeedance && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">时长</label>
            <select
              value={String(videoDuration)}
              onChange={(e) => onUpdateCfg({ duration: Number(e.target.value) })}
              className="w-full h-7 px-2 text-[11px] bg-muted/60 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {durationOptions.map((opt) => (
                <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {isSeedance && (
          <div className="grid grid-cols-2 gap-1">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">音频</label>
              <div className="flex gap-1">
                {[{ v: true, l: '有声' }, { v: false, l: '无声' }].map(({ v, l }) => (
                  <button
                    key={String(v)}
                    onClick={() => onUpdateCfg({ generateAudio: v })}
                    className={cn(
                      'flex-1 py-0.5 rounded text-[10px] font-medium border transition-colors',
                      generateAudio === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted'
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">镜头</label>
              <div className="flex gap-1">
                {[{ v: false, l: '自由' }, { v: true, l: '固定' }].map(({ v, l }) => (
                  <button
                    key={String(v)}
                    onClick={() => onUpdateCfg({ cameraFixed: v })}
                    className={cn(
                      'flex-1 py-0.5 rounded text-[10px] font-medium border transition-colors',
                      cameraFixed === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-transparent hover:bg-muted'
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          data-testid="canvas-execute-video"
          onClick={onExecute}
          disabled={executing || !hasPrompt}
          className="mt-auto w-full flex items-center justify-center gap-1 bg-primary text-primary-foreground py-2 rounded-lg text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {executing ? <><Loader2 className="w-3 h-3 animate-spin" />提交中</> : <><Play className="w-3 h-3" />执行 · {videoCredits}积分</>}
        </button>
      </div>
    </div>
  )
}
