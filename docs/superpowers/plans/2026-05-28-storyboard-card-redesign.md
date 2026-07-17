# Storyboard Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将绘本分镜步骤改为横向单列卡片，支持画面提示词 @ 引用、可编辑中英文旁白、双语音频播放器，并让分镜图片生成携带匹配到的角色/背景参考图。

**Architecture:** 前端拆出两个聚焦组件：`StoryboardMentionEditor` 负责 contentEditable @ 引用编辑，`StoryboardAudioPlayer` 负责迷你音频播放控制；`StepStoryboard` 只编排卡片布局、进度和局部更新。后端在现有 picture-book 路由内新增可测试 helper，生成分镜提示词时要求 AI 输出 @ 标记，生成分镜图片时解析 @ 标记并把匹配资产图片写入 `params.image`。

**Tech Stack:** Next.js 14 App Router、React 18、Tailwind CSS、Radix UI Tooltip、lucide-react、Fastify 4、TypeScript、node:test。

---

## 视觉参考

执行前先打开这些 brainstorm 产物作为样式参考，不直接复制内联 HTML/CSS，落地时使用 Tailwind 和项目现有 `bg-card`、`bg-muted`、`border`、`text-muted-foreground` 等主题 token：

- `.superpowers/brainstorm/3840-1779954183/content/storyboard-layout.html`
  - 参考横向布局方案：每行一个分镜，左侧媒体，右侧信息编辑。
- `.superpowers/brainstorm/3840-1779954183/content/storyboard-final.html`
  - 主要参考文件：`280px + 1fr` 双列、图片左上页码、右下状态、图片下方双语播放器、操作按钮、右侧提示词和旁白编辑区。
- `.superpowers/brainstorm/3840-1779954183/content/storyboard-audio.html`
  - 只参考双语播放器的行内结构和进度展示；语气词/停顿 UI 属于后续版本，本计划不实现。

视觉落地约束：

- 卡片外框使用 `rounded-lg border bg-card`，不要使用参考稿里的 `rounded:12px` 大圆角。
- 左侧媒体列在 `lg` 以上固定 `280px`，列间距保持紧凑，移动端自然堆叠。
- 图片区域保留 `state.settings.aspectRatio` 控制的比例，左上角显示页码徽标，右下角显示「已生成/生成中/未生成」状态。
- @ pill 颜色贴近参考稿：角色使用深紫视觉，背景使用深蓝视觉，但用 Tailwind 类表达。
- 音频播放器使用一行一个语言，圆形播放按钮、细进度条、时长、语言标签都必须在同一行内，不换行挤压。

---

## 文件结构

- Modify: `apps/api/src/routes/picture-book/post-storyboard-prompts.ts`
  - 增强 system/user prompt，明确 `imagePrompt` 必须使用 `@角色名` / `@背景名`。
- Modify: `apps/api/src/routes/picture-book/post-generate-storyboard-images.ts`
  - 新增 `findStoryboardReferenceImages()` / `extractStoryboardMentionLabels()` helper，并在生成图片 payload 的 `params.image` 中追加引用图片。
- Modify: `apps/api/src/__tests__/picture-book-generation.test.ts`
  - 覆盖 AI prompt 中的 @ 标记要求。
- Modify: `apps/api/src/__tests__/picture-book-media.test.ts`
  - 覆盖 @ 标记解析、角色/背景匹配、无图/重复引用过滤。
- Create: `apps/web/src/components/picture-book/storyboard-mention-editor.tsx`
  - 绘本专用 @ 引用编辑器，数据源来自 `state.assets.characters/backgrounds`。
- Create: `apps/web/src/components/picture-book/storyboard-audio-player.tsx`
  - 自定义迷你音频播放器，支持播放/暂停、进度条、时长。
- Modify: `apps/web/src/components/picture-book/step-storyboard.tsx`
  - 改为横向单列布局，接入 @ 编辑器、旁白 Textarea、双语音频播放器和 lightbox。
- Modify: `apps/web/src/app/(dashboard)/toby-studio/picture-book/[id]/page.tsx`
  - 收紧批量/单页重新生成时的本地 pending 标记，确保重新生成会从完成计数和下一步门控中移除。

