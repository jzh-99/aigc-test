# 创作助手样式重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 创作助手面板的视觉样式从通用浅色主题重构为灵感首页同源的暗色毛玻璃风格。

**Architecture:** 在 `globals.css` 中新增 3 个专用 CSS 类（`.ai-glass-panel`、`.ai-glass-header`、`.ai-glass-msg-bot`），然后在 `ai-assistant.tsx` 中替换对应的 className。不改变任何交互逻辑。

**Tech Stack:** Tailwind CSS 3 + 自定义 CSS 类

---

### Task 1: 新增 CSS 类到 globals.css

**Files:**
- Modify: `apps/web/src/app/globals.css`（在 `.creative-glass-icon` 规则块之后、`.creative-home-content-panel` 之前插入）

- [ ] **Step 1: 在 `globals.css` 的 `.creative-glass-icon` 闭合花括号之后（约第 1787 行），插入以下 CSS 块**

```css
/* ==========================================================================
   AI 创作助手面板 — 灵感首页同源暗色毛玻璃风格
   ========================================================================== */

.ai-glass-panel {
  background:
    linear-gradient(118deg, rgba(255, 255, 255, 0.08), rgba(181, 193, 255, 0.02) 38%, rgba(16, 26, 72, 0.07)),
    rgba(8, 11, 34, 0.88);
  border: 1px solid rgba(236, 233, 255, 0.18);
  backdrop-filter: blur(24px) saturate(1.3);
  -webkit-backdrop-filter: blur(24px) saturate(1.3);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 24px 80px rgba(0, 0, 0, 0.5);
}

.ai-glass-header {
  background: rgba(82, 70, 180, 0.22);
  border-bottom: 1px solid rgba(236, 233, 255, 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.ai-glass-msg-bot {
  background: rgba(20, 24, 60, 0.6);
  border: 1px solid rgba(236, 233, 255, 0.08);
  color: rgba(235, 238, 255, 0.92);
}
```

- [ ] **Step 2: 确认插入位置正确**

在 `globals.css` 中搜索 `ai-glass-panel`，应出现在 `creative-glass-icon` 之后、`creative-home-content-panel` 之前。

---

### Task 2: 重构面板外框 + 标题栏

**Files:**
- Modify: `apps/web/src/components/ai-assistant/ai-assistant.tsx`

- [ ] **Step 1: 替换面板外框 className（约第 626 行）**

将：
```tsx
className="fixed z-50 flex flex-col border border-border bg-background shadow-2xl overflow-hidden rounded-2xl"
```
改为：
```tsx
className="fixed z-50 flex flex-col overflow-hidden rounded-2xl ai-glass-panel"
```

- [ ] **Step 2: 替换标题栏 className（约第 637 行）**

将：
```tsx
className="flex items-center justify-between px-4 py-3 gradient-accent cursor-move shrink-0"
```
改为：
```tsx
className="flex items-center justify-between px-4 py-3 cursor-move shrink-0 ai-glass-header"
```

- [ ] **Step 3: 标题栏图标和文字保持白色不变，调整清空按钮颜色（约第 645 行）**

将：
```tsx
<button onClick={handleClear} className="text-red-400 hover:text-red-300 transition-colors" title="清空对话">
```
改为：
```tsx
<button onClick={handleClear} className="text-white/50 hover:text-white/80 transition-colors" title="清空对话">
```

- [ ] **Step 4: 调整缩放手柄 hover 颜色（约第 653、659 行）**

将两处：
```tsx
className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/50 transition-colors z-10"
```
和：
```tsx
className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/50 transition-colors z-10"
```
分别改为：
```tsx
className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-violet-300/30 transition-colors z-10"
```
和：
```tsx
className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-violet-300/30 transition-colors z-10"
```

