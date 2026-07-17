# 创作页面 @ 提及功能 — 通用 MentionEditor 组件设计

> 日期：2026-06-11
> 状态：已确认，待实施

## 背景

创作页面（图片、视频、数字人等页签）当前使用普通 `<Textarea>` 输入 prompt，无法引用已上传的参考资源。画布模块和短剧/绘本模块已有成熟的 @ 提及功能，但各自独立实现，核心逻辑高度重复。

本设计将 @ 功能抽象为通用 `MentionEditor` 组件，优先服务于创作页面，后续逐步替换画布和短剧/绘本的现有实现。

## 需求范围

| 面板 | @ 功能 | 原因 |
|------|--------|------|
| **ImagePanel** | ✅ 需要 | 多张参考图，需要区分引用 |
| **VideoPanel** | ✅ 需要 | 参考图/视频/音频，类型多需区分 |
| AvatarPanel | ❌ 不需要 | 仅一张图片 + 一个音频 |
| ActionImitationPanel | ❌ 不需要 | 无 prompt 输入框 |

**提交行为：** 与画布一致，prompt 中的 `@图片1` 替换为 `<图片1>` 后发送给后端。

## 现有实现分析

项目中存在两套独立的 @ 提及编辑器：

### 1. 画布 — `ResourceMentionTextarea`

- 文件：`apps/web/src/components/canvas/panels/resource-mention-textarea.tsx`
- 类型：`CanvasReferenceMentionResource`（image / video / audio）
- 颜色：蓝色(图片)、紫色(视频)、绿色(音频)
- 选择器：扁平列表，无分组

### 2. 短剧/绘本 — `StoryboardMentionEditor`

- 文件：`apps/web/src/components/picture-book/storyboard-mention-editor.tsx`
- 类型：`StoryboardMentionResource`（character / background / requisite）
- 颜色：蓝色(角色)、绿色(背景)、琥珀色(道具)
- 选择器：分组列表（角色/背景/道具），支持别名匹配
- 被短剧 `segment-prompt-editor.tsx` 和绘本 `step-storyboard.tsx` 共用

### 核心逻辑对比

两者共享的核心逻辑（代码几乎逐行一致）：

- contentEditable div + @ 触发检测
- Token 解析与渲染（`parseSegments`）
- 光标管理（`getCaretOffset`、`placeCaretAtEnd`）
- 弹窗定位（`getCaretPixelPosition`）
- 退格删除整个 token
- IME 输入法组合处理

差异仅在：资源类型定义、Token 颜色/图标、选择器布局（扁平/分组）、别名匹配。

## 设计方案

### 文件结构

```
components/shared/mention-editor/
  ├── index.ts              # 统一导出
  ├── types.ts              # MentionResource 类型定义
  ├── mention-editor.tsx    # 通用 MentionEditor 组件
  └── mention-utils.ts      # 纯函数（parseSegments、getCaretOffset、resolveMentionPrompt 等）
```

### 通用资源类型

```typescript
// types.ts

/** 通用 @ 提及资源 */
export interface MentionResource {
  id: string
  /** @标签显示文本，如 "图片1"、"角色A" */
  mentionLabel: string
  /** 选择器中的描述文字，如 "参考图"、"已生成图片" */
  sourceLabel?: string
  /** 资源种类，用于颜色/图标区分，如 "image"、"character" */
  kind: string
  /** 别名列表（可选），支持多个名称触发同一个 @ */
  aliases?: string[]
}
```

现有类型的映射：

| 现有类型 | 映射方式 |
|----------|----------|
| `CanvasReferenceMentionResource` | `kind` = type（image/video/audio），`mentionLabel` 已有 |
| `StoryboardMentionResource` | `kind` = kind（character/background/requisite），`mentionLabel` = name，`aliases` 已有 |
| 创作页面资源 | `kind` = 资源类型（image/video/audio），`mentionLabel` 自动编号 |

