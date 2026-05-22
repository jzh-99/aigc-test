import { Film, ImageIcon, Loader2, Music, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VideoMode } from '@/lib/canvas/types'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import { getVideoCategoryKeys, parseVideoCategories, type ModelItem, type VideoCategory } from '@aigc/types'

const VIDEO_MODE_TO_CATEGORY: Record<VideoMode, VideoCategory> = {
  multiref: 'multimodal',
  keyframe: 'frames',
}

const CATEGORY_TO_VIDEO_MODE: Record<VideoCategory, VideoMode> = {
  multimodal: 'multiref',
  frames: 'keyframe',
}

interface VideoGenPanelProps {
  promptDraft: string
  setPromptDraft: (value: string) => void
  flushPromptDraft: () => void
  upstreamTextNodeLabels: string[]
  multirefImages: string[]
  multirefVideos: string[]
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
  multirefImages,
  multirefVideos,
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

  const videoCredits = currentDbModel
    ? getPriceByResolution(currentDbModel, String(videoDuration), currentDbModel.credit_cost)
    : 0

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
        <textarea
          className="flex-1 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px]"
          placeholder="描述视频内容..."
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          onBlur={flushPromptDraft}
        />

        {videoMode === 'multiref' && (
          <div className="space-y-1">
            {(multirefImages.length + multirefVideos.length + multirefAudios.length) === 0 ? (
              <div className="text-[10px] text-muted-foreground bg-muted/20 rounded-lg p-2 text-center">
                可连接图片、视频、音频节点
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {multirefImages.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
                    <ImageIcon className="w-3 h-3" />图片 x{multirefImages.length}
                  </span>
                )}
                {multirefVideos.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-[10px] text-violet-600 font-medium">
                    <Film className="w-3 h-3" />视频 x{multirefVideos.length}
                  </span>
                )}
                {multirefAudios.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-600 font-medium">
                    <Music className="w-3 h-3" />音频 x{multirefAudios.length}
                  </span>
                )}
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