- [ ] **Step 5: 提交面板外框 + 标题栏改动**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/ai-assistant/ai-assistant.tsx
git commit -m "style: 创作助手面板外框和标题栏对齐灵感首页暗色毛玻璃风格"
```

---

### Task 3: 重构消息区域样式

**Files:**
- Modify: `apps/web/src/components/ai-assistant/ai-assistant.tsx`

- [ ] **Step 1: 调整空状态样式（约第 666 行）**

将：
```tsx
<div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12 gap-2">
  <Bot className="h-10 w-10 opacity-20" />
  <p className="text-sm">你好！我是 Toby.AI 创作助手</p>
  <p className="text-xs opacity-60">可以帮你设计提示词、解析图片/视频</p>
</div>
```
改为：
```tsx
<div className="flex flex-col items-center justify-center h-full text-center py-12 gap-2">
  <Bot className="h-10 w-10 text-white/20" />
  <p className="text-sm text-white/60">你好！我是 Toby.AI 创作助手</p>
  <p className="text-xs text-white/40">可以帮你设计提示词、解析图片/视频</p>
</div>
```

- [ ] **Step 2: 替换消息气泡样式（约第 677-682 行）**

将消息内容 `div` 的 className 判断：
```tsx
'gradient-accent text-white rounded-br-sm'
```
和：
```tsx
'bg-muted text-foreground rounded-bl-sm'
```
改为：
```tsx
'gradient-accent text-white rounded-br-sm'
```
（用户消息不变）和：
```tsx
'ai-glass-msg-bot rounded-bl-sm'
```

即完整的 className 三元变为：
```tsx
className={cn(
  'max-w-full min-w-0 rounded-2xl px-3 py-2 text-sm leading-relaxed break-words overflow-hidden relative group',
  msg.role === 'user'
    ? 'gradient-accent text-white rounded-br-sm'
    : 'ai-glass-msg-bot rounded-bl-sm'
)}
```

- [ ] **Step 3: 调整 AI 消息内的 Markdown prose 样式（约第 691 行）**

将：
```tsx
<div className="prose prose-sm prose-invert max-w-full break-words overflow-hidden pb-4 [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_code]:break-all [&_table]:block [&_table]:overflow-x-auto [&_*]:max-w-full [&_p]:break-words [&_li]:break-words">
```
改为：
```tsx
<div className="prose prose-sm prose-invert max-w-full break-words overflow-hidden pb-4 [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_code]:break-all [&_table]:block [&_table]:overflow-x-auto [&_*]:max-w-full [&_p]:break-words [&_li]:break-words [&_a]:text-violet-300 [&_a:hover]:text-violet-200">
```
（新增链接的紫色调，与暗色主题一致）

- [ ] **Step 4: 调整复制按钮背景（约第 696 行）**

将：
```tsx
className="absolute bottom-2 right-2 p-1.5 rounded-md bg-background/80 hover:bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity"
```
改为：
```tsx
className="absolute bottom-2 right-2 p-1.5 rounded-md bg-[rgba(8,11,34,0.8)] hover:bg-[rgba(15,18,50,0.9)] border border-[rgba(236,233,255,0.12)] opacity-0 group-hover:opacity-100 transition-opacity"
```

- [ ] **Step 5: 提交消息区域改动**

```bash
git add apps/web/src/components/ai-assistant/ai-assistant.tsx
git commit -m "style: 创作助手消息区域对齐暗色毛玻璃风格"
```

---

### Task 4: 重构输入区域样式

**Files:**
- Modify: `apps/web/src/components/ai-assistant/ai-assistant.tsx`

- [ ] **Step 1: 调整输入区域外框（约第 716 行）**

将：
```tsx
<div className="border-t border-border bg-background">
```
改为：
```tsx
<div className="border-t border-[rgba(236,233,255,0.1)] bg-[rgba(8,11,34,0.6)]">
```

- [ ] **Step 2: 调整 Tab 栏分隔线（约第 718 行）**

将：
```tsx
<div className="flex border-b border-border">
```
改为：
```tsx
<div className="flex border-b border-[rgba(236,233,255,0.08)]">
```

- [ ] **Step 3: 调整 Tab 按钮样式（约第 725 行）**

将 active 态的 `border-b-2 border-primary text-primary` 改为紫色：
```tsx
tab === t.id
  ? 'border-b-2 border-violet-400 text-violet-300'
  : 'text-white/40 hover:text-white/70'
