# AIGC User Guide Login Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtle login-page link to a new illustrated AIGC user guide, and build the guide from current-page screenshots.

**Architecture:** Keep the login page focused by adding only a text link beside the existing agreement links. Add a static MDX guide page under the existing docs system and update docs navigation. Capture current UI screenshots into `apps/web/public/docs-images` and reference those files from the guide.

**Tech Stack:** Next.js 14 App Router, React 18, MDX docs pages, Tailwind CSS utility classes, Playwright or browser screenshot tooling for local screenshots.

---

## File Structure

- Modify: `apps/web/src/app/(auth)/login/page.tsx`
  - Add `Link` import from `next/link`.
  - Add a low-emphasis `《AIGC 用户使用手册》` text link near existing agreement links.
- Modify: `apps/web/src/app/docs/layout.tsx`
  - Add `/docs/user-guide` to the “开始使用” docs navigation group.
- Create: `apps/web/src/app/docs/user-guide/page.mdx`
  - Write the full ordinary-user guide.
  - Cover creation features only; exclude user, team, admin, settings, and recharge operations.
- Create screenshot files in `apps/web/public/docs-images`
  - `user-guide-login-link.png`
  - `user-guide-home.png`
  - `user-guide-generation-image.png`
  - `user-guide-generation-video.png`
  - `user-guide-assets.png`
  - `user-guide-canvas.png`
  - `user-guide-video-studio.png`
  - `user-guide-toby-studio.png`

## Task 1: Add The Login Page Text Link

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Inspect current login footer**

Run:

```bash
rg -n "login-footer-links|用户协议|隐私政策" "apps/web/src/app/(auth)/login/page.tsx"
```

Expected: show the existing footer block with `《用户协议》` and `《隐私政策》`.

- [ ] **Step 2: Add the `Link` import**

Change the import block to include `Link`:

```tsx
import Link from 'next/link'
```

Keep existing imports unchanged.

- [ ] **Step 3: Replace footer link spans with accessible links**

Replace only the current footer block:

```tsx
<div className="login-footer-links">
  <span>登录即代表同意</span>
  <span className="login-link">《用户协议》</span>
  <span>和</span>
  <span className="login-link">《隐私政策》</span>
</div>
```

with:

```tsx
<div className="login-footer-links">
  <span>登录即代表同意</span>
  <span className="login-link">《用户协议》</span>
  <span>和</span>
  <span className="login-link">《隐私政策》</span>
  <span className="basis-full text-center">
    首次使用可查看
    <Link href="/docs/user-guide" className="login-link">
      《AIGC 用户使用手册》
    </Link>
  </span>
</div>
```

This keeps the manual entry visually similar to the existing agreement text and avoids adding a button.

- [ ] **Step 4: Static verification**

Run:

```bash
rg -n "AIGC 用户使用手册|/docs/user-guide" "apps/web/src/app/(auth)/login/page.tsx"
```

Expected: show the `Link href="/docs/user-guide"` line and visible manual text.

## Task 2: Add Docs Navigation Entry

**Files:**
- Modify: `apps/web/src/app/docs/layout.tsx`

- [ ] **Step 1: Add the guide to the “开始使用” group**

Update the first `navSections` group from:

```tsx
items: [
  { href: '/docs', label: '平台简介' },
  { href: '/docs/login', label: '登录与账户' },
  { href: '/docs/workspace', label: '工作台' },
],
```

to:

```tsx
items: [
  { href: '/docs', label: '平台简介' },
  { href: '/docs/user-guide', label: '用户使用手册' },
  { href: '/docs/login', label: '登录与账户' },
  { href: '/docs/workspace', label: '工作台' },
],
```

- [ ] **Step 2: Static verification**

Run:

```bash
rg -n "用户使用手册|/docs/user-guide" "apps/web/src/app/docs/layout.tsx"
```

Expected: show one nav item for `/docs/user-guide`.

## Task 3: Capture Current UI Screenshots

**Files:**
- Create: `apps/web/public/docs-images/user-guide-login-link.png`
- Create: `apps/web/public/docs-images/user-guide-home.png`
- Create: `apps/web/public/docs-images/user-guide-generation-image.png`
- Create: `apps/web/public/docs-images/user-guide-generation-video.png`
- Create: `apps/web/public/docs-images/user-guide-assets.png`
- Create: `apps/web/public/docs-images/user-guide-canvas.png`
- Create: `apps/web/public/docs-images/user-guide-video-studio.png`
- Create: `apps/web/public/docs-images/user-guide-toby-studio.png`