---

### Task 1: 后端分镜提示词要求 AI 自动写入 @ 标记

**Files:**
- Modify: `apps/api/src/routes/picture-book/post-storyboard-prompts.ts`
- Modify: `apps/api/src/__tests__/picture-book-generation.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/__tests__/picture-book-generation.test.ts` 的 `storyboard prompt helper 保留脚本单语结构并输出双语音频文本` 用例中追加断言：

```ts
assert.match(prompt, /@角色名/)
assert.match(prompt, /@背景名/)
assert.match(prompt, /小狗/)
assert.match(prompt, /只在 imagePrompt 中使用 @/)
```

再把该用例的 `backgrounds` 从空数组改为：

```ts
backgrounds: [{ id: 'background_1', name: '花园', prompt: '花园背景设定图', imageUrl: 'https://img.test/garden.png' }],
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @aigc/api exec tsx --test src/__tests__/picture-book-generation.test.ts
```

Expected: FAIL，失败信息包含 `Expected input to match`，因为 prompt 还没有写 @ 标记规则。

- [ ] **Step 3: 更新 prompt 文案**

在 `DEFAULT_SYSTEM_PROMPT` 中追加这些句子：

```ts
'imagePrompt 必须在需要引用资产时使用 @角色名 / @背景名 字面量，例如 @小狗、@森林。',
'@ 引用只允许出现在 imagePrompt 中，audioText.zh 和 audioText.en 禁止出现 @ 标记。',
'如果角色或背景列表为空，不要虚构 @ 标记。',
```

在 `buildStoryboardPromptUserPrompt()` 中把图片提示词要求替换为：

```ts
'imagePrompt 要参考角色和背景设定，保持整本绘本一致性。',
'当画面出现某个角色或背景时，必须直接写入对应资产名称的 @ 标记，例如 @角色名 或 @背景名。',
'只在 imagePrompt 中使用 @ 标记；audioText.zh 与 audioText.en 不使用 @ 标记。',
'audioText.zh 与 audioText.en 来自该页旁白和台词，不要改变页数。',
```

并在角色/背景 JSON 前加入可读清单，降低模型漏标概率：

```ts
`可引用角色名称：${input.characters.map(item => `@${item.name}`).join('、') || '无'}`,
`可引用背景名称：${input.backgrounds.map(item => `@${item.name}`).join('、') || '无'}`,
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
pnpm --filter @aigc/api exec tsx --test src/__tests__/picture-book-generation.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/routes/picture-book/post-storyboard-prompts.ts apps/api/src/__tests__/picture-book-generation.test.ts
git commit -m "feat: require storyboard asset mentions"
```

---

### Task 2: 后端生成分镜图片时解析 @ 引用并传参考图

**Files:**
- Modify: `apps/api/src/routes/picture-book/post-generate-storyboard-images.ts`
- Modify: `apps/api/src/__tests__/picture-book-media.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/__tests__/picture-book-media.test.ts` 导入新增 helper：

```ts
import {
  findStoryboardReferenceImages,
  makeStoryboardAudioText,
  selectStoryboardImageTargets,
} from '../routes/picture-book/post-generate-storyboard-images.js'
```

新增测试：

```ts
test('findStoryboardReferenceImages 从 @ 标记匹配角色和背景图片并去重', () => {
  const state = {
    assets: {
      characters: [
        { id: 'character_1', name: '小狗', prompt: '小狗设定图', imageUrl: 'https://img.test/dog.png' },
        { id: 'character_2', name: '小猫', prompt: '小猫设定图', imageUrl: null },
      ],
      backgrounds: [
        { id: 'background_1', name: '花园', prompt: '花园设定图', imageUrl: 'https://img.test/garden.png' },
      ],
    },
  }

  assert.deepEqual(
    findStoryboardReferenceImages('@小狗 在 @花园 遇见 @小狗 和 @小猫', state as any),
    ['https://img.test/dog.png', 'https://img.test/garden.png'],
  )
})

test('findStoryboardReferenceImages 不匹配普通文字里的名称', () => {
  const state = {
    assets: {
      characters: [{ id: 'character_1', name: '小狗', prompt: '小狗设定图', imageUrl: 'https://img.test/dog.png' }],
      backgrounds: [],
    },
  }

  assert.deepEqual(findStoryboardReferenceImages('小狗在奔跑，没有 @ 标记', state as any), [])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @aigc/api exec tsx --test src/__tests__/picture-book-media.test.ts
```

