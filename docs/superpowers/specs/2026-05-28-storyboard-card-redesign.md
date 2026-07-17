# 绘本分镜卡片重新设计

## 概述

重新设计绘本分镜步骤（StepStoryboard）的卡片布局和交互，从当前的纵向 3 列网格改为横向单列布局，新增 @ 引用功能、可编辑旁白、双语音频播放器。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 卡片布局 | 横向（左图右文） | 编辑空间充足，适合 @ 编辑器和旁白编辑 |
| @ 引用范围 | 仅画面提示词 | 旁白不需要引用图片资源 |
| AI 自动标记 | 是 | 15-20 页手动标记成本太高 |
| 语气词/停顿 | 暂不支持 | 后续版本再加 |
| 旁白编辑 | 普通 Textarea | 不需要 contentEditable 的复杂度 |

## 卡片结构

```
┌─────────────────────────────────────────────────────────────┐
│ ┌──────────────┐  ┌──────────────────────────────────────┐  │
│ │              │  │ 画面提示词（@ 引用编辑器）             │  │
│ │   图片区     │  │ contentEditable + pill 标记           │  │
│ │  (按比例)    │  │ 输入 @ 触发角色/背景选择器            │  │
│ │  点击放大    │  ├──────────────────────────────────────┤  │
│ ├──────────────┤  │ 中文旁白（Textarea，可编辑）          │  │
│ │ 🔊 中文 ▶━━━ │  ├──────────────────────────────────────┤  │
│ │ 🔊 EN   ▶━━━ │  │ English Narration（Textarea，可编辑） │  │
│ ├──────────────┤  └──────────────────────────────────────┘  │
│ │ [重新生成图] │                                            │
│ │ [重新生成音] │                                            │
│ └──────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

- 左侧宽度固定 280px（lg 断点以上），移动端堆叠
- 图片比例跟随 `state.settings.aspectRatio`（16:9 / 9:16 / 1:1）
- 图片点击弹出全屏预览（复用 step-assets 的 lightbox 模式）

## @ 引用功能

### 编辑器

复用画布的 `ResourceMentionTextarea` 模式（contentEditable + pill token），但数据源不同：

- **数据源**：`state.assets.characters` + `state.assets.backgrounds`（已有图片的元素）
- **触发**：输入 `@` 后弹出下拉选择器，按"角色"/"背景"分组
- **pill 样式**：角色用紫色（`#312e81`），背景用蓝色（`#1e3a5f`）
- **存储格式**：纯文本中保留 `@角色名` 字面量（和画布一致）

### AI 自动标记

修改 `post-storyboard-prompts.ts` 的 system prompt，要求 AI 在 `imagePrompt` 中使用 `@角色名` / `@背景名` 引用资产库中的元素。prompt 中传入角色/背景列表供 AI 参考。

### 生成图片时解析

修改 `post-generate-storyboard-images.ts`：
1. 解析 `page.prompt` 中的 `@xxx` 标记
2. 匹配 `state.assets.characters` / `state.assets.backgrounds` 中的元素
3. 将匹配到的元素的 `imageUrl` 作为参考图传给图片生成 API（`params.image` 或 `referenceImages`）

## 旁白编辑

- 中英文各一个 `<Textarea>`，绑定 `page.script.narration.zh` / `page.script.narration.en`
- 可手动编辑，修改后触发 `onChange` → 自动保存草稿
- AI 生成时填充初始值，用户可随时修改

## 音频播放器

每个分镜卡片左侧底部，中英文各一行迷你播放器：
- 播放/暂停按钮（圆形）
- 进度条（细线条）
- 时长显示
- 语言标签（中/EN）
- 使用 `<audio>` 元素 + 自定义 UI 控制

## 进度与门控

- 进度条显示：`图片进度：X/N · 语音进度：X/N`
- 重新生成时：该页从"已完成"计数中移除
- 下一步按钮：`disabled` 直到所有页面的图片和语音（中+英）都生成完成且无正在生成的任务

## 涉及文件

### 前端

| 文件 | 改动 |
|------|------|
| `apps/web/src/components/picture-book/step-storyboard.tsx` | 完全重写：横向布局、@ 编辑器、旁白 Textarea、音频播放器 |
| `apps/web/src/components/picture-book/storyboard-mention-editor.tsx` | 新建：contentEditable @ 引用编辑器（参考 `resource-mention-textarea.tsx`） |
| `apps/web/src/components/picture-book/storyboard-audio-player.tsx` | 新建：迷你音频播放器组件 |
| `apps/web/src/app/(dashboard)/toby-studio/picture-book/[id]/page.tsx` | 更新 StepStoryboard props、进度判断 |

### 后端

| 文件 | 改动 |
|------|------|
| `apps/api/src/routes/picture-book/post-storyboard-prompts.ts` | 修改 system prompt，要求 AI 输出带 @标记 的 imagePrompt |
| `apps/api/src/routes/picture-book/post-generate-storyboard-images.ts` | 解析 prompt 中的 @标记，附带参考图调用图片生成 API |

### 不改动

- `packages/types` — `PictureBookStoryboardPage` 类型不变（prompt 字段已是 string，@ 标记作为文本存储）
- 语气词/停顿相关 — 本版本不涉及

## 验收标准

1. 分镜卡片为横向布局，左图右文
2. 图片比例跟随设置，点击可放大
3. 提示词编辑器输入 @ 弹出角色/背景选择器，选中后显示为 pill
4. AI 生成的提示词自动带有 @角色/@背景 标记
5. 生成图片时解析 @ 标记并附带参考图
6. 中英文旁白可手动编辑
7. 双语音频播放器可播放/暂停
8. 单个重新生成图片/语音正常工作，参与进度计算
9. 图片+语音全部完成后下一步按钮才可点击
