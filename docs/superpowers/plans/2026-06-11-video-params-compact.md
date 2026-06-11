# 创作页签视频配置改版 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将创作页签视频配置从平铺卡片重构为模型上提 + Popover 工具栏的紧凑布局。

**Architecture:** 从画布 `video-gen-panel.tsx` 提取 `ConfigOptionGroup`、`DurationSlider`、`VideoConfigPopover` 到共享位置。`video-params.tsx` 重写为底部工具栏（ConfigPopover + 积分 + 生成按钮），`video-panel.tsx` 新增顶部模型选择器行（占满宽度 + 模型图片）。

**Tech Stack:** React 18, Radix UI Popover, Tailwind CSS, lucide-react, TypeScript

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `apps/web/src/lib/model-images.ts` | 新建 | 模型 code → 图片 URL 的静态映射 |
| `apps/web/src/components/generation/shared/video-config-popover.tsx` | 新建 | 从 canvas 提取的共享视频配置组件 |
| `apps/web/src/components/generation/video/video-params.tsx` | 重写 | 底部工具栏（ConfigPopover + 积分 + 生成按钮） |
| `apps/web/src/components/generation/video/video-panel.tsx` | 修改 | 新增顶部模型选择器行，调整布局 |
| `apps/web/src/components/canvas/panels/video-gen-panel.tsx` | 修改 | 改为从共享位置导入组件 |

---

### Task 1: 创建模型图片静态映射

**Files:**
- Create: `apps/web/src/lib/model-images.ts`

- [ ] **Step 1: 创建映射文件**

```ts
// apps/web/src/lib/model-images.ts

const MODEL_IMAGES: Record<string, string> = {
  'seedance-2.0': '/models/seedance-2.0.png',
  'seedance-2.0-fast': '/models/seedance-2.0-fast.png',
}

/**
 * 根据模型 code 获取对应的图片 URL
 * 无映射时返回 undefined，调用方应回退为默认图标
 */
export function getModelImage(code: string): string | undefined {
  return MODEL_IMAGES[code]
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/lib/model-images.ts
git commit -m "feat: 添加模型图片静态映射"
```

---

### Task 2: 提取共享视频配置组件

**Files:**
- Create: `apps/web/src/components/generation/shared/video-config-popover.tsx`

从 `canvas/panels/video-gen-panel.tsx` 中提取 `ConfigOptionGroup`、`DurationSlider`、`VideoConfigPopover` 三个组件，适配为通用接口（接受独立的回调函数而非 `onUpdateCfg` patch），供创作页签和画布共同使用。

- [ ] **Step 1: 创建共享组件文件**