Expected: FAIL，失败信息包含 `does not provide an export named 'findStoryboardReferenceImages'`。

- [ ] **Step 3: 实现引用解析 helper**

在 `apps/api/src/routes/picture-book/post-generate-storyboard-images.ts` 中加入：

```ts
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractStoryboardMentionLabels(prompt: string, labels: string[]): string[] {
  const sortedLabels = labels.filter(Boolean).sort((a, b) => b.length - a.length)
  if (sortedLabels.length === 0) return []

  const pattern = new RegExp(`@(${sortedLabels.map(escapeRegExp).join('|')})(?=\\s|$|[，。,.、；;！!？?])`, 'g')
  const matched: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(prompt))) {
    if (!matched.includes(match[1])) matched.push(match[1])
  }
  return matched
}

export function findStoryboardReferenceImages(prompt: string, state: PictureBookState): string[] {
  const assets = state.assets.characters.concat(state.assets.backgrounds)
  const labels = assets.map(item => item.name)
  const mentionLabels = extractStoryboardMentionLabels(prompt, labels)
  const imageUrls: string[] = []

  for (const label of mentionLabels) {
    const asset = assets.find(item => item.name === label)
    if (asset?.imageUrl && !imageUrls.includes(asset.imageUrl)) imageUrls.push(asset.imageUrl)
  }

  return imageUrls
}
```

- [ ] **Step 4: 把参考图写入图片生成 payload**

在生成图片循环里、调用 `app.inject` 前定义：

```ts
const referenceImages = findStoryboardReferenceImages(target.prompt, access.state)
```

把 `params` 改为：

```ts
params: {
  ...makePictureBookImageParams(request.body.project_id, target.refId, access.style, access.state.settings.aspectRatio ?? '16:9'),
  ...(referenceImages.length > 0 ? { image: referenceImages } : {}),
  ...(request.body.params ?? {}),
},
```

注意：`request.body.params` 放最后，保持调用方显式参数优先；如果后续需要强制使用 storyboard 引用图，再单独调整。

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
pnpm --filter @aigc/api exec tsx --test src/__tests__/picture-book-media.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/routes/picture-book/post-generate-storyboard-images.ts apps/api/src/__tests__/picture-book-media.test.ts
git commit -m "feat: attach storyboard reference images"
```

---

### Task 3: 新建绘本分镜 @ 引用编辑器

**Files:**
- Create: `apps/web/src/components/picture-book/storyboard-mention-editor.tsx`
- Modify: `apps/web/src/components/picture-book/step-storyboard.tsx`

- [ ] **Step 1: 新建组件并复用画布编辑器模式**

创建 `apps/web/src/components/picture-book/storyboard-mention-editor.tsx`。组件接口固定为：

```ts
interface StoryboardMentionResource {
  id: string
  kind: 'character' | 'background'
  name: string
  imageUrl?: string | null
}

interface StoryboardMentionEditorProps {
  value: string
  resources: StoryboardMentionResource[]
  placeholder?: string
  onChange: (value: string) => void
  onBlur?: () => void
}
```

实现要求：

```ts
const PROMPT_MAX_LENGTH = 1200
const CHARACTER_TOKEN_CLASS = 'text-indigo-200 bg-indigo-950/80 border-indigo-700'
const BACKGROUND_TOKEN_CLASS = 'text-blue-200 bg-blue-950/80 border-blue-700'
```

行为必须与 `apps/web/src/components/canvas/panels/resource-mention-textarea.tsx` 一致：

- `contentEditable` 显示纯文本。
- 已匹配的 `@名称` 渲染为 `span[data-mention-text]` pill。
- 输入独立的 `@` 后展示下拉。
- 下拉按「角色」「背景」分组。
- 点击选项插入 `@名称 `。
- Backspace/Delete 删除整个 pill。
- `getEditorPlainText()` 返回的存储值保留 `@名称` 字面量。

关键渲染片段：

```tsx
<div
  ref={editorRef}
  data-testid="storyboard-mention-editor"
  role="textbox"
  aria-label={placeholder}
  contentEditable
  suppressContentEditableWarning
  className="min-h-24 w-full rounded-md border bg-muted/40 px-3 py-2 text-sm leading-6 outline-none transition focus:ring-2 focus:ring-primary/30"
  onInput={() => {
    if (!isComposingRef.current) syncValueFromEditor()
  }}
  onCompositionStart={() => {
    isComposingRef.current = true
  }}
  onCompositionEnd={() => {
    isComposingRef.current = false
    syncValueFromEditor()
  }}
  onKeyDown={handleKeyDown}
  onBlur={() => {
    window.setTimeout(() => setMentionStartIndex(null), 120)
    syncValueFromEditor()
    onBlur?.()
  }}
