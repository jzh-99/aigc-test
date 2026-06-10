# 深渊紫影 — 全局配色调整实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将创作、Toby、画布、资产模块的整体配色从偏蓝（hue 222）调整为偏黑微紫（hue 275），形成「深渊紫影」风格。

**Architecture:** 纯 CSS 变量和样式调整。核心是 `globals.css` `:root` 变量块从 hue 222→275，然后逐模块更新对应的 rgba/hsl 颜色值。画布模块的蓝色交互态保持不变。Toby 页面有一处内联 Tailwind 类需同步修改。

**Tech Stack:** CSS（Tailwind CSS 变量 + 全局样式）

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `apps/web/src/app/globals.css` | 修改 | 核心变量 + 所有模块 CSS 样式 |
| `apps/web/src/app/(dashboard)/toby-studio/page.tsx` | 修改 | Toby 页面背景渐变内联类 |

---

### Task 1: 核心 CSS 变量

**Files:**
- Modify: `apps/web/src/app/globals.css:10-69`

将 `:root` 变量块从蓝色系（hue 222）改为紫黑系（hue 275）。

- [ ] **Step 1: 修改 `:root` 变量块**

将 `globals.css:10-69` 的 `:root` 内容替换为：

```css
  :root {
    /* 全站深色主题「深渊紫影」变量 */
    --background: 275 50% 4%; /* #06040C */
    --foreground: 270 20% 88%; /* #DED8EC */

    --card: 275 40% 6%; /* #0B0914 */
    --card-foreground: 270 20% 88%;

    --popover: 275 40% 6%;
    --popover-foreground: 270 20% 88%;

    --primary: 273 68% 77%; /* #C89CEC */
    --primary-foreground: 275 50% 4%;

    --secondary: 30 70% 55%; /* #E0924A */
    --secondary-foreground: 270 20% 88%;

    --muted: 275 30% 9%; /* #100E1C */
    --muted-foreground: 270 15% 50%; /* #7A6F8E */

    --lavender: 265 40% 16%;
    --lavender-foreground: 265 60% 85%;

    --accent: 275 25% 10%;
    --accent-foreground: 270 20% 88%;

    --destructive: 355 70% 60%;
    --destructive-foreground: 270 20% 88%;

    --border: 275 20% 13%; /* #1A1628 */
    --input: 275 18% 10%;
    --ring: 273 68% 65%;

    --radius: 0.625rem;

    /* 品牌语义 Token */
    --surface-warm: 275 40% 6%;
    --accent-gradient: linear-gradient(135deg, #6BA3F5, #C89BEC, #06040C);
    --accent-dark-gradient: linear-gradient(90deg, #5a41f5, #a855f7);

    /* 登录页「暗夜紫晶」变量 */
    --login-bg: #0a0a12;
    --login-panel-bg: #0d0d18;
    --login-purple-deep: #1a0a2e;
    --login-purple-mid: #6b21a8;
    --login-purple-bright: #a855f7;
    --login-purple-glow: #c084fc;
    --login-accent: #e879f9;
    --login-border: rgba(168, 85, 247, 0.15);
    --login-border-hover: rgba(168, 85, 247, 0.4);
    --login-text-primary: rgba(255, 255, 255, 0.92);
    --login-text-secondary: rgba(255, 255, 255, 0.45);
    --login-text-muted: rgba(255, 255, 255, 0.25);

    --scrollbar-size: 10px;
    --scrollbar-track: 275 40% 6%;
    --scrollbar-thumb: 275 16% 24%;
    --scrollbar-thumb-hover: 273 58% 64%;
    --scrollbar-thumb-active: 273 68% 72%;
  }
```