```tsx
// apps/web/src/components/generation/shared/video-config-popover.tsx
'use client'

import { useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Clock, Film, Ratio, Video, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── ConfigOptionGroup ───────────────────────────────────────
// pill 形选项组：图标 + 标签 + 选项按钮 + ✓ 标记

export function ConfigOptionGroup({
  icon,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  icon: ReactNode
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  disabled?: boolean
}) {
  if (options.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={disabled}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span>{option.label}</span>
              {active && <Check className="h-3 w-3" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── DurationSlider ──────────────────────────────────────────
// 时长滑块：标签 + range input + 数值显示

export function DurationSlider({
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const safeValue = Math.min(max, Math.max(min, value))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          时长
        </span>
        <span className="font-mono text-primary">{safeValue}s</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={safeValue}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="w-full accent-primary"
      />
    </div>
  )
}

// ─── VideoConfigPopover ──────────────────────────────────────
// 视频配置弹窗：触发按钮显示摘要 + 弹出配置面板
// 接受独立回调函数，兼容创作页签和画布两种使用场景

export interface VideoConfigPopoverProps {
  /** 触发按钮上显示的配置摘要文本 */
  summary: string
  videoResolution: string
  resolutionOptions: string[]
  videoAspect: string
  aspectOptions: Array<{ value: string; label: string }>
  videoDuration: number
  durationOptions: Array<{ value: number; label: string }>
  isSeedance: boolean
  generateAudio: boolean
  cameraFixed: boolean
  /** 是否显示镜头选项（仅 Seedance multimodal 模式） */
  showCameraFixed?: boolean
  onResolutionChange: (value: string) => void
  onAspectRatioChange: (value: string) => void
  onDurationChange: (value: number) => void
  onGenerateAudioChange: (value: boolean) => void
  onCameraFixedChange: (value: boolean) => void
  disabled?: boolean
}

export function VideoConfigPopover({
  summary,
  videoResolution,
  resolutionOptions,
  videoAspect,
  aspectOptions,
  videoDuration,
  durationOptions,
  isSeedance,
  generateAudio,
  cameraFixed,
  showCameraFixed = true,
  onResolutionChange,
  onAspectRatioChange,
  onDurationChange,
  onGenerateAudioChange,
  onCameraFixedChange,
  disabled,
}: VideoConfigPopoverProps) {
  const [open, setOpen] = useState(false)

  const resolutionPopOptions = resolutionOptions.map((r) => ({ value: r, label: r.toUpperCase() }))
  const availableDurationValues = durationOptions
    .map((option) => option.value)
    .filter((v) => Number.isFinite(v) && v > 0)
  const durationMin = availableDurationValues.length > 0 ? Math.min(...availableDurationValues) : 4
  const durationMax = availableDurationValues.length > 0 ? Math.max(...availableDurationValues) : 15

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex min-w-[260px] max-w-[360px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors',
            open
              ? 'border-primary/40 bg-primary/5 text-primary'
              : 'border-border/60 bg-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground',
          )}
          disabled={disabled}
          title="视频配置"
        >
          <Film className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left font-medium">{summary}</span>
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[120] w-72 space-y-3 rounded-xl border border-border/80 bg-popover p-3 shadow-xl shadow-foreground/5 animate-in fade-in-0 zoom-in-95"
        >
          <div className="text-xs font-semibold text-popover-foreground">视频配置</div>
          <ConfigOptionGroup
            icon={<Film className="h-3 w-3" />}
            label="分辨率"
            value={videoResolution}
            options={resolutionPopOptions}
            onChange={onResolutionChange}
          />
          <ConfigOptionGroup
            icon={<Ratio className="h-3 w-3" />}
            label="画面比例"
            value={videoAspect}
            options={aspectOptions}
            onChange={onAspectRatioChange}
          />
          {isSeedance && (
            <>
              <DurationSlider
                value={videoDuration}
                min={durationMin}
                max={durationMax}
                onChange={onDurationChange}
              />
              <ConfigOptionGroup
                icon={<Volume2 className="h-3 w-3" />}
                label="音频"
                value={String(generateAudio)}
                options={[
                  { value: 'true', label: '有声' },
                  { value: 'false', label: '无声' },
                ]}
                onChange={(val) => onGenerateAudioChange(val === 'true')}
              />
              {showCameraFixed && (
                <ConfigOptionGroup
                  icon={<Video className="h-3 w-3" />}
                  label="镜头"
                  value={String(cameraFixed)}
                  options={[
                    { value: 'false', label: '自由镜头' },
                    { value: 'true', label: '固定镜头' },
                  ]}
                  onChange={(val) => onCameraFixedChange(val === 'true')}
                />
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/generation/shared/video-config-popover.tsx
git commit -m "feat: 提取共享视频配置组件 (ConfigOptionGroup, DurationSlider, VideoConfigPopover)"
```

---

### Task 3: 重写 video-params.tsx

**Files:**
- Modify: `apps/web/src/components/generation/video/video-params.tsx`

将当前平铺的配置卡片重写为底部工具栏：左侧 ConfigPopover 摘要按钮 + 右侧积分 + 生成按钮。移除模型相关 UI（模型选择器将移到 video-panel.tsx 顶部）。

- [ ] **Step 1: 重写 video-params.tsx**