/>
```

- [ ] **Step 2: 在 `StepStoryboard` 中准备资源数据**

在 `step-storyboard.tsx` 中导入：

```ts
import { StoryboardMentionEditor, type StoryboardMentionResource } from './storyboard-mention-editor'
```

在组件内部构造：

```ts
const mentionResources: StoryboardMentionResource[] = [
  ...state.assets.characters.map(item => ({ id: item.id, kind: 'character' as const, name: item.name, imageUrl: item.imageUrl })),
  ...state.assets.backgrounds.map(item => ({ id: item.id, kind: 'background' as const, name: item.name, imageUrl: item.imageUrl })),
]
```

- [ ] **Step 3: 替换画面提示词 Textarea**

把原来的：

```tsx
<Textarea value={page.prompt} onChange={(event) => updatePage(page.page, { prompt: event.target.value })} className="min-h-28 resize-none text-sm" placeholder="画面提示词" />
```

替换为：

```tsx
<div className="space-y-2">
  <div className="text-sm font-medium">画面提示词</div>
  <StoryboardMentionEditor
    value={page.prompt}
    resources={mentionResources}
    placeholder="输入画面提示词，使用 @ 引用角色或背景"
    onChange={(value) => updatePage(page.page, { prompt: value })}
  />
</div>
```

- [ ] **Step 4: 构建前端验证类型**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: PASS。若失败信息只来自网络字体下载，先记录原始错误，再运行 `pnpm --filter @aigc/web exec tsc --noEmit` 确认 TypeScript。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/picture-book/storyboard-mention-editor.tsx apps/web/src/components/picture-book/step-storyboard.tsx
git commit -m "feat: add storyboard mention editor"
```

---

### Task 4: 新建双语迷你音频播放器

**Files:**
- Create: `apps/web/src/components/picture-book/storyboard-audio-player.tsx`
- Modify: `apps/web/src/components/picture-book/step-storyboard.tsx`

- [ ] **Step 1: 创建播放器组件**

创建 `apps/web/src/components/picture-book/storyboard-audio-player.tsx`。组件接口：

```ts
interface StoryboardAudioPlayerProps {
  label: string
  src?: string | null
  loading?: boolean
}
```

实现状态：

```ts
const audioRef = useRef<HTMLAudioElement | null>(null)
const [playing, setPlaying] = useState(false)
const [duration, setDuration] = useState(0)
const [currentTime, setCurrentTime] = useState(0)
```

时间格式 helper：

```ts
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}
```

核心 JSX：

```tsx
<div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs">
  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 rounded-full" disabled={!src || loading} onClick={toggle}>
    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
  </Button>
  <span className="w-8 shrink-0 rounded border bg-background px-1 text-center font-medium text-muted-foreground">{label}</span>
  <input
    type="range"
    min={0}
    max={duration || 0}
    step={0.1}
    value={currentTime}
    disabled={!src}
    className="h-1 min-w-0 flex-1 accent-primary"
    onChange={(event) => seek(Number(event.target.value))}
  />
  <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground">{formatTime(duration)}</span>
  {src ? <audio ref={audioRef} src={src} preload="metadata" /> : null}
</div>
```

- [ ] **Step 2: 接入 `StepStoryboard`**

导入：