```

即完整的 Tab 按钮 className 变为：
```tsx
className={cn(
  'flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
  tab === t.id
    ? 'border-b-2 border-violet-400 text-violet-300'
    : 'text-white/40 hover:text-white/70'
)}
```

- [ ] **Step 4: 调整附件预览条样式（约第 741 行）**

将：
```tsx
<div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
```
改为：
```tsx
<div className="flex items-center gap-2 rounded-lg bg-[rgba(15,18,50,0.5)] px-3 py-1.5 text-xs text-white/50">
```

附件删除按钮：
```tsx
<button onClick={() => setChatImage(null)} className="hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
```
改为：
```tsx
<button onClick={() => setChatImage(null)} className="hover:text-white/80"><X className="h-3.5 w-3.5" /></button>
```

- [ ] **Step 5: 调整 Textarea 暗色适配（约第 761 行）**

给 Textarea 添加暗色背景的 className 覆盖。将：
```tsx
className="min-h-[60px] max-h-[120px] resize-none text-sm"
```
改为：
```tsx
className="min-h-[60px] max-h-[120px] resize-none text-sm bg-[rgba(15,18,50,0.5)] border-[rgba(236,233,255,0.1)] text-white/90 placeholder:text-white/30 focus-visible:ring-violet-400/30"
```

- [ ] **Step 6: 调整图片上传按钮样式（约第 771 行）**

将：
```tsx
className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors"
```
改为：
```tsx
className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(236,233,255,0.12)] hover:bg-[rgba(82,70,180,0.15)] transition-colors"
```

图标颜色：
```tsx
<ImageIcon className="h-4 w-4 text-muted-foreground" />
```
改为：
```tsx
<ImageIcon className="h-4 w-4 text-white/50" />
```

- [ ] **Step 7: 提交输入区域改动**

```bash
git add apps/web/src/components/ai-assistant/ai-assistant.tsx
git commit -m "style: 创作助手输入区域对齐暗色毛玻璃风格"
```

---

### Task 5: 重构图片解析 Tab 样式

**Files:**
- Modify: `apps/web/src/components/ai-assistant/ai-assistant.tsx`

- [ ] **Step 1: 调整上传区域样式（约第 794-795 行）**

将：
```tsx
className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-6 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
```
改为：
```tsx
className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[rgba(236,233,255,0.12)] py-6 text-white/40 hover:border-violet-400/40 hover:text-violet-300 transition-colors"
```

- [ ] **Step 2: 调整预览区域背景（约第 802 行）**

将：
```tsx
<div className="relative rounded-xl overflow-hidden bg-muted">
```
改为：
```tsx
<div className="relative rounded-xl overflow-hidden bg-[rgba(15,18,50,0.5)]">
```

- [ ] **Step 3: 调整关闭按钮（约第 805 行）**

将：
```tsx
className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
```
改为：
```tsx
className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/70 hover:bg-black/80 hover:text-white"
```

- [ ] **Step 4: 提交图片解析 Tab 改动**

```bash
git add apps/web/src/components/ai-assistant/ai-assistant.tsx
git commit -m "style: 创作助手图片解析 Tab 对齐暗色风格"
```

---

### Task 6: 最终验证

- [ ] **Step 1: 启动前端开发服务器**

```bash
pnpm --filter @aigc/web dev
```

- [ ] **Step 2: 人工验证清单**

| 检查项 | 预期 |
|--------|------|
| 面板整体背景 | 深蓝半透明 + 毛玻璃模糊效果 |
| 标题栏 | 半透明紫色底，非全紫渐变 |
| 用户消息气泡 | 保持 gradient-accent 紫色渐变 |
| AI 消息气泡 | 深蓝半透明底 + 浅色文字 |
| 输入框 | 暗色背景 + 半透明边框 |
| Tab 栏 | 紫色 active 态 |
| 空状态 | 半透明白色图标和文字 |
| 拖拽/缩放/贴边 | 功能不受影响 |
| 发送/复制/清空 | 功能不受影响 |