```tsx
// apps/web/src/components/generation/video/video-params.tsx
'use client'

import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Coins } from 'lucide-react'
import { extractSchemaEnums, getPriceByResolution } from '../shared/schema-utils'
import { calculateReferenceVideoDurationSeconds, parseCategoryReferences, type ModelItem, type VideoCategory } from '@aigc/types'
import { VideoConfigPopover } from '../shared/video-config-popover'

type VideoMode = VideoCategory

interface VideoParamsProps {
  models?: ModelItem[]
  videoMode: VideoMode
  videoModel: string
  videoAspectRatio: string
  videoResolution: string
  videoDuration: number
  referenceVideoDurations: number[]
  videoGenerateAudio: boolean
  videoCameraFixed: boolean
  isSeedance: boolean
  isGenerating: boolean
  isUploading: boolean
  disabled?: boolean
  promptEmpty?: boolean
  onAspectRatioChange: (v: string) => void
  onResolutionChange: (v: string) => void
  onDurationChange: (v: number) => void
  onGenerateAudioChange: (v: boolean) => void
  onCameraFixedChange: (v: boolean) => void
  onGenerate: () => void
}

export function VideoParams({
  models, videoMode, videoModel, videoAspectRatio, videoResolution, videoDuration,
  referenceVideoDurations, videoGenerateAudio, videoCameraFixed, isSeedance,
  isGenerating, isUploading, disabled, promptEmpty,
  onAspectRatioChange, onResolutionChange, onDurationChange,
  onGenerateAudioChange, onCameraFixedChange,
  onGenerate,
}: VideoParamsProps) {
  const isDisabled = isGenerating || isUploading || !!disabled

  const currentDbModel = models?.find((m) => m.code === videoModel)

  const dbResolutions = extractSchemaEnums(currentDbModel?.params_schema, 'resolution')
  const dbAspectRatios = extractSchemaEnums(currentDbModel?.params_schema, 'aspect_ratio')
  const dbDurationOptions = extractSchemaEnums(currentDbModel?.params_schema, 'time_length').map((item) => {
    const num = Number(item.value)
    return { value: num, label: num === -1 ? '自动' : `${num}秒` }
  })

  // 当前生效分辨率
  const activeResolution = videoResolution || dbResolutions[0]?.value || '720p'

  // 积分计算
  const unitPrice = currentDbModel ? getPriceByResolution(currentDbModel, activeResolution) : 0
  const billableDuration = (videoDuration === -1 ? 15 : videoDuration) + calculateReferenceVideoDurationSeconds(referenceVideoDurations)
  const estimatedCredits = isSeedance ? billableDuration * unitPrice : unitPrice

  // ConfigPopover 摘要文本
  const currentAspectLabel = dbAspectRatios.find((ar) => ar.value === videoAspectRatio)?.label ?? videoAspectRatio
  const currentDurationLabel = dbDurationOptions.find((opt) => opt.value === videoDuration)?.label ?? `${videoDuration}s`
  const configSummary = [
    activeResolution.toUpperCase(),
    currentAspectLabel,
    isSeedance ? currentDurationLabel : null,
    isSeedance ? (videoGenerateAudio ? '有声' : '无声') : null,
    isSeedance && videoMode !== 'frames' ? (videoCameraFixed ? '固定镜头' : '自由镜头') : null,
  ].filter(Boolean).join(' · ')

  // 分辨率选项：只有一个时也显示（保持信息可见）
  const resolutionOptions = dbResolutions.map((r) => r.value)

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      {/* 左侧：配置摘要 Popover */}
      <VideoConfigPopover
        summary={configSummary}
        videoResolution={activeResolution}
        resolutionOptions={resolutionOptions}
        videoAspect={videoAspectRatio}
        aspectOptions={dbAspectRatios}
        videoDuration={videoDuration}
        durationOptions={dbDurationOptions}
        isSeedance={isSeedance}
        generateAudio={videoGenerateAudio}
        cameraFixed={videoCameraFixed}
        showCameraFixed={videoMode !== 'frames'}
        onResolutionChange={onResolutionChange}
        onAspectRatioChange={onAspectRatioChange}
        onDurationChange={onDurationChange}
        onGenerateAudioChange={onGenerateAudioChange}
        onCameraFixedChange={onCameraFixedChange}
        disabled={isDisabled}
      />

      {/* 右侧：积分 + 生成按钮 */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 text-sm font-medium">
          <Coins className="h-4 w-4 text-amber-500" />
          <span>{estimatedCredits} A豆</span>
        </div>
        <Button variant="gradient" size="lg" className="gap-2 px-8" onClick={onGenerate} disabled={isDisabled || promptEmpty}>
          {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" />上传中...</>
            : isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </div>
  )
}
```