```ts
import { StoryboardAudioPlayer } from './storyboard-audio-player'
```

在图片左侧底部渲染：

```tsx
<div className="space-y-2 border-t bg-background p-3">
  <StoryboardAudioPlayer label="中" src={page.voice.zh} loading={audioGenerating && !page.voice.zh} />
  <StoryboardAudioPlayer label="EN" src={page.voice.en} loading={audioGenerating && !page.voice.en} />
</div>
```

- [ ] **Step 3: 构建前端验证类型**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: PASS。若 Next.js 构建因环境变量缺失失败，记录具体缺失项并运行：

```bash
pnpm --filter @aigc/web exec tsc --noEmit
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/picture-book/storyboard-audio-player.tsx apps/web/src/components/picture-book/step-storyboard.tsx
git commit -m "feat: add storyboard audio player"
```

---

### Task 5: 重写分镜卡片为横向单列布局并支持旁白编辑

**Files:**
- Modify: `apps/web/src/components/picture-book/step-storyboard.tsx`

- [ ] **Step 1: 保留并扩展状态计算**

保留 `previewUrl`、`aspectClass`、`imagesDone`、`audioDone`、`updatePage()`。新增旁白更新 helper：

```ts
const updateNarration = (pageNumber: number, language: 'zh' | 'en', value: string) => {
  onChange({
    ...state,
    storyboard: state.storyboard.map((page) => page.page === pageNumber
      ? {
          ...page,
          script: {
            ...page.script,
            narration: {
              ...page.script.narration,
              [language]: value,
            },
          },
        }
      : page),
  })
}
```

- [ ] **Step 2: 改为单列卡片容器**

把卡片列表容器：

```tsx
<div className="grid gap-4 lg:grid-cols-3">
```

替换为：

```tsx
<div className="space-y-4">
```

每张卡片根节点使用：

```tsx
<article key={page.page} className="overflow-hidden rounded-lg border bg-card">
  <div className="grid gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
    <div className="bg-muted/30" />
    <div className="space-y-4 p-4" />
  </div>
</article>
```

- [ ] **Step 3: 左侧图片区固定宽度并移动操作按钮**

左侧列结构：

```tsx
<div className="bg-muted/30">
  <div className={`relative bg-muted ${aspectClass}`}>
    <div className="absolute left-2 top-2 z-10 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
      {String(page.page).padStart(2, '0')}
    </div>
    <div className="absolute bottom-2 right-2 z-10 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
      {imageGenerating ? '生成中' : page.imageUrl ? '已生成' : '未生成'}
    </div>
    {page.imageUrl ? (
      <img
        src={page.imageUrl}
        alt={`Page ${page.page}`}
        className="h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
        onClick={() => setPreviewUrl(page.imageUrl ?? null)}
      />
    ) : imageGenerating ? (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-primary">
        <Loader2 className="h-5 w-5 animate-spin" />
        生成中
      </div>
    ) : (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Page {page.page}</div>
    )}
    {page.imageUrl && imageGenerating ? (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-xs text-primary backdrop-blur-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        重新生成中
      </div>
    ) : null}
  </div>
  <div className="space-y-2 border-t bg-card p-3">
    <StoryboardAudioPlayer label="中" src={page.voice.zh} loading={audioGenerating && !page.voice.zh} />
    <StoryboardAudioPlayer label="EN" src={page.voice.en} loading={audioGenerating && !page.voice.en} />
  </div>
  <div className="grid grid-cols-2 gap-2 border-t bg-card p-3">
    <Button type="button" variant="outline" size="sm" onClick={() => onGenerateOneImage(refId)} disabled={loading || imageGenerating || !page.prompt.trim()}>
      {imageGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
      {page.imageUrl ? '重新生成图' : '生成图片'}
    </Button>
    <Button type="button" variant="outline" size="sm" onClick={() => onGenerateOneAudio(refId)} disabled={loading || audioGenerating}>
      {audioGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
      {page.voice.zh || page.voice.en ? '重新生成音' : '生成语音'}
    </Button>
  </div>
</div>
```

- [ ] **Step 4: 右侧编辑区加入旁白 Textarea**

右侧列结构：

