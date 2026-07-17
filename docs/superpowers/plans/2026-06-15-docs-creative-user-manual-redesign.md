# Docs Creative User Manual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/docs` into a current, ordinary-user AIGC creation manual focused on creative features only.

**Architecture:** Replace the temporary Markdown-string conversion with structured TSX documentation pages. Centralize docs navigation and reusable presentation components so pages read like a product manual, not a legacy markdown dump. Keep all docs pages as `page.tsx` to avoid the current Turbopack/MDX failure.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, existing docs CSS classes, local static assets in `apps/web/public/docs-images`.

---

## File Structure

- Create: `apps/web/src/components/docs/docs-page.tsx`
  - Shared document UI primitives: page heading, lead text, figure, feature grid, simple table, step list, note block.
- Create: `apps/web/src/components/docs/docs-data.ts`
  - Shared docs navigation groups and page metadata.
- Modify: `apps/web/src/app/docs/layout.tsx`
  - Read navigation from `docs-data.ts`.
  - Replace old sections with “开始创作 / 核心创作 / 专项工作室”.
- Replace content:
  - `apps/web/src/app/docs/page.tsx`
  - `apps/web/src/app/docs/user-guide/page.tsx`
  - `apps/web/src/app/docs/image-generation/page.tsx`
  - `apps/web/src/app/docs/video-generation/page.tsx`
  - `apps/web/src/app/docs/canvas/page.tsx`
  - `apps/web/src/app/docs/assets/page.tsx`
  - `apps/web/src/app/docs/ai-assistant/page.tsx`
  - `apps/web/src/app/docs/toby-studio/page.tsx`
  - `apps/web/src/app/docs/music/page.tsx`
  - `apps/web/src/app/docs/short-drama/page.tsx`
  - `apps/web/src/app/docs/picture-book/page.tsx`
- Remove from docs navigation and delete if no longer needed:
  - `apps/web/src/app/docs/workspace/page.tsx`
  - `apps/web/src/app/docs/asset-library/page.tsx`
  - `apps/web/src/app/docs/login/page.tsx`
  - `apps/web/src/app/docs/case-poster/page.tsx`
  - `apps/web/src/app/docs/case-video/page.tsx`
- Keep existing screenshots that were just captured where they match current UI:
  - `user-guide-login-link.png`
  - `user-guide-home.png`
  - `user-guide-generation-image.png`
  - `user-guide-generation-video.png`
  - `user-guide-assets.png`
  - `user-guide-canvas.png`
  - `user-guide-video-studio.png`
  - `user-guide-toby-studio.png`

## Task 1: Shared Docs Components

**Files:**
- Create: `apps/web/src/components/docs/docs-page.tsx`
- Create: `apps/web/src/components/docs/docs-data.ts`
- Modify: `apps/web/src/app/docs/layout.tsx`

- [ ] **Step 1: Replace temporary Markdown helper**

Delete `apps/web/src/components/docs/markdown-page.tsx` if it exists. It was only a stopgap for the MDX failure and must not remain the main content strategy.

- [ ] **Step 2: Create `docs-page.tsx`**

Create `apps/web/src/components/docs/docs-page.tsx`:

```tsx
import type { ReactNode } from 'react'
import Link from 'next/link'

export function DocsPage({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
      {children}
    </>
  )
}

export function DocsFigure({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure>
      <img src={src} alt={alt} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  )
}

export function DocsCards({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>
}

export function DocsCard({ title, children, href }: { title: string; children: ReactNode; href?: string }) {
  const body = (
    <div className="rounded-lg border border-[#E7DDF4] bg-white/70 p-4">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

export function DocsNote({ children }: { children: ReactNode }) {
  return <blockquote>{children}</blockquote>
}

export function DocsSteps({ children }: { children: ReactNode }) {
  return <ol>{children}</ol>
}
```

- [ ] **Step 3: Create `docs-data.ts`**

Create `apps/web/src/components/docs/docs-data.ts`:

