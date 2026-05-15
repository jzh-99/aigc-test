import { Film, ImageIcon, Loader2, Music, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VideoMode } from '@/lib/canvas/types'
import {
  SEEDANCE_DURATION_OPTIONS,
  VIDEO_ASPECT_RATIOS_SEEDANCE,
  VIDEO_ASPECT_RATIOS_VEO,
  VIDEO_CREDITS_PER_SEC,
  VIDEO_MODEL_OPTIONS,
} from './panel-constants'
import { extractSchemaEnums, getPriceByResolution } from '@/components/generation/shared/schema-utils'
import type { ModelItem } from '@aigc/types'

// canvas videoMode 到 DB video_categories 的映射
const VIDEO_MODE_TO_CATEGORY: Record<VideoMode, string> = {
  multiref: 'multimodal',
  keyframe: 'frames',
}

interface VideoGenPanelProps {
  promptDraft: string
  setPromptDraft: (value: string) => void
  flushPromptDraft: () => void
  upstreamTextNodeLabels: string[]
  orderedImageRefCount: number
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
  /** 动态模型列表，来自 /models?module=video */
  models?: ModelItem[]
  modelsReady?: boolean
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
  orderedImageRefCount,
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
  modelsReady,
  onVideoModelChange,
  onVideoModeChange,
  onUpdateCfg,
  onExecute,
}: VideoGenPanelProps) {
  const useDbModels = modelsReady && models && models.length > 0
  const currentDbModel = useDbModels ? models!.find((m) => m.code === videoModel) : undefined
  const currentStaticModel = VIDEO_MODEL_OPTIONS.find((m) => m.value === videoModel) ?? VIDEO_MODEL_OPTIONS[0]

  // isSeedance：优先从 DB 模型 code 判断，fallback 到静态常量
  const isSeedance = currentDbModel ? currentDbModel.code.startsWith('seedance-') : currentStaticModel.isSeedance

  // supportsMultiref：DB 模型通过 video_categories 判断，fallback 到静态常量
  const getSupportsMultiref = (m: ModelItem) => {
    const cats = Array.isArray(m.video_categories) ? (m.video_categories as string[]) : []
    return cats.length === 0 || cats.includes('multimodal')
  }

  // 过滤当前 videoMode 可用的模型列表
  const filteredModels = useDbModels
    ? models!.filter((m) => {
        const cats = Array.isArray(m.video_categories) ? (m.video_categories as string[]) : []
        const targetCategory = VIDEO_MODE_TO_CATEGORY[videoMode]
        // video_categories 为空时不过滤（兼容未配置的模型）
        return cats.length === 0 || cats.includes(targetCategory)
      })
    : VIDEO_MODEL_OPTIONS.filter((m) => videoMode === 'multiref' ? m.supportsMultiref : m.supportsKeyframe)

  // 比例选项：优先从 DB 模型 params_schema 提取
  const aspectRatioOptions: Array<{ value: string; label: string }> = (() => {
    if (currentDbModel) {
      const enums = extractSchemaEnums(currentDbModel.params_schema, 'aspect_ratio')
      if (enums.length > 0) return enums.map((v) => ({ value: v, label: v }))
    }
    return [...(isSeedance ? VIDEO_ASPECT_RATIOS_SEEDANCE : VIDEO_ASPECT_RATIOS_VEO)]
  })()

  // 时长选项：优先从 DB 模型 params_schema 提取
  const durationOptions: Array<{ value: number; label: string }> = (() => {
    if (currentDbModel) {
      const enums = extractSchemaEnums(currentDbModel.params_schema, 'time_length')
      if (enums.length > 0) {
        return enums.map((v) => {
          const num = Number(v)
          return { value: num, label: num === -1 ? '自动' : `${num}s` }
        })
      }
    }
    return [...SEEDANCE_DURATION_OPTIONS]
  })()

  // 积分计算：优先从 DB 模型 params_pricing 获取
  const videoCredits = (() => {
    if (currentDbModel) {
      const fallback = (VIDEO_CREDITS_PER_SEC[videoModel] ?? 3) * (videoDuration === -1 ? 15 : videoDuration)
      return getPriceByResolution(currentDbModel, String(videoDuration), fallback)
    }
    return isSeedance
      ? (VIDEO_CREDITS_PER_SEC[videoModel] ?? 3) * (videoDuration === -1 ? 15 : videoDuration)
      : (VIDEO_CREDITS_PER_SEC[videoModel] ?? 10)
  })()

  // 当前模型是否支持 multiref（用于禁用按钮）
  const currentSupportsMultiref = currentDbModel
    ? getSupportsMultiref(currentDbModel)
    : currentStaticModel.supportsMultiref

  return (
    <div className="flex gap-0 divide-x divide-border">
      <div className="p-3 flex flex-col gap-2" style={{ width: 220 }}>
        <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-medium">
          <button
            data-testid="video-mode-multiref"
            onClick={() => onVideoModeChange('multiref')}
            disabled={!currentSupportsMultiref}
            className={cn(
              'flex-1 py-1 transition-colors',
              videoMode === 'multiref'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            全能参考
          </button>
          <button
            data-testid="video-mode-keyframe"
            onClick={() => onVideoModeChange('keyframe')}
            className={cn(
              'flex-1 py-1 transition-colors',
              videoMode === 'keyframe'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted'
            )}
          >
            首尾帧
          </button>
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
          <div className="space-y-2">
            {multirefImages.length > 0 && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />参考图 ({multirefImages.length})
                </label>
                <div className="flex gap-1 flex-wrap">
                  {multirefImages.map((url, i) => (
                    <div key={i} className="relative w-12 h-12 rounded border border-border overflow-hidden">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <span className="absolute -top-1 -left-1 text-[8px] bg-blue-500 text-white rounded px-0.5 font-bold">{i + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {multirefVideos.length > 0 && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Film className="w-3 h-3" />参考视频 ({multirefVideos.length})
                </label>
                <div className="flex gap-1 flex-wrap">
                  {multirefVideos.map((url, i) => (
                    <div key={i} className="relative w-12 h-12 rounded border border-border bg-zinc-900 flex items-center justify-center overflow-hidden">
                      <video src={url} className="w-full h-full object-cover" muted preload="metadata" />
                      <span className="absolute -top-1 -left-1 text-[8px] bg-violet-500 text-white rounded px-0.5 font-bold">{i + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {multirefAudios.length > 0 && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Music className="w-3 h-3" />参考音频 ({multirefAudios.length})
                </label>
                <div className="flex flex-col gap-1">
                  {multirefAudios.map((url, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted/20">
                      <Music className="w-3 h-3 text-muted-foreground shrink-0" />
                      <audio src={url} controls className="h-6 w-full" style={{ minWidth: 0 }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {orderedImageRefCount === 0 && (
              <div className="text-[10px] text-muted-foreground bg-muted/20 rounded-lg p-2 text-center">
                可连接图片、视频、音频节点
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
            {useDbModels
              ? (filteredModels as ModelItem[]).map((m) => {
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
                })
              : (filteredModels as typeof VIDEO_MODEL_OPTIONS).map((m) => {
                  const isActive = videoModel === m.value
                  return (
                    <button
                      key={m.value}
                      onClick={() => onVideoModelChange(m.value)}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors border',
                        isActive ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-muted/40 border-transparent hover:bg-muted text-foreground'
                      )}
                    >
                      <Film className="w-3 h-3 shrink-0" />
                      <span className="flex-1 truncate text-[10px]">{m.label}</span>
                    </button>
                  )
                })}
          </div>
        </div>

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