```tsx
<div className="space-y-4 p-4">
  <div className="flex items-center justify-between gap-3">
    <div className="text-sm font-semibold text-primary">Page {String(page.page).padStart(2, '0')}</div>
    <div className="text-xs text-muted-foreground">
      {imageGenerating ? '图片生成中' : page.imageUrl ? '图片已生成' : '图片未生成'} · {audioGenerating ? '语音生成中' : page.voice.zh && page.voice.en ? '语音已生成' : '语音未完成'}
    </div>
  </div>

  <div className="space-y-2">
    <div className="text-sm font-medium">画面提示词</div>
    <StoryboardMentionEditor
      value={page.prompt}
      resources={mentionResources}
      placeholder="输入画面提示词，使用 @ 引用角色或背景"
      onChange={(value) => updatePage(page.page, { prompt: value })}
    />
  </div>

  <div className="grid gap-3 xl:grid-cols-2">
    <div className="space-y-2">
      <div className="text-sm font-medium">中文旁白</div>
      <Textarea
        value={page.script.narration.zh}
        onChange={(event) => updateNarration(page.page, 'zh', event.target.value)}
        className="min-h-28 resize-none text-sm"
        placeholder="中文旁白"
      />
    </div>
    <div className="space-y-2">
      <div className="text-sm font-medium">English Narration</div>
      <Textarea
        value={page.script.narration.en}
        onChange={(event) => updateNarration(page.page, 'en', event.target.value)}
        className="min-h-28 resize-none text-sm"
        placeholder="English narration"
      />
    </div>
  </div>
</div>
```

- [ ] **Step 5: 验证移动端堆叠**

Run:

```bash
pnpm --filter @aigc/web dev
```

Open: `http://localhost:6006/toby-studio/picture-book/<existing-project-id>`

Manual expected:

- Desktop: 卡片左图右文，左侧宽度约 280px。
- Mobile width 390px: 图片、播放器、按钮、编辑区上下堆叠，文字不溢出按钮。
- 图片点击打开全屏预览，点击遮罩或关闭按钮能关闭。

- [ ] **Step 6: 构建前端验证**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/picture-book/step-storyboard.tsx
git commit -m "feat: redesign storyboard cards"
```

---

### Task 6: 收紧重新生成进度与下一步门控

**Files:**
- Modify: `apps/web/src/app/(dashboard)/toby-studio/picture-book/[id]/page.tsx`
- Modify: `apps/web/src/components/picture-book/step-storyboard.tsx`

- [ ] **Step 1: 单页重新生成前本地标记 pending**

在 `generateOneStoryboardImage()` 中，`setGeneratingStoryboardImageIds()` 后追加本地状态更新：

```ts
const nextState = {
  ...state,
  storyboard: state.storyboard.map(page => `page_${page.page}` === refId
    ? { ...page, status: 'pending' as const, imageUrl: null }
    : page),
}
project.updateState(nextState)
```

在 `generateOneStoryboardAudio()` 中追加：

```ts
const nextState = {
  ...state,
  storyboard: state.storyboard.map(page => `page_${page.page}` === refId
    ? { ...page, voice: { zh: null, en: null } }
    : page),
}
project.updateState(nextState)
```

- [ ] **Step 2: 批量重新生成只标记实际提交的目标**

当前批量按钮只提交缺失项。保留这个行为；如果产品希望“批量生成”也重生成已有结果，需要先补充确认需求。本计划不改变批量按钮语义。

确认 `StepStoryboard` 的 `imagesDone` 和 `audioDone` 仍使用：

```ts
const imagesDone = state.storyboard.filter(p =>
  p.imageUrl && !generatingImageIds.includes(`page_${p.page}`) && p.status !== 'pending' && p.status !== 'processing',
).length
const audioDone = state.storyboard.filter(p =>
  p.voice.zh && p.voice.en && !generatingAudioIds.includes(`page_${p.page}`),
).length
```

- [ ] **Step 3: 下一步门控覆盖本地生成中状态**

确认 `storyboardReady` 为：

```ts
const storyboardReady = state ? state.storyboard.length > 0
  && state.storyboard.every(p => p.imageUrl && p.voice.zh && p.voice.en)
  && generatingStoryboardImageIds.length === 0
  && generatingStoryboardAudioIds.length === 0
  : false
