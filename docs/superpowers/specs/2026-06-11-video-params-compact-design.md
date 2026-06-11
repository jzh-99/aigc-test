# 创作页签视频配置改版设计

## 背景

创作页签（generation）的视频参数面板当前将所有配置项（模型、分辨率、比例、时长、音频、镜头）平铺在一个卡片中，纵向空间占用大，视觉层次不够简洁。

画布视频节点面板（canvas/video-gen-panel）已实现了紧凑的 Popover 配置模式，整体只需底部工具栏一行空间。

## 目标

参照画布视频节点面板的排版，将创作页签视频配置收缩为 Popover，实现简约的视觉效果。

## 设计

### 布局结构（从上到下）

```
┌─────────────────────────────────────┐
│ ① 模型选择器（占满宽度）              │
│    [图片] 名称 + 描述    设为默认  ▾  │
├─────────────────────────────────────┤
│ ② 模式切换 — 多模态 | 关键帧        │
├─────────────────────────────────────┤
│ ③ 参考素材区（关键帧 / 多模态上传）   │
├─────────────────────────────────────┤
│ ④ 提示词输入（纵向空间增加）          │
├─────────────────────────────────────┤
│ ⑤ 底部工具栏                        │
│  [⚙️ 720P·16:9·5s·有声 ▾]  🪙75  [✨生成] │
└─────────────────────────────────────┘
```

### ① 模型选择器（占满宽度 + 模型图片）

- 独立一行，占满宽度，带圆角边框
- 左侧：模型图片（48×48 圆角），右侧：模型名称 + 描述
- 右上角：「设为默认」按钮
- 点击整体弹出 Popover 列表选择模型
- 模型图片通过前端静态映射获取（`/lib/model-images.ts`）

### ② 模式切换 — 不变

保持现有 `availableVideoModes` 按钮组

### ③ 参考素材区 — 不变

保持现有 `VideoFramesZone` / `VideoMultimodalZone`

### ④ 提示词输入 — 空间增加

由于配置不再占纵向空间，textarea 可获得更多高度

### ⑤ 底部工具栏（一行）

- 左侧：ConfigPopover 摘要按钮（如 `720P · 16:9 · 5s · 有声 · 自由镜头`）
  - 点击弹出配置面板，内含：
    - 分辨率：pill 按钮组（`ConfigOptionGroup`）
    - 画面比例：pill 按钮组
    - 时长：滑块（`DurationSlider`，仅 Seedance）
    - 音频：pill 按钮组（仅 Seedance）
    - 镜头：pill 按钮组（仅 Seedance multimodal）
- 右侧：积分显示 + 生成按钮

## 模型图片方案

新建 `apps/web/src/lib/model-images.ts`，前端静态映射：

```ts
const MODEL_IMAGES: Record<string, string> = {
  'seedance-2.0':      '/models/seedance-2.0.png',
  'seedance-2.0-fast': '/models/seedance-2.0-fast.png',
}

export function getModelImage(code: string): string | undefined {
  return MODEL_IMAGES[code]
}
```

无映射时回退为默认图标（lucide `Film`）。

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `apps/web/src/components/generation/video/video-params.tsx` | **重写** | 平铺卡片 → 模型行 + ConfigPopover 工具栏 |
| `apps/web/src/components/generation/video/video-panel.tsx` | **调整** | 模型选择器上提至顶层，其余布局微调 |
| `apps/web/src/components/canvas/panels/video-gen-panel.tsx` | **提取** | 将 `ConfigOptionGroup`、`DurationSlider` 提取到共享位置 |
| `apps/web/src/components/generation/shared/video-config-popover.tsx` | **新建** | 共享的视频配置 Popover 组件 |
| `apps/web/src/lib/model-images.ts` | **新建** | 模型 code → 图片 URL 的静态映射 |
| `apps/web/public/models/*.png` | **新建** | 模型图片资源文件 |

## 复用策略

从 `canvas/panels/video-gen-panel.tsx` 提取以下组件到共享位置：

1. **`ConfigOptionGroup`** — pill 形选项组（图标 + 标签 + 选项按钮 + ✓标记）
2. **`DurationSlider`** — 时长滑块（标签 + range input + 数值显示）
3. **`VideoConfigPopover`** — 配置弹窗（触发按钮显示摘要 + 弹出面板）

提取到 `apps/web/src/components/generation/shared/video-config-popover.tsx`，创作页签和画布面板共同引用。

## 不变的部分

- 视频模式切换逻辑
- 参考素材上传（关键帧 / 多模态）
- 提示词输入
- 生成逻辑（积分计算、API 调用、上传）
- "设为默认"功能逻辑