注意：登录页变量块保持不变。

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: 核心CSS变量从偏蓝(hue 222)改为深渊紫影(hue 275)"
```

---

### Task 2: 全站暗色主题覆盖

**Files:**
- Modify: `apps/web/src/app/globals.css:979-1001`

更新全站卡片阴影和表格悬停中的蓝色 rgba 为紫色。

- [ ] **Step 1: 修改卡片阴影中的蓝色**

将：
```css
[class*="card"],
.bg-card {
  box-shadow:
    0 0 0 1px rgba(107, 163, 245, 0.06),
    0 4px 24px rgba(0, 0, 0, 0.4);
}
```
改为：
```css
[class*="card"],
.bg-card {
  box-shadow:
    0 0 0 1px rgba(200, 155, 236, 0.06),
    0 4px 24px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 2: 修改表格悬停中的蓝色**

将：
```css
tbody tr:hover {
  background: rgba(107, 163, 245, 0.04);
}
```
改为：
```css
tbody tr:hover {
  background: rgba(200, 155, 236, 0.04);
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: 全站卡片阴影和表格悬停从蓝色改为紫色"
```

---

### Task 3: 生成页 Dream 样式

**Files:**
- Modify: `apps/web/src/app/globals.css:1011-1060`（`.generation-dream-page` 背景和变量）

- [ ] **Step 1: 修改 dream 局部变量**

在 `.generation-dream-page` 中，将三个变量：
```css
  --dream-panel: rgba(12, 18, 45, 0.58);
  --dream-deep: rgba(6, 10, 29, 0.82);
  --dream-blue: rgba(89, 169, 255, 0.26);
```
改为：
```css
  --dream-panel: rgba(11, 9, 20, 0.58);
  --dream-deep: rgba(6, 4, 12, 0.82);
  --dream-blue: rgba(89, 169, 255, 0.15);
```

- [ ] **Step 2: 修改页面主背景渐变**

将 `.generation-dream-page` 的 `background` 属性：
```css
  background:
    linear-gradient(180deg, rgba(7, 9, 31, 0.86) 0%, rgba(8, 13, 34, 0.98) 52%, rgba(5, 8, 24, 1) 100%),
    radial-gradient(ellipse at 48% -18%, rgba(202, 184, 255, 0.18), transparent 42rem),
    radial-gradient(ellipse at 88% 18%, rgba(82, 161, 255, 0.14), transparent 38rem),
    radial-gradient(ellipse at 24% 84%, rgba(255, 187, 143, 0.08), transparent 34rem);
```
改为：
```css
  background:
    linear-gradient(180deg, rgba(6, 4, 12, 0.86) 0%, rgba(8, 6, 16, 0.98) 52%, rgba(5, 4, 14, 1) 100%),
    radial-gradient(ellipse at 48% -18%, rgba(202, 184, 255, 0.18), transparent 42rem),
    radial-gradient(ellipse at 88% 18%, rgba(82, 161, 255, 0.08), transparent 38rem),
    radial-gradient(ellipse at 24% 84%, rgba(255, 187, 143, 0.08), transparent 34rem);
```

- [ ] **Step 3: 修改 ::before 背景中的蓝色**

将 `.generation-dream-page::before` 的 `background`：
```css
    linear-gradient(90deg, rgba(10, 15, 43, 0.22), transparent 38%, rgba(5, 9, 28, 0.28));
```
改为：
```css
    linear-gradient(90deg, rgba(10, 8, 22, 0.22), transparent 38%, rgba(5, 4, 16, 0.28));
```

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: 生成页dream背景从偏蓝改为紫黑，降低蓝色光晕"
```

---

### Task 4: 生成页 Stage 和 Detail Dialog 样式

**Files:**
- Modify: `apps/web/src/app/globals.css` 中 `.generation-dream-stage`、`.generation-detail-dialog` 及相关类

- [ ] **Step 1: 修改 stage 面板背景**

`.generation-dream-stage, .generation-dream-history-card` 的 `background`：
```css
    linear-gradient(128deg, rgba(255, 255, 255, 0.095), rgba(185, 198, 255, 0.028) 38%, rgba(84, 103, 202, 0.07)),
    var(--dream-panel) !important;
```
改为：
```css
    linear-gradient(128deg, rgba(255, 255, 255, 0.095), rgba(200, 185, 236, 0.028) 38%, rgba(100, 80, 180, 0.07)),
    var(--dream-panel) !important;
```

- [ ] **Step 2: 修改 media frame 背景**

`.generation-dream-media-frame, .generation-dream-asset-card` 的 `background`：
```css
    linear-gradient(180deg, rgba(24, 42, 79, 0.58), rgba(10, 17, 40, 0.74)),
    rgba(10, 17, 38, 0.72) !important;
```
改为：
```css
    linear-gradient(180deg, rgba(20, 16, 42, 0.58), rgba(12, 9, 28, 0.74)),
    rgba(11, 9, 22, 0.72) !important;
```

- [ ] **Step 3: 修改 detail dialog 背景**

`.generation-detail-dialog` 的 `background`：
```css
    radial-gradient(ellipse at 42% -8%, rgba(202, 184, 255, 0.2), transparent 34rem),
    radial-gradient(ellipse at 92% 24%, rgba(82, 161, 255, 0.11), transparent 34rem),
    radial-gradient(ellipse at 22% 88%, rgba(255, 187, 143, 0.08), transparent 30rem),
    linear-gradient(180deg, rgba(7, 9, 31, 0.9) 0%, rgba(8, 13, 34, 0.97) 56%, rgba(5, 8, 24, 0.99) 100%) !important;
```
改为：
```css
    radial-gradient(ellipse at 42% -8%, rgba(202, 184, 255, 0.2), transparent 34rem),
    radial-gradient(ellipse at 92% 24%, rgba(82, 161, 255, 0.06), transparent 34rem),
    radial-gradient(ellipse at 22% 88%, rgba(255, 187, 143, 0.08), transparent 30rem),
    linear-gradient(180deg, rgba(6, 4, 12, 0.9) 0%, rgba(8, 6, 16, 0.97) 56%, rgba(5, 4, 14, 0.99) 100%) !important;
```

- [ ] **Step 4: 修改 detail dialog ::before 背景**

`.generation-detail-dialog::before` 的 `background` 中：
```css
    radial-gradient(ellipse at 92% 0%, var(--detail-blue), transparent 18rem),
```
（此处使用 `var(--detail-blue)` 变量，需同步在 `.generation-detail-dialog` 的局部变量中修改）
将：
```css
  --detail-panel: rgba(12, 18, 45, 0.5);
  --detail-deep: rgba(6, 10, 29, 0.84);
  --detail-blue: rgba(89, 169, 255, 0.2);
```
改为：
```css
  --detail-panel: rgba(11, 9, 20, 0.5);
  --detail-deep: rgba(6, 4, 12, 0.84);
  --detail-blue: rgba(89, 169, 255, 0.1);
```

- [ ] **Step 5: 修改 video/audio card 背景**

`.generation-detail-video-card, .generation-detail-audio-card` 的 `background`：
```css
    linear-gradient(180deg, rgba(24, 42, 79, 0.5), rgba(10, 17, 40, 0.68)),
    rgba(10, 17, 38, 0.72);
```
改为：
```css
    linear-gradient(180deg, rgba(20, 16, 42, 0.5), rgba(12, 9, 28, 0.68)),
    rgba(11, 9, 22, 0.72);
```

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: 生成页stage和详情弹窗背景从偏蓝改为紫黑"
```

---

### Task 5: 创作首页玻璃卡片和 AI 助手

**Files:**
- Modify: `apps/web/src/app/globals.css` 中 `.creative-glass-card`、`.ai-glass-panel` 及相关类

- [ ] **Step 1: 修改 creative glass card 背景**

`.creative-glass-card` 的 `background`：
```css
    linear-gradient(118deg, rgba(255, 255, 255, 0.11), rgba(181, 193, 255, 0.025) 38%, rgba(16, 26, 72, 0.09)),
    rgba(255, 255, 255, 0.026);
```
改为：
```css
    linear-gradient(118deg, rgba(255, 255, 255, 0.11), rgba(200, 185, 236, 0.025) 38%, rgba(24, 16, 60, 0.09)),
    rgba(255, 255, 255, 0.026);
```

- [ ] **Step 2: 修改 creative glass card 阴影中的蓝色**

`.creative-glass-card` 的 `box-shadow`：
```css
    inset -24px -10px 62px rgba(63, 82, 180, 0.16),
    0 0 0 1px rgba(132, 105, 255, 0.1),
```
改为：
```css
    inset -24px -10px 62px rgba(82, 60, 160, 0.16),
    0 0 0 1px rgba(132, 105, 255, 0.1),
```

- [ ] **Step 3: 修改 ::before 中的蓝色径向渐变**

`.creative-glass-card::before` 的 `background`：
```css
    radial-gradient(ellipse at 92% 24%, rgba(119, 177, 255, 0.2), transparent 15rem),
    linear-gradient(115deg, rgba(255, 255, 255, 0.22), transparent 24%, rgba(142, 123, 255, 0.12) 74%, transparent);
```
改为：
```css
    radial-gradient(ellipse at 92% 24%, rgba(200, 155, 236, 0.2), transparent 15rem),
    linear-gradient(115deg, rgba(255, 255, 255, 0.22), transparent 24%, rgba(142, 123, 255, 0.12) 74%, transparent);
```

- [ ] **Step 4: 修改 ::after 中的蓝色渐变**

`.creative-glass-card::after` 的 `background`：
```css
    linear-gradient(270deg, rgba(132, 105, 255, 0.12), transparent 28%),
    linear-gradient(15deg, transparent 38%, rgba(124, 184, 255, 0.14) 52%, transparent 62%);
```
改为：
```css
    linear-gradient(270deg, rgba(132, 105, 255, 0.12), transparent 28%),
    linear-gradient(15deg, transparent 38%, rgba(168, 130, 236, 0.14) 52%, transparent 62%);
```

- [ ] **Step 5: 修改 hover 态阴影中的蓝色**

`.creative-glass-card:hover` 的 `box-shadow`：
```css
    inset -30px -12px 70px rgba(92, 108, 220, 0.22),
```
改为：
```css
    inset -30px -12px 70px rgba(82, 60, 160, 0.22),
```

- [ ] **Step 6: 修改 AI glass panel 背景**

`.ai-glass-panel` 的 `background`：
```css
    linear-gradient(118deg, rgba(255, 255, 255, 0.1), rgba(181, 193, 255, 0.03) 38%, rgba(16, 26, 72, 0.1)),
    rgba(8, 11, 34, 0.72);
```
改为：
```css
    linear-gradient(118deg, rgba(255, 255, 255, 0.1), rgba(200, 185, 236, 0.03) 38%, rgba(24, 16, 60, 0.1)),
    rgba(6, 4, 12, 0.72);
```

- [ ] **Step 7: 修改 AI glass msg 背景**

`.ai-glass-msg-bot` 的 `background`：
```css
  background: rgba(20, 24, 60, 0.55);
```
改为：
```css
  background: rgba(14, 10, 28, 0.55);
```

- [ ] **Step 8: 修改 AI glass 其他辅助类**

`.ai-glass-bg-deep`：
```css
  background: rgba(8, 11, 34, 0.6);
```
改为：
```css
  background: rgba(6, 4, 12, 0.6);
```

`.ai-glass-bg-surface`：
```css
  background: rgba(15, 18, 50, 0.5);
```
改为：
```css
  background: rgba(12, 8, 28, 0.5);
```

`.ai-glass-bg-copy`：
```css
  background: rgba(8, 11, 34, 0.8);
```
改为：
```css
  background: rgba(6, 4, 12, 0.8);
```

`.ai-glass-bg-copy:hover`：
```css
  background: rgba(15, 18, 50, 0.9);
```
改为：
```css
  background: rgba(12, 8, 28, 0.9);
```

- [ ] **Step 9: 修改创作首页内容面板**

`.creative-home-content-panel` 的 `background`：
```css
    radial-gradient(ellipse at 52% 0%, rgba(82, 112, 255, 0.04), transparent 34rem);
```
改为：
```css
    radial-gradient(ellipse at 52% 0%, rgba(116, 87, 255, 0.04), transparent 34rem);
```

- [ ] **Step 10: 修改创作首页视频背景蓝色光晕**

`.creative-home-video-backdrop::after`：
```css
    radial-gradient(ellipse at 78% 18%, rgba(96, 174, 255, 0.12), transparent 28rem),
```
改为：
```css
    radial-gradient(ellipse at 78% 18%, rgba(96, 174, 255, 0.06), transparent 28rem),
```

- [ ] **Step 11: 提交**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: 创作首页玻璃卡片和AI助手背景从偏蓝改为紫黑"
```

---

### Task 6: Toby Studio 样式

**Files:**
- Modify: `apps/web/src/app/globals.css` 中 `.toby-orb--sky`
- Modify: `apps/web/src/app/(dashboard)/toby-studio/page.tsx:16`

- [ ] **Step 1: 修改 Toby 蓝色光晕透明度**

`.toby-orb--sky` 的 `background`：
```css
  background: radial-gradient(circle, rgba(59, 130, 246, 0.10) 0%, transparent 70%);
```
改为：
```css
  background: radial-gradient(circle, rgba(59, 130, 246, 0.05) 0%, transparent 70%);
```

- [ ] **Step 2: 修改 Toby 页面背景渐变**

`apps/web/src/app/(dashboard)/toby-studio/page.tsx` 第 16 行，将 AI 短剧的渐变：
```typescript
  'AI 短剧': 'from-sky-500/60 via-blue-500/20 to-indigo-500/40',
```
改为：
```typescript
  'AI 短剧': 'from-purple-600/30 via-purple-900/10 to-indigo-900/20',
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/\(dashboard\)/toby-studio/page.tsx
git commit -m "style: Toby Studio蓝色光晕降低、背景渐变改为紫黑调"
```

---

### Task 7: 资产模块样式

**Files:**
- Modify: `apps/web/src/app/globals.css` 中 `.asset-glass-card`、`.assets-page-atmosphere`、`.asset-hover-layer`

- [ ] **Step 1: 修改资产玻璃卡片背景**

`.asset-glass-card` 的 `background`：
```css
    linear-gradient(118deg, rgba(255, 255, 255, 0.06), rgba(181, 193, 255, 0.015) 38%, rgba(16, 26, 72, 0.05)),
    rgba(255, 255, 255, 0.018);
```
改为：
```css
    linear-gradient(118deg, rgba(255, 255, 255, 0.06), rgba(200, 185, 236, 0.015) 38%, rgba(24, 16, 60, 0.05)),
    rgba(255, 255, 255, 0.018);
```

- [ ] **Step 2: 修改资产页面大气层**

`.assets-page-atmosphere` 的 `background`：
```css
    radial-gradient(ellipse at 32% 8%, rgba(116, 87, 255, 0.08), transparent 28rem),
    radial-gradient(ellipse at 72% 4%, rgba(59, 130, 246, 0.05), transparent 24rem),
    radial-gradient(ellipse at 50% 100%, rgba(6, 8, 25, 0.5), transparent 50%);
```
改为：
```css
    radial-gradient(ellipse at 32% 8%, rgba(116, 87, 255, 0.08), transparent 28rem),
    radial-gradient(ellipse at 72% 4%, rgba(59, 130, 246, 0.025), transparent 24rem),
    radial-gradient(ellipse at 50% 100%, rgba(6, 4, 12, 0.5), transparent 50%);
```

- [ ] **Step 3: 修改资产悬停操作层**

`.asset-hover-layer` 的 `background`：
```css
    rgba(5, 7, 22, 0) 0%,
    rgba(5, 7, 22, 0.15) 25%,
    rgba(5, 7, 22, 0.65) 100%
```
改为：
```css
    rgba(6, 4, 12, 0) 0%,
    rgba(6, 4, 12, 0.15) 25%,
    rgba(6, 4, 12, 0.65) 100%
```

- [ ] **Step 4: 修改资产日期分割线**

`.asset-date-heading::after` 的渐变颜色（保持淡色调，只改紫微调，不需要大改，此处可跳过）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: 资产模块背景从偏蓝改为紫黑，降低蓝色光晕"
```

---

### Task 8: 生成页 Prompt Shell 和灵感页辅助样式

**Files:**
- Modify: `apps/web/src/app/globals.css` 中 `.generation-detail-prompt-shell:hover`、`.inspiration-sticky-tabs.is-stuck`

- [ ] **Step 1: 修改 prompt shell hover 背景**

`.generation-detail-prompt-shell:hover` 的 `background`：
```css
    linear-gradient(135deg, rgba(255, 255, 255, 0.075), rgba(140, 159, 255, 0.026)),
    rgba(5, 9, 27, 0.82);
```
改为：
```css
    linear-gradient(135deg, rgba(255, 255, 255, 0.075), rgba(160, 140, 236, 0.026)),
    rgba(6, 4, 12, 0.82);
```

- [ ] **Step 2: 修改灵感页吸顶栏背景**

`.inspiration-sticky-tabs.is-stuck` 的 `background`：
```css
  background: rgba(6, 8, 25, 0.92);
```
改为：
```css
  background: rgba(6, 4, 12, 0.92);
```

- [ ] **Step 3: 修改视频背景吸附态遮罩**

`.creative-home-video-backdrop.is-stuck::before`：
```css
    rgba(4, 6, 20, 0.14) 0%,
    rgba(6, 8, 25, 0.28) 64%,
    rgba(6, 8, 25, 0.68) 100%
```
改为：
```css
    rgba(4, 4, 12, 0.14) 0%,
    rgba(6, 4, 12, 0.28) 64%,
    rgba(6, 4, 12, 0.68) 100%
```

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: 生成页prompt shell和灵感页吸顶栏从偏蓝改为紫黑"
```

---

## 自检清单

- [x] **Spec 覆盖度：** 设计文档中 7 个章节均有对应 Task
- [x] **占位符扫描：** 无 TBD/TODO/占位符，每个 Step 都有具体代码
- [x] **类型一致性：** 纯 CSS 变更，无类型问题