```

如果 Step 1 已清空正在重生成页的 `imageUrl` / `voice`，该门控会立即禁用下一步。

- [ ] **Step 4: 手动验证**

Run:

```bash
pnpm --filter @aigc/web dev
```

Manual expected:

- 对已完成页面点击「重新生成图」后，图片进度立刻从 `N/N` 变为 `(N-1)/N`。
- 对已完成页面点击「重新生成音」后，语音进度立刻从 `N/N` 变为 `(N-1)/N`。
- 重新生成期间「下一步」禁用。
- 同步完成后进度恢复，所有页面图片和中英语音都完成时「下一步」可点击。

- [ ] **Step 5: 提交**

```bash
git add "apps/web/src/app/(dashboard)/toby-studio/picture-book/[id]/page.tsx" apps/web/src/components/picture-book/step-storyboard.tsx
git commit -m "fix: gate storyboard regeneration progress"
```

---

### Task 7: 全量验证与收尾

**Files:**
- No code changes expected unless verification exposes defects.

- [ ] **Step 1: 后端测试**

Run:

```bash
pnpm --filter @aigc/api exec tsx --test src/__tests__/picture-book-generation.test.ts src/__tests__/picture-book-media.test.ts
```

Expected: PASS。

- [ ] **Step 2: 前端构建**

Run:

```bash
pnpm --filter @aigc/web build
```

Expected: PASS。

- [ ] **Step 3: 全量 lint**

Run:

```bash
pnpm lint
```

Expected: PASS。

- [ ] **Step 4: 浏览器验收**

Run:

```bash
pnpm --filter @aigc/web dev
```

Open:

```text
http://localhost:6006/toby-studio/picture-book/<existing-project-id>
```

Acceptance checklist:

- 分镜卡片为横向布局，左图右文；移动端自动上下堆叠。
- 图片比例跟随 `state.settings.aspectRatio`，图片点击可放大。
- 画面提示词输入 `@` 弹出角色/背景选择器。
- 选中角色/背景后显示 pill，保存值保留 `@名称`。
- 中英文旁白 Textarea 可编辑，页面草稿状态变为未保存并被现有自动保存机制保存。
- 中英文音频播放器能播放、暂停、拖动进度。
- 单页重新生成图片/语音时进度和下一步门控正确变化。
- 新生成分镜提示词包含 `@角色名` / `@背景名`。
- 生成分镜图片接口提交时，匹配到的引用图进入 `params.image`。

- [ ] **Step 5: 提交验证修复**

如果 Step 1-4 暴露缺陷，先修复，再提交：

```bash
git add apps/api/src apps/web/src
git commit -m "fix: polish storyboard redesign"
```

如果没有额外修复，不创建空提交。

---

## 风险与注意事项

- `params.image` 会触发图片生成接口的参考图数量校验；当前生成接口支持数组，且会按模型配置限制参考图数量。
- `request.body.params` 当前放在 `params` 最后，调用方可以覆盖 `image`。这是保守兼容现有 API 的选择；如果产品要求 storyboard @ 引用不可被覆盖，需要单独调整为引用图优先。
- contentEditable 的中文输入法组合输入必须使用 `compositionstart/compositionend` 保护，否则输入 @ 和中文时容易丢字。
- 本版本不改 `packages/types`，旁白仍写入现有 `page.script.narration.zh/en`，@ 引用仍写入现有 `page.prompt`。
- 不实现语气词/停顿，不新增音频脚本结构。

---

## Spec Coverage Review

- 横向卡片、左图右文：Task 5。
- 图片比例和 lightbox：Task 5 保留现有比例类和预览逻辑。
- @ 引用编辑器：Task 3。
- AI 自动 @ 标记：Task 1。
- 生成图片解析 @ 并传参考图：Task 2。
- 中英文旁白编辑：Task 5。
- 双语音频播放器：Task 4。
- 重新生成参与进度计算：Task 6。
- 下一步按钮门控：Task 6。
- 不改 `packages/types`、不做语气词/停顿：风险与注意事项明确约束。