### 组件 Props

```typescript
// mention-editor.tsx

interface MentionEditorProps {
  /** 当前文本值（受控） */
  value: string
  onChange: (value: string) => void
  /** 可 @ 的资源列表 */
  resources: MentionResource[]
  /** 占位文字 */
  placeholder?: string
  /** 最大字符数，默认 500 */
  maxLength?: number
  /** 失焦回调 */
  onBlur?: () => void
  /** 是否禁用 */
  disabled?: boolean
  /** 编辑器容器 className */
  className?: string
  /** 自定义提及标签样式，按 kind 返回 className */
  mentionClassName?: (kind: string) => string
  /** 自定义提及标签图标，按 kind 返回 LucideIcon 组件 */
  mentionIcon?: (kind: string) => React.ComponentType<{ className?: string }>
  /** 选择器分组定义，不传则扁平列表 */
  groups?: { label: string; kinds: string[] }[]
  /** 选择器空状态文案 */
  emptyText?: string
}
```

命名说明：使用 `mention*` 前缀（而非 `token*`），避免与项目中后端日志脱敏的 `SECRET_KEY_PATTERN` 中 `token` 关键字混淆，语义也更准确。

### 选择器渲染策略

**扁平列表（画布、创作页）：**

```typescript
<MentionEditor
  resources={mentionResources}
  mentionClassName={(kind) =>
    kind === 'video' ? 'text-violet-600 bg-violet-50 border-violet-200'
      : kind === 'audio' ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
      : 'text-blue-600 bg-blue-50 border-blue-200'
  }
  mentionIcon={(kind) => kind === 'video' ? Film : kind === 'audio' ? Music : ImageIcon}
  emptyText="暂无可引用资源"
/>
```

**分组列表（短剧/绘本）：**

```typescript
<MentionEditor
  resources={mentionResources}
  groups={[
    { label: '角色', kinds: ['character'] },
    { label: '背景', kinds: ['background'] },
    { label: '道具', kinds: ['requisite'] },
  ]}
  mentionClassName={(kind) =>
    kind === 'character' ? 'border-primary/35 bg-primary/10 text-primary'
      : kind === 'requisite' ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
      : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
  }
  mentionIcon={(kind) => kind === 'character' ? ImageIcon : kind === 'requisite' ? PackageIcon : MapIcon}
  maxLength={1200}
  emptyText="暂无可引用角色、背景或道具"
/>
```

### 提交时的 @ → `<>` 替换

在 `mention-utils.ts` 中新增：

```typescript
/** 将 prompt 中的 @标签 替换为 <标签>，与画布行为一致 */
export function resolveMentionPrompt(
  prompt: string,
  resources: MentionResource[],
): string {
  if (resources.length === 0 || !prompt) return prompt
  const labels = resources
    .flatMap(r => [r.mentionLabel, ...(r.aliases ?? [])])
    .sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `@(${labels.map(escapeRegExp).join('|')})(?=\\s|$|[，。,.])`, 'g'
  )
  return prompt.replace(pattern, (_, label: string) => `<${label}>`)
}
```

替换在提交前一刻执行，hooks 层通过可选参数接受覆盖 prompt：

```typescript
// use-generate.ts
const generate = useCallback(async (overridePrompt?: string): Promise<BatchResponse | null> => {
  const finalPrompt = (overridePrompt ?? prompt).trim()
  // ... 后续用 finalPrompt 替代 prompt.trim()
}, [prompt, ...])
```

### 工具函数提取

从两个现有组件中提取到 `mention-utils.ts` 的纯函数：