```ts
export const docsNavSections = [
  {
    label: '开始创作',
    items: [
      { href: '/docs', label: '创作手册首页' },
      { href: '/docs/user-guide', label: '快速上手' },
    ],
  },
  {
    label: '核心创作',
    items: [
      { href: '/docs/image-generation', label: 'AI 生图' },
      { href: '/docs/video-generation', label: 'AI 视频' },
      { href: '/docs/canvas', label: '灵动画布' },
      { href: '/docs/assets', label: '资产库与历史复用' },
      { href: '/docs/ai-assistant', label: 'Toby.AI 创作助手' },
    ],
  },
  {
    label: '专项工作室',
    items: [
      { href: '/docs/toby-studio', label: 'Toby Studio 总览' },
      { href: '/docs/music', label: 'AI 音乐' },
      { href: '/docs/short-drama', label: 'AI 短剧' },
      { href: '/docs/picture-book', label: 'AI 绘本' },
    ],
  },
] as const
```

- [ ] **Step 4: Update docs layout navigation**

In `apps/web/src/app/docs/layout.tsx`, remove the local `navSections` constant and import:

```tsx
import { docsNavSections } from '@/components/docs/docs-data'
```

Then render `docsNavSections.map(...)` instead of `navSections.map(...)`.

- [ ] **Step 5: Verify navigation source**

Run:

```bash
rg -n "docsNavSections|登录与账户|工作台|海报制作|宣传短片" apps/web/src/app/docs/layout.tsx apps/web/src/components/docs/docs-data.ts
```

Expected: `docsNavSections` is used; old labels do not appear in layout or navigation data.

## Task 2: Start Pages

**Files:**
- Modify: `apps/web/src/app/docs/page.tsx`
- Modify: `apps/web/src/app/docs/user-guide/page.tsx`

- [ ] **Step 1: Rewrite `/docs` as creation manual home**

Replace `apps/web/src/app/docs/page.tsx` with a structured TSX page using `DocsPage`, `DocsCards`, `DocsCard`, `DocsFigure`, and `DocsNote`.

It must include:
- Title: `AIGC 创作手册`
- Lead: `面向普通创作用户，按当前平台入口介绍 AI 生图、AI 视频、灵动画布、资产库和 Toby Studio。`
- A figure using `/docs-images/user-guide-home.png`.
- Cards linking to:
  - `/docs/image-generation`
  - `/docs/video-generation`
  - `/docs/canvas`
  - `/docs/assets`
  - `/docs/toby-studio`
  - `/docs/ai-assistant`
- A note saying management, settings, recharge, and admin features are not covered.

- [ ] **Step 2: Rewrite `/docs/user-guide` as quick start**

Replace `apps/web/src/app/docs/user-guide/page.tsx` with a structured TSX quick-start page.

It must include:
- Title: `快速上手`
- The login-page screenshot `/docs-images/user-guide-login-link.png`.
- A five-step numbered path:
  1. 登录后进入灵感首页。
  2. 选择 AI 生图、AI 视频、灵动画布或 Toby Studio。
  3. 填写提示词并上传参考素材。
  4. 提交生成任务并等待完成。
  5. 在资产库查看、下载、复用或继续创作。
- Links to relevant docs pages.

- [ ] **Step 3: Verify start pages**

Run:

```bash
node -e "Promise.all(['/docs','/docs/user-guide'].map(p=>fetch('http://localhost:6006'+p).then(async r=>({p,status:r.status,text:await r.text()})))).then(xs=>console.log(xs.map(x=>({p:x.p,status:x.status,err:x.text.includes('Expected process result')||x.text.includes('Server Error')}))))"
```

Expected: both routes status `200`, `err: false`.

## Task 3: Core Creation Pages

**Files:**
- Modify: `apps/web/src/app/docs/image-generation/page.tsx`
- Modify: `apps/web/src/app/docs/video-generation/page.tsx`
- Create: `apps/web/src/app/docs/canvas/page.tsx`
- Create: `apps/web/src/app/docs/assets/page.tsx`
- Modify: `apps/web/src/app/docs/ai-assistant/page.tsx`
- Remove: `apps/web/src/app/docs/asset-library/page.tsx`

- [ ] **Step 1: Rewrite AI image page**

`apps/web/src/app/docs/image-generation/page.tsx` must cover:
- Entry route: homepage AI 生图 card or side rail 创作.
- Text-to-image and reference-image generation.
- Prompt writing checklist.
- Parameters: model, quality, ratio, quantity.
- Result handling: history, detail, download, reuse.
- Figure: `/docs-images/user-guide-generation-image.png`.

