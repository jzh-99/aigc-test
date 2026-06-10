# 创作助手样式重构设计

> 将 AI 创作助手面板的视觉样式对齐灵感首页的暗色毛玻璃风格。

## 背景

灵感首页使用深色蓝紫底色 + 毛玻璃（glass morphism）+ 紫/蓝半透明渐变的设计语言。当前创作助手面板使用通用 `bg-background` 浅色风格，两者视觉割裂。

## 范围

**仅视觉样式**：修改颜色、背景、边框、渐变、毛玻璃效果。**不改变**浮动面板的拖拽、缩放、贴边等交互行为。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `apps/web/src/components/ai-assistant/ai-assistant.tsx` | JSX className 调整 |
| `apps/web/src/app/globals.css` | 新增 `.ai-glass-panel` 等 3-4 个 CSS 类 |

## 设计细节

### 1. 面板外框

**现状**：`bg-background border border-border shadow-2xl rounded-2xl`
**改为**：

```css
.ai-glass-panel {
  background:
    linear-gradient(118deg, rgba(255,255,255,0.08), rgba(181,193,255,0.02) 38%, rgba(16,26,72,0.07)),
    rgba(8, 11, 34, 0.88);
  border: 1px solid rgba(236, 233, 255, 0.18);
  backdrop-filter: blur(24px);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    0 24px 80px rgba(0,0,0,0.5);
}
```

- 保持 `rounded-2xl` 圆角
- 无 hover 上浮/缩放效果（面板不需要卡片动效）

### 2. 标题栏

**现状**：`gradient-accent`（全紫渐变）
**改为**：

```css
.ai-glass-header {
  background: rgba(82, 70, 180, 0.2);
  border-bottom: 1px solid rgba(236, 233, 255, 0.1);
}
```

- 文字保持白色，清空按钮改为 `text-white/50 hover:text-white/80`
- 保持 `cursor-move` 拖拽行为

### 3. 消息气泡

- **用户消息**：保持 `gradient-accent`（品牌色不变）
- **AI 回复**：

```css
.ai-glass-msg-assistant {
  background: rgba(20, 24, 60, 0.6);
  border: 1px solid rgba(236, 233, 255, 0.08);
  color: rgba(235, 238, 255, 0.9);
}
```

- 复制按钮底色调整：`bg-[rgba(8,11,34,0.8)]` + 半透明边框

### 4. 输入区域

- 底色：`rgba(8, 11, 34, 0.6)`
- 分隔线：`rgba(236, 233, 255, 0.1)` 替代 `border-border`
- Tab 栏 active 色调为紫色调
- Textarea 背景：`rgba(15, 18, 50, 0.5)` + 半透明边框
- 发送按钮：保持 `gradient-accent`
- 附件预览：半透明深色底

### 5. 空状态

- 图标和文字使用半透明白色 `text-white/30`、`text-white/60`
- 背景透明，融入面板

### 6. 浮动按钮 & 提示气泡

**保持不变**：当前已使用 `gradient-accent`，与首页风格一致。

### 7. 缩放手柄

- hover 色调为紫/蓝半透明：`hover:bg-violet-300/30`

## 不做的事

- 不改变面板布局（浮动/拖拽/缩放/贴边）
- 不新增功能
- 不修改 API 或数据流
- 不调整浮动按钮样式

## 验证标准

1. 创作助手面板打开后，视觉风格与灵感首页（深色毛玻璃）统一
2. 消息发送/接收功能正常
3. 拖拽、缩放、贴边行为无变化
4. 复制、清空、附件上传功能正常