| 函数 | 说明 |
|------|------|
| `escapeRegExp` | 正则特殊字符转义 |
| `parseSegments` | 将含 @ 标签的文本解析为 text/mention 段落数组 |
| `limitPromptLength` | 按字符截断 prompt |
| `getEditorPlainText` | 从 contentEditable DOM 提取纯文本 |
| `renderEditorContent` | 将解析后的段落渲染为 DOM 节点 |
| `placeCaretAtEnd` | 将光标定位到编辑器末尾 |
| `getCaretOffset` | 获取光标在文本中的字符偏移量 |
| `getCaretPixelPosition` | 获取光标的像素坐标（用于弹窗定位） |
| `resolveMentionPrompt` | 将 @标签 替换为 <标签> |

## 创作页面集成细节

### ImagePanel 资源映射

```
referenceImages[] → MentionResource[]
  kind: 'image'
  mentionLabel: '图片1', '图片2', ...
  sourceLabel: 文件名 或 '参考图'
```

替换方式：

```tsx
// 之前
<Textarea
  placeholder="描述你想要生成的图片..."
  value={prompt}
  onChange={(e) => setPrompt(e.target.value)}
  className="h-full resize-none"
/>

// 之后
<MentionEditor
  value={prompt}
  onChange={setPrompt}
  resources={mentionResources}
  placeholder="描述你想要生成的图片..."
  maxLength={500}
  className="h-full"
  mentionClassName={(kind) => 'text-blue-600 bg-blue-50 border-blue-200'}
  mentionIcon={() => ImageIcon}
  emptyText="暂无可引用资源，请先上传参考图"
/>
```

提交时：

```typescript
const resolvedPrompt = resolveMentionPrompt(prompt, mentionResources)
const batch = await generate(resolvedPrompt)
```

### VideoPanel 资源映射

```
multimodalImages[] + multimodalVideos[] + multimodalAudios[] → MentionResource[]
  kind: 'image' | 'video' | 'audio'
  mentionLabel: '图片1', '视频1', '音频1', ...
  sourceLabel: 文件名
```

提交时：

```typescript
const resolvedPrompt = resolveMentionPrompt(videoPrompt, mentionResources)
// prompt: resolvedPrompt.trim() 传入 generateVideo
```

## 现有模块迁移策略

### 优先级

| 优先级 | 内容 | 说明 |
|--------|------|------|
| **P0（本次）** | 新建通用 `MentionEditor` + 创作页面集成 | 本需求的核心交付 |
| P1（后续） | 画布 `ResourceMentionTextarea` 迁移到通用组件 | 确认创作页稳定后执行 |
| P2（后续） | 短剧/绘本 `StoryboardMentionEditor` 迁移到通用组件 | 确认画布迁移稳定后执行 |

### 画布迁移要点

- `resource-mentions.ts` 保留画布专属逻辑（`removeResourceReferenceFromPrompt`、`buildPromptWithResourceMentions`）
- `CanvasReferenceMentionResource` 改为 `MentionResource` 的类型别名
- 画布各面板传入画布特有的 `mentionClassName` / `mentionIcon`
- 迁移完成后删除 `resource-mention-textarea.tsx`

### 短剧/绘本迁移要点

- 删除 `storyboard-mention-editor.tsx`
- 短剧 `segment-prompt-editor.tsx` 和绘本 `step-storyboard.tsx` 改为导入 `shared/mention-editor`
- 利用 `groups` prop 实现角色/背景/道具分组选择器
- 资源的 `aliases` 字段由通用组件的匹配逻辑直接支持

## 注意事项

1. **contentEditable 的坑：** IME 输入法组合期间不触发 `onInput` 回调，需通过 `compositionStart` / `compositionEnd` 标记来跳过
2. **退格删除 token：** 整个 @ 标签作为不可编辑的 span，Backspace/Delete 键命中时整体移除
3. **光标定位：** 折叠光标的 `getBoundingClientRect()` 可能返回零值矩形，需要兜底处理
4. **prompt 长度限制：** ImagePanel 默认 500 字符，VideoPanel 也用 500，短剧/绘本用 1200
5. **@ 触发条件：** 光标前一个字符是非 `@` 的任意字符 + `@`，避免连续 `@@` 误触发