- [ ] **Step 1: Check whether the existing web server is reachable**

Run:

```bash
node -e "fetch('http://localhost:6006/login').then(r=>{console.log(r.status); process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message); process.exit(1)})"
```

Expected if server is available: `200`.

If this fails, stop implementation and report that screenshots cannot be captured without an already running local web server. Do not start, restart, build, or refresh `localhost:6006`.

- [ ] **Step 2: Capture screenshots from current pages**

Use the available screenshot workflow, targeting:

```text
http://localhost:6006/login
http://localhost:6006/
http://localhost:6006/generation?mode=image
http://localhost:6006/generation?mode=video
http://localhost:6006/assets
http://localhost:6006/canvas
http://localhost:6006/video-studio
http://localhost:6006/toby-studio
```

Save outputs exactly as:

```text
apps/web/public/docs-images/user-guide-login-link.png
apps/web/public/docs-images/user-guide-home.png
apps/web/public/docs-images/user-guide-generation-image.png
apps/web/public/docs-images/user-guide-generation-video.png
apps/web/public/docs-images/user-guide-assets.png
apps/web/public/docs-images/user-guide-canvas.png
apps/web/public/docs-images/user-guide-video-studio.png
apps/web/public/docs-images/user-guide-toby-studio.png
```

For authenticated pages, if the current browser session is not logged in, capture only pages that are accessible and report the blocked routes. Do not create fake UI images.

- [ ] **Step 3: Verify screenshot files exist**

Run:

```bash
Test-Path apps/web/public/docs-images/user-guide-login-link.png
Test-Path apps/web/public/docs-images/user-guide-home.png
Test-Path apps/web/public/docs-images/user-guide-generation-image.png
Test-Path apps/web/public/docs-images/user-guide-generation-video.png
Test-Path apps/web/public/docs-images/user-guide-assets.png
Test-Path apps/web/public/docs-images/user-guide-canvas.png
Test-Path apps/web/public/docs-images/user-guide-video-studio.png
Test-Path apps/web/public/docs-images/user-guide-toby-studio.png
```

Expected: `True` for every screenshot that was successfully captured. If any route was blocked by authentication, document that in the final implementation note.

## Task 4: Write The MDX User Guide

**Files:**
- Create: `apps/web/src/app/docs/user-guide/page.mdx`

- [ ] **Step 1: Create the guide page**

Create `apps/web/src/app/docs/user-guide/page.mdx` with this content structure:

```mdx
# AIGC 用户使用手册

这份手册面向普通创作用户，帮助你从登录前了解平台入口，到进入各个创作模块完成图片、视频、画布和专项内容创作。本文不包含用户、团队、后台管理、设置或充值相关操作。

![登录页手册入口](/docs-images/user-guide-login-link.png)

---

## 1. 从哪里开始

登录后进入平台首页。首页提供三个主要创作方向：

| 入口 | 适合做什么 |
|---|---|
| **AI 生图** | 用文字描述或参考图快速生成图片 |
| **AI 视频** | 用文字、首尾帧或参考图生成视频 |
| **灵动画布** | 把素材、提示词、图片、视频节点串联成完整工作流 |

![平台首页入口](/docs-images/user-guide-home.png)

---

## 2. AI 生图

进入 **创作生成 → 图片** 后，可以直接输入画面描述生成图片，也可以上传参考图进行图生图。

![AI 生图页面](/docs-images/user-guide-generation-image.png)

### 常用流程

1. 上传参考图，或保持为空直接文生图。
2. 在提示词中写清楚主体、风格、构图、光线和用途。
3. 选择模型、质量、比例和生成数量。
4. 点击生成，等待结果出现在右侧历史记录中。
5. 打开结果详情后，可预览、下载或复用参数继续微调。

### 使用建议

如果你已经得到接近满意的图片，优先使用“复用”把提示词和参数带回生成面板，再做小幅调整。

---

## 3. AI 视频

进入 **创作生成 → 视频** 后，可以用文字和参考素材生成视频。

![AI 视频页面](/docs-images/user-guide-generation-video.png)

### 两种常见方式

| 模式 | 用法 |
|---|---|
| **首尾帧** | 上传首帧和可选尾帧，让 AI 生成过渡动画 |
| **参考生视频** | 上传参考图片，让 AI 按图片视觉风格生成视频 |

### 常用流程

1. 选择视频创作模式。
2. 上传首帧、尾帧或参考图。
3. 输入动作、镜头运动和画面氛围描述。
4. 设置分辨率和比例。
5. 提交生成后，在历史记录中查看进度与结果。

视频生成通常比图片生成更久，提交后可切换到其他页面继续工作。

---

## 4. 资产库与历史详情

资产库用于集中管理已经生成的图片和视频。你可以按类型和日期筛选，也可以打开详情查看来源批次。

![资产库](/docs-images/user-guide-assets.png)

### 常用操作

| 操作 | 说明 |
|---|---|
| **预览** | 打开图片或视频详情 |
| **下载** | 保存生成结果到本地 |
| **复用** | 将原提示词和参数带回创作生成页面 |
| **删除** | 将资产移入回收站 |

---

## 5. 灵动画布

灵动画布适合做更复杂的串联创作。你可以从制作视频、生成图片或自由创作开始。

![灵动画布入口](/docs-images/user-guide-canvas.png)

### 适合场景

- 把文字脚本拆成分镜，再继续生成图片或视频。
- 用多个素材节点组织参考图、提示词和生成结果。
- 尝试不同创作路径，并保留上下游关系。

---

## 6. 视频工坊

视频工坊用于更完整的视频项目制作，从故事描述逐步推进到剧本、分镜、角色和视频。

![视频工坊](/docs-images/user-guide-video-studio.png)

### 常用流程

1. 新建视频项目。
2. 描述故事主题和内容方向。
3. 生成或调整剧本。
4. 拆分分镜并确认角色与场景。
5. 逐镜头生成视频并导出结果。

---

## 7. Toby Studio 专项创作

Toby Studio 是专项内容工作室入口，承载音乐、绘本、短剧等独立模块。

![Toby Studio](/docs-images/user-guide-toby-studio.png)

选择对应模块后，按照页面内步骤逐步填写素材、文本和生成参数即可。

---

## 8. 常见建议

| 场景 | 建议 |
|---|---|
| 不知道怎么写提示词 | 先写清楚主体、动作、风格、比例和用途，再逐步补细节 |
| 结果方向接近但不够准 | 使用复用功能微调，不要从零开始 |
| 生成后离开页面 | 任务会继续执行，完成后可在历史或资产库中查看 |
| 页面提示 A 豆不足或无工作区 | 联系团队负责人处理 |
```

- [ ] **Step 2: Verify MDX references only planned screenshots**

Run:

```bash
rg -n "/docs-images/user-guide-" apps/web/src/app/docs/user-guide/page.mdx
```

Expected: every image reference uses the `user-guide-*.png` naming pattern.

## Task 5: Final Static Verification

**Files:**
- Verify: `apps/web/src/app/(auth)/login/page.tsx`
- Verify: `apps/web/src/app/docs/layout.tsx`
- Verify: `apps/web/src/app/docs/user-guide/page.mdx`
- Verify: `apps/web/public/docs-images/user-guide-*.png`

- [ ] **Step 1: Verify all user-guide references**

Run:

```bash
rg -n "AIGC 用户使用手册|/docs/user-guide|用户使用手册" apps/web/src/app
```

Expected: matches in login page, docs layout, and user guide page.

- [ ] **Step 2: Verify referenced screenshots exist**

Run:

```bash
$refs = rg -o "/docs-images/user-guide-[^)]+" apps/web/src/app/docs/user-guide/page.mdx | ForEach-Object { $_.TrimStart('/') }
$missing = @()
foreach ($ref in $refs) {
  if (-not (Test-Path "apps/web/public/$ref")) { $missing += $ref }
}
if ($missing.Count) { $missing; exit 1 } else { "all screenshots exist" }
```

Expected: `all screenshots exist`.

- [ ] **Step 3: Check git diff is scoped**

Run:

```bash
git status --short
git diff -- "apps/web/src/app/(auth)/login/page.tsx" "apps/web/src/app/docs/layout.tsx" "apps/web/src/app/docs/user-guide/page.mdx"
```

Expected: only the login link, docs nav, new guide page, and screenshot assets are part of this feature. Existing unrelated worktree changes must remain untouched.

- [ ] **Step 4: Do not run preview build**

Do not run:

```bash
pnpm build
pnpm dev
pnpm --filter @aigc/web dev
```

This follows the repository instruction that local frontend preview/build validation should not be run for completed frontend changes in this project.