- [ ] **Step 2: Rewrite AI video page**

`apps/web/src/app/docs/video-generation/page.tsx` must cover:
- Entry route: homepage AI 视频 card or side rail 创作.
- 首尾帧, 参考生视频, text prompt.
- Motion and camera wording.
- Task duration and leaving page.
- Result handling: preview, download, reuse.
- Figure: `/docs-images/user-guide-generation-video.png`.

- [ ] **Step 3: Create canvas page**

Create `apps/web/src/app/docs/canvas/page.tsx`.

It must cover:
- Entry route: homepage 灵动画布 card or side rail 画布.
- Three start choices: 制作视频, 生成图片, 自由创作.
- Node-based thinking: assets, text, image generation, video generation, audio, stitching.
- Suitable scenarios and limitations.
- Figure: `/docs-images/user-guide-canvas.png`.

- [ ] **Step 4: Create assets page**

Create `apps/web/src/app/docs/assets/page.tsx`.

It must cover:
- Image/video switch.
- Date filter.
- Grid browsing and detail opening.
- Download, reuse, delete, recycle bin.
- Explain that completed generation results become reusable assets.
- Figure: `/docs-images/user-guide-assets.png`.

- [ ] **Step 5: Remove old asset-library route**

Delete `apps/web/src/app/docs/asset-library/page.tsx`. The new route is `/docs/assets`.

- [ ] **Step 6: Rewrite AI assistant page**

`apps/web/src/app/docs/ai-assistant/page.tsx` must cover:
- Right-bottom floating assistant.
- Chat assistant for prompt optimization and creative planning.
- Image parsing for extracting reusable prompt structure.
- User must review generated text before using it.
- Use current screenshots only if available; otherwise no legacy screenshot is required.

- [ ] **Step 7: Verify core routes**

Run:

```bash
node -e "Promise.all(['/docs/image-generation','/docs/video-generation','/docs/canvas','/docs/assets','/docs/ai-assistant'].map(p=>fetch('http://localhost:6006'+p).then(async r=>({p,status:r.status,text:await r.text()})))).then(xs=>console.log(xs.map(x=>({p:x.p,status:x.status,err:x.text.includes('Expected process result')||x.text.includes('Server Error')}))))"
```

Expected: all status `200`, all `err: false`.

## Task 4: Studio Pages

**Files:**
- Create: `apps/web/src/app/docs/toby-studio/page.tsx`
- Create: `apps/web/src/app/docs/music/page.tsx`
- Create: `apps/web/src/app/docs/short-drama/page.tsx`
- Create: `apps/web/src/app/docs/picture-book/page.tsx`

- [ ] **Step 1: Create Toby Studio overview**

`/docs/toby-studio` must cover:
- Entry route: side rail Toby or homepage related entry.
- Open modules: AI 音乐, AI 短剧, AI 绘本.
- Waiting modules: AI 海报, AI PPT. Do not invent steps for waiting modules.
- Figure: `/docs-images/user-guide-toby-studio.png`.

- [ ] **Step 2: Create AI music page**

`/docs/music` must cover:
- Create music.
- Browse/search my music.
- Voice clone entry and generation states.
- Open detail to play and view lyrics.
- No invented provider-specific settings.

- [ ] **Step 3: Create AI short drama page**

`/docs/short-drama` must cover:
- Create a short drama project.
- Story/project setup.
- Progress through episodes, script, storyboard, and video-oriented stages.
- Save and continue editing.
- Only describe flows confirmed by code and visible entry text.

- [ ] **Step 4: Create AI picture book page**

`/docs/picture-book` must cover:
- Create a picture book project.
- Story, character setup, continuous image creation direction.
- Project list and continue editing.
- Only describe flows confirmed by code and visible entry text.

- [ ] **Step 5: Verify studio routes**

Run:

```bash
node -e "Promise.all(['/docs/toby-studio','/docs/music','/docs/short-drama','/docs/picture-book'].map(p=>fetch('http://localhost:6006'+p).then(async r=>({p,status:r.status,text:await r.text()})))).then(xs=>console.log(xs.map(x=>({p:x.p,status:x.status,err:x.text.includes('Expected process result')||x.text.includes('Server Error')}))))"
```