**注意：** 移除了 `onModelChange`、`onSaveDefaults`、`videoModel` 相关的模型选择 UI 和"设为默认"按钮（这些移到 video-panel.tsx 的模型选择器行）。同时移除了 `onModelChange` 和 `onSaveDefaults` 回调。

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/generation/video/video-params.tsx
git commit -m "feat: 重写 video-params 为底部工具栏布局"
```

---

### Task 4: 调整 video-panel.tsx

**Files:**
- Modify: `apps/web/src/components/generation/video/video-panel.tsx`

在卡片顶部新增模型选择器行（占满宽度 + 模型图片 + 设为默认）。移除传给 `VideoParamsPanel` 的模型相关 props，改为传入新 props。将 `handleSaveDefaults` 保持在 video-panel 中直接使用。

- [ ] **Step 1: 更新 video-panel.tsx**

需要修改的部分：

**1) 新增 import：**

在文件顶部添加：

```ts
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Coins, Film } from 'lucide-react'
import { getModelImage } from '@/lib/model-images'
import type { ModelItem } from '@aigc/types'
```

**2) 新增模型选择器子组件（在 VideoPanel 函数外部）：**

```tsx
/** 模型选择器行 — 占满宽度，显示模型图片 + 名称 + 设为默认 */
function ModelSelectorRow({
  models,
  videoModel,
  isDisabled,
  onModelChange,
  onSaveDefaults,
}: {
  models?: ModelItem[]
  videoModel: string
  isDisabled: boolean
  onModelChange: (v: string) => void
  onSaveDefaults: () => void
}) {
  const [open, setOpen] = useState(false)
  const currentModel = models?.find((m) => m.code === videoModel)
  const modelImage = getModelImage(videoModel)
  const modelOptions = (models ?? []).map((m) => ({ value: m.code, label: m.name }))

  return (
    <div className="flex items-center gap-3 shrink-0">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'flex flex-1 items-center gap-3 rounded-lg border px-3 py-2 transition-colors text-left',
              open
                ? 'border-primary/40 bg-primary/5'
                : 'border-border/60 bg-background hover:border-primary/30',
            )}
            disabled={isDisabled}
          >
            {/* 模型图片或默认图标 */}
            {modelImage ? (
              <img src={modelImage} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <Film className="h-5 w-5 text-primary" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{currentModel?.name ?? videoModel}</div>
              {currentModel?.description && (
                <div className="text-[11px] text-muted-foreground truncate">{currentModel.description}</div>
              )}
            </div>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className="z-[120] max-h-72 min-w-[240px] overflow-y-auto rounded-xl border border-border/80 bg-popover p-1.5 shadow-xl shadow-foreground/5 animate-in fade-in-0 zoom-in-95"
          >
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">选择模型</div>
            {modelOptions.map((option) => {
              const isActive = option.value === videoModel
              const modelItem = models?.find((m) => m.code === option.value)
              const img = getModelImage(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { onModelChange(option.value); setOpen(false) }}
                  disabled={isDisabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-popover-foreground hover:bg-muted',
                    isDisabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {img ? (
                    <img src={img} alt="" className="h-8 w-8 rounded-md object-cover shrink-0" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
                      <Film className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isActive && <Check className="h-3 w-3 shrink-0" />}
                </button>
              )
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
        disabled={isDisabled}
        onClick={onSaveDefaults}
      >
        设为默认
      </button>
    </div>
  )
}
```

**3) 更新 VideoPanel 的 return JSX：**

将 `return` 部分改为：

```tsx
return (
  <>
    <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-2">
      {/* ① 模型选择器行（占满宽度） */}
      <ModelSelectorRow
        models={videoModels}
        videoModel={videoModel}
        isDisabled={isVideoGenerating || isVideoUploading || !!disabled}
        onModelChange={setVideoModel}
        onSaveDefaults={handleSaveDefaults}
      />

      {/* ② 模式切换 */}
      <div className="flex gap-2 shrink-0">
        {availableVideoModes.map((mode) => (
          <button key={mode} onClick={() => switchMode(mode)} className={modeBtnCls(videoMode === mode)}>
            {currentCategoryReferences[mode]?.label ?? mode}
          </button>
        ))}
      </div>

      {/* ③ 参考素材区 */}
      {videoMode === 'frames' && (
        <VideoFramesZone
          firstFrame={firstFrame}
          lastFrame={lastFrame}
          framePreviewIndex={framePreviewIndex}
          onFirstFrameChange={setFirstFrame}
          onLastFrameChange={setLastFrame}
          onPreviewIndexChange={setFramePreviewIndex}
          onFrameDrop={handleFrameDrop}
          onFileRead={readFrameFile}
        />
      )}
      {videoMode === 'multimodal' && currentCategoryReferences.multimodal && (
        <VideoMultimodalZone
          images={multimodalImages}
          videos={multimodalVideos}
          audios={multimodalAudios}
          isSeedance={isSeedance}
          referenceLimits={multimodalReferenceLimits}
          onImagesChange={setMultimodalImages}
          onVideosChange={setMultimodalVideos}
          onAudiosChange={setMultimodalAudios}
        />
      )}

      {/* ④ 提示词输入 */}
      <div className="flex-1 min-h-0">
        <Textarea
          placeholder="描述你想要生成的视频内容..."
          value={videoPrompt}
          onChange={(e) => setVideoPrompt(e.target.value)}
          className="h-full resize-none"
          disabled={isVideoGenerating || disabled}
        />
      </div>
    </div>

    {/* ⑤ 底部工具栏 */}
    <VideoParamsPanel
      models={videoModels}
      videoMode={videoMode}
      videoModel={videoModel}
      videoAspectRatio={videoAspectRatio}
      videoResolution={videoResolution}
      videoDuration={videoDuration}
      referenceVideoDurations={multimodalVideos.map((video) => video.duration)}
      videoGenerateAudio={videoGenerateAudio}
      videoCameraFixed={videoCameraFixed}
      isSeedance={isSeedance}
      isGenerating={isVideoGenerating}
      isUploading={isVideoUploading}
      disabled={disabled}
      promptEmpty={!videoPrompt.trim()}
      onAspectRatioChange={setVideoAspectRatio}
      onResolutionChange={setVideoResolution}
      onDurationChange={setVideoDuration}
      onGenerateAudioChange={setVideoGenerateAudio}
      onCameraFixedChange={setVideoCameraFixed}
      onGenerate={handleVideoGenerate}
    />
  </>
)
```

**注意：** `VideoParamsPanel` 不再接收 `onModelChange` 和 `onSaveDefaults`，模型相关逻辑由 `ModelSelectorRow` 处理。`models` 仍然传给 `VideoParamsPanel` 用于积分计算和 schema 提取。

- [ ] **Step 2: 清理 video-panel.tsx 中不再需要的 import**

确认移除以下不再使用的导入（如果存在）：无，所有现有 import 仍被保留使用。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/generation/video/video-panel.tsx
git commit -m "feat: video-panel 新增模型选择器行，调整布局顺序"
```

---

### Task 5: 更新画布面板使用共享组件

**Files:**
- Modify: `apps/web/src/components/canvas/panels/video-gen-panel.tsx`

将画布面板中内联的 `ConfigOptionGroup`、`DurationSlider`、`VideoConfigPopover` 替换为从共享位置导入，删除原有的内联定义。

- [ ] **Step 1: 更新导入**

在 `video-gen-panel.tsx` 顶部添加：

```ts
import { VideoConfigPopover } from '@/components/generation/shared/video-config-popover'
```

- [ ] **Step 2: 删除内联定义**

删除以下三个函数定义（约 114~305 行）：
- `ConfigOptionGroup`
- `DurationSlider`
- `VideoConfigPopover`

保留 `getReferenceBadgeClass`、`ReferencePreviewItem`、`ReferencePreviewGroup`、`VIDEO_MODE_TO_CATEGORY`、`CATEGORY_TO_VIDEO_MODE` 等画布专有组件。

- [ ] **Step 3: 更新 VideoConfigPopover 调用处**

在 `VideoGenPanel` 的底部工具栏中，将原来的 `VideoConfigPopover` 调用改为适配新的独立回调接口：

```tsx
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
  cameraFixed={cameraFixed}
  showCameraFixed={videoMode !== 'keyframe'}  // 画布 keyframe 模式不显示镜头选项
  onResolutionChange={onVideoResolutionChange}
  onAspectRatioChange={(val) => onUpdateCfg({ aspectRatio: val })}
  onDurationChange={(val) => onUpdateCfg({ duration: val })}
  onGenerateAudioChange={(val) => onUpdateCfg({ generateAudio: val })}
  onCameraFixedChange={(val) => onUpdateCfg({ cameraFixed: val })}
/>
```

- [ ] **Step 4: 清理不再需要的 import**

移除不再使用的导入：`Check`（已由共享组件内部使用），`Clock`（已由 DurationSlider 使用），`Ratio`、`Volume2`、`Video`（已由 VideoConfigPopover 使用）。同时移除 `useState` 如果画布文件中不再有其他使用（确认 `useState` 在文件中是否还有其他用途，如有则保留）。

确认 `useState` 仍被其他逻辑使用 — 保留。

清理后的 import 行：

```ts
import { useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Cpu, Film, ImageIcon, Music, Play, X } from 'lucide-react'
```

**注意：** `Popover` 和 `ChevronDown` 仍被其他画布逻辑使用。`Check`, `Clock`, `Ratio`, `Volume2`, `Video` 可以移除。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/panels/video-gen-panel.tsx
git commit -m "refactor: 画布视频面板改用共享视频配置组件"
```

---

## 自审检查

- **Spec 覆盖：** ✅ 模型选择器占满宽度 + 图片（Task 4）、ConfigPopover 收缩参数（Task 3）、底部工具栏一行（Task 3）、模型图片映射（Task 1）、共享组件提取（Task 2）
- **占位符扫描：** ✅ 无 TBD/TODO
- **类型一致性：** ✅ `VideoConfigPopover` 的 props 接口在 Task 2 定义，Task 3 和 Task 5 使用一致的属性名
- **不变部分：** ✅ 模式切换、参考素材区、提示词、生成逻辑均未改动