Expected: all status `200`, all `err: false`.

## Task 5: Remove Old Mainline Docs

**Files:**
- Delete: `apps/web/src/app/docs/workspace/page.tsx`
- Delete: `apps/web/src/app/docs/login/page.tsx`
- Delete: `apps/web/src/app/docs/case-poster/page.tsx`
- Delete: `apps/web/src/app/docs/case-video/page.tsx`

- [ ] **Step 1: Delete old non-user-creation docs**

Delete these pages from docs:

```text
apps/web/src/app/docs/workspace/page.tsx
apps/web/src/app/docs/login/page.tsx
apps/web/src/app/docs/case-poster/page.tsx
apps/web/src/app/docs/case-video/page.tsx
```

These no longer belong to the ordinary creative-user manual.

- [ ] **Step 2: Verify old labels are gone from docs nav**

Run:

```bash
rg -n "登录与账户|工作台|海报制作|宣传短片|团队管理|管理后台|充值|设置" apps/web/src/app/docs apps/web/src/components/docs
```

Expected: no matches, except if a line explicitly says those management features are not covered.

## Task 6: Screenshot And Asset Verification

**Files:**
- Verify: `apps/web/public/docs-images/user-guide-*.png`
- Optional create: new `docs-*.png` screenshots if current pages are reachable without restarting dev server.

- [ ] **Step 1: Check current screenshots exist**

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

Expected: all lines are `True`.

- [ ] **Step 2: Verify all referenced images exist**

Run:

```bash
@'
from pathlib import Path
import re
files = list(Path('apps/web/src/app/docs').glob('**/page.tsx'))
missing = []
for file in files:
    text = file.read_text(encoding='utf-8')
    for ref in re.findall(r'/docs-images/[^"\']+', text):
        if not Path('apps/web/public', ref.lstrip('/')).exists():
            missing.append(f'{file}: {ref}')
if missing:
    print('\n'.join(missing))
    raise SystemExit(1)
print('all referenced docs images exist')
'@ | python -
```

Expected: `all referenced docs images exist`.

## Task 7: Full Docs Verification

**Files:**
- Verify all docs routes in `docsNavSections`.

- [ ] **Step 1: Verify no MDX pages remain under docs**

Run:

```bash
rg --files apps/web/src/app/docs | rg "page\\.mdx$"; if ($LASTEXITCODE -eq 1) { "no docs page.mdx remains" }
```

Expected: `no docs page.mdx remains`.

- [ ] **Step 2: Verify all nav routes return 200**

Run:

```bash
@'
const routes = [
  '/docs',
  '/docs/user-guide',
  '/docs/image-generation',
  '/docs/video-generation',
  '/docs/canvas',
  '/docs/assets',
  '/docs/ai-assistant',
  '/docs/toby-studio',
  '/docs/music',
  '/docs/short-drama',
  '/docs/picture-book',
];
(async () => {
  const results = [];
  for (const route of routes) {
    const res = await fetch(`http://localhost:6006${route}`);
    const text = await res.text();
    results.push({
      route,
      status: res.status,
      error: text.includes('Expected process result') || text.includes('Server Error'),
    });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((item) => item.status !== 200 || item.error)) process.exit(1);
})();
'@ | node -
```

Expected: command exits `0`, every route status `200`, every `error` is `false`.

- [ ] **Step 3: Verify login manual entry still exists**

Run:

```bash
rg -n "AIGC 用户使用手册|/docs/user-guide" "apps/web/src/app/(auth)/login/page.tsx"
```

Expected: login page still links to `/docs/user-guide`.

- [ ] **Step 4: Review scoped git diff**

Run:

```bash
git status --short apps/web/src/app/docs apps/web/src/components/docs apps/web/src/app/(auth)/login/page.tsx apps/web/public/docs-images
```

Expected: only docs redesign, login guide link, and docs images are included in this feature scope. Existing unrelated short-drama/API changes remain untouched.

- [ ] **Step 5: Do not run build or dev**

Do not run:

```bash
pnpm build
pnpm dev
pnpm --filter @aigc/web dev
```

This follows the repository rule for this project.
