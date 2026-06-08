# AI Studio Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作区壳子和首页改成「顶部创作主导航 + 左侧管理栏 + 创作入口 + 精选灵感瀑布流」。

**Architecture:** 把创作导航、管理导航和首页静态数据拆成独立模块，组件只负责渲染。`Topbar` 承载顶部创作主导航，`Sidebar` 承载管理入口，首页从静态数据渲染四个创作入口和精选瀑布流。

**Tech Stack:** Next.js 14 App Router、React 18、TypeScript、Tailwind CSS、Radix UI、lucide-react、node:test。

---

## File Structure

- Create: `apps/web/src/components/layout/nav-config.ts`
  - 导出顶部创作导航、左侧管理导航、移动端导航配置和 active 匹配函数。
- Create: `apps/web/src/components/layout/nav-config.test.ts`
  - 使用 `node:test` 校验导航标签、路由、命名映射和 active 匹配。
- Create: `apps/web/src/components/layout/creative-top-nav.tsx`
  - 渲染桌面顶部创作主导航，支持 AI 视频下拉两个入口。
- Modify: `apps/web/src/components/layout/topbar.tsx`
  - 引入 `CreativeTopNav`，把顶部左侧从标题区域改成创作主导航。
- Modify: `apps/web/src/components/layout/sidebar.tsx`
  - 左侧只保留管理/辅助入口：工作区、团队、积分、设置、管理后台、操作手册等。
- Modify: `apps/web/src/components/layout/mobile-sidebar.tsx`
  - 移动端合并展示创作导航和管理导航，保持 Sheet 关闭行为。
- Create: `apps/web/src/components/dashboard/creative-home-data.ts`
  - 首页入口和精选灵感瀑布流静态数据。
- Create: `apps/web/src/components/dashboard/creative-home-data.test.ts`
  - 校验首页入口数量、标签、路由和精选流不含点击目标。
- Modify: `apps/web/src/app/(dashboard)/page.tsx`
  - 从当前工作台数据页改为创作首页。
- Modify: `.claude/task-plan.md`
  - 将实施阶段状态更新为进行中。
- Modify: `.claude/task-log.md`
  - 记录实施计划已创建和后续关键实现决策。

---

### Task 1: Navigation Config

**Files:**
- Create: `apps/web/src/components/layout/nav-config.ts`
- Create: `apps/web/src/components/layout/nav-config.test.ts`

- [ ] **Step 1: Write the failing navigation config test**

Create `apps/web/src/components/layout/nav-config.test.ts`:

```ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  creativeNavItems,
  managementNavItems,
  isNavItemActive,
} from './nav-config'

describe('creativeNavItems', () => {
  test('使用项目内命名映射参考页主导航', () => {
    assert.deepEqual(
      creativeNavItems.map((item) => item.label),
      ['灵感', 'AI 生图', 'AI 视频', 'Toby Studio', '灵动画布', '资产']
    )
    assert.equal(creativeNavItems.find((item) => item.label === 'Toby Studio')?.href, '/toby-studio')
    assert.equal(creativeNavItems.find((item) => item.label === '灵动画布')?.href, '/canvas')
    assert.equal(creativeNavItems.find((item) => item.label === '资产')?.href, '/assets')
  })

  test('AI 视频提供快速生成和视频工坊两个子入口', () => {
    const video = creativeNavItems.find((item) => item.label === 'AI 视频')
    assert.equal(video?.href, '/generation?mode=video')
    assert.deepEqual(
      video?.children?.map((item) => [item.label, item.href]),
      [
        ['快速生成', '/generation?mode=video'],
        ['视频工坊', '/video-studio'],
      ]
    )
  })
})

describe('managementNavItems', () => {
  test('左侧管理栏不重复承载创作主入口', () => {
    assert.deepEqual(
      managementNavItems.map((item) => item.label),
      ['团队管理', 'A豆管理', '管理后台', '设置', '操作手册']
    )
  })
})

describe('isNavItemActive', () => {
  test('根路径只在首页高亮灵感', () => {
    assert.equal(isNavItemActive('/', '/'), true)
    assert.equal(isNavItemActive('/', '/assets'), false)
  })

  test('忽略 query 后匹配生成页', () => {
    assert.equal(isNavItemActive('/generation?mode=image', '/generation'), true)
    assert.equal(isNavItemActive('/generation?mode=video', '/generation'), true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @aigc/web exec tsx --test src/components/layout/nav-config.test.ts
```

Expected: FAIL with module resolution error for `./nav-config`.

- [ ] **Step 3: Create the navigation config**

Create `apps/web/src/components/layout/nav-config.ts`:

```ts
import {
  BookOpen,
  Coins,
  Images,
  LayoutDashboard,
  Palette,
  Settings,
  Shield,
  Sparkles,
  Users,
  Video,
  WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  description?: string
  requireTeamRole?: string
  requireUserRole?: string
  children?: Array<{
    href: string
    label: string
    description?: string
  }>
}

export const creativeNavItems: NavItem[] = [
  { href: '/', label: '灵感', icon: LayoutDashboard, description: '精选创作灵感' },
  { href: '/generation?mode=image', label: 'AI 生图', icon: Sparkles, description: '快速生成图片' },
  {
    href: '/generation?mode=video',
    label: 'AI 视频',
    icon: Video,
    description: '视频生成与项目创作',
    children: [
      { href: '/generation?mode=video', label: '快速生成', description: '单次 AI 视频生成' },
      { href: '/video-studio', label: '视频工坊', description: '项目式视频创作' },
    ],
  },
  { href: '/toby-studio', label: 'Toby Studio', icon: WandSparkles, description: '剧情与内容工作室' },
  { href: '/canvas', label: '灵动画布', icon: Palette, description: '画布编排与自由创作' },
  { href: '/assets', label: '资产', icon: Images, description: '管理创作素材' },
]

export const managementNavItems: NavItem[] = [
  { href: '/team', label: '团队管理', icon: Users, requireTeamRole: 'owner' },
  { href: '/credits', label: 'A豆管理', icon: Coins },
  { href: '/admin', label: '管理后台', icon: Shield, requireUserRole: 'admin' },
  { href: '/settings', label: '设置', icon: Settings },
  { href: '/docs', label: '操作手册', icon: BookOpen },
]

export function isNavItemActive(href: string, pathname: string) {
  const pathOnly = href.split('?')[0]
  if (pathOnly === '/') return pathname === '/'
  return pathname.startsWith(pathOnly)
}
```

- [ ] **Step 4: Run the navigation config test**

Run:

```bash
pnpm --filter @aigc/web exec tsx --test src/components/layout/nav-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/web/src/components/layout/nav-config.ts apps/web/src/components/layout/nav-config.test.ts
git commit -m "feat(web): add studio navigation config"
```

---

### Task 2: Top Creative Navigation

**Files:**
- Create: `apps/web/src/components/layout/creative-top-nav.tsx`
- Modify: `apps/web/src/components/layout/topbar.tsx`

- [ ] **Step 1: Create the desktop creative top navigation**

Create `apps/web/src/components/layout/creative-top-nav.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { creativeNavItems, isNavItemActive } from './nav-config'

export function CreativeTopNav() {
  const pathname = usePathname()

  return (
    <nav className="hidden min-w-0 items-center gap-1 md:flex" aria-label="创作主导航">
      {creativeNavItems.map((item) => {
        const active = isNavItemActive(item.href, pathname)
        const Icon = item.icon

        if (item.children?.length) {
          return (
            <DropdownMenu key={item.label}>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    active && 'bg-primary/10 text-primary'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {item.children.map((child) => (
                  <DropdownMenuItem key={child.href} asChild>
                    <Link href={child.href} className="flex flex-col items-start gap-0.5">
                      <span className="text-sm font-medium">{child.label}</span>
                      {child.description && (
                        <span className="text-xs text-muted-foreground">{child.description}</span>
                      )}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              active && 'bg-primary/10 text-primary'
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Integrate `CreativeTopNav` into `Topbar`**

Modify `apps/web/src/components/layout/topbar.tsx`:

```tsx
import { CreativeTopNav } from './creative-top-nav'
```

Replace the title block:

```tsx
{title && (
  <h1 className="text-lg font-semibold">{title}</h1>
)}
```

With:

```tsx
<div className="flex min-w-0 flex-1 items-center gap-4">
  {title ? <h1 className="text-lg font-semibold">{title}</h1> : <CreativeTopNav />}
</div>
```

Replace:

```tsx
<div className="ml-auto flex items-center gap-2">
```

With:

```tsx
<div className="flex shrink-0 items-center gap-2">
```

- [ ] **Step 3: Run static checks for top navigation labels**

Run:

```bash
rg -n "AI 片场|工作流" apps/web/src/components/layout apps/web/src/app/\(dashboard\)/page.tsx
rg -n "Toby Studio|灵动画布|AI 生图|AI 视频|资产" apps/web/src/components/layout
```

Expected:

- First command prints no matches from implementation files.
- Second command prints matches in `nav-config.ts` and rendered navigation components.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add apps/web/src/components/layout/creative-top-nav.tsx apps/web/src/components/layout/topbar.tsx
git commit -m "feat(web): add creative top navigation"
```

---

### Task 3: Management Sidebar And Mobile Navigation

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/components/layout/mobile-sidebar.tsx`

- [ ] **Step 1: Refactor desktop sidebar to management entries**

Modify imports in `apps/web/src/components/layout/sidebar.tsx`:

```tsx
import { managementNavItems, isNavItemActive } from './nav-config'
```

Remove local `NavItem`, `baseNavItems`, `roleNavItems`, and `bottomNavItems` definitions.

Replace visible item filtering with:

```tsx
const visibleManagementItems = managementNavItems.filter((item) => {
  if (item.requireUserRole && user?.role !== item.requireUserRole) return false
  if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
  return true
})
```

Replace active calculation in `renderNavItem` with:

```tsx
const isActive = isNavItemActive(item.href, pathname)
```

Replace navigation body with:

```tsx
<ScrollArea className="flex-1 py-4">
  <nav className="flex flex-col gap-1 px-2">
    <p className={cn('px-3 pb-2 text-xs font-medium text-muted-foreground', sidebarCollapsed && 'sr-only')}>
      管理
    </p>
    {visibleManagementItems.map(renderNavItem)}
  </nav>
</ScrollArea>
```

Keep `WorkspaceSwitcher`, `CreditsBadge`, and collapse button unchanged.

- [ ] **Step 2: Refactor mobile sidebar to include creative and management sections**

Modify imports in `apps/web/src/components/layout/mobile-sidebar.tsx`:

```tsx
import { creativeNavItems, managementNavItems, isNavItemActive } from './nav-config'
```

Remove local `NavItem`, `baseNavItems`, `roleNavItems`, and `bottomNavItems` definitions.

Add filtering:

```tsx
const visibleManagementItems = managementNavItems.filter((item) => {
  if (item.requireUserRole && user?.role !== item.requireUserRole) return false
  if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
  return true
})
```

Replace active calculation:

```tsx
const isActive = isNavItemActive(item.href, pathname)
```

Replace the mobile `<nav>` content with:

```tsx
<nav className="flex flex-col gap-1 px-2">
  <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">创作</p>
  {creativeNavItems.map(renderNavItem)}

  {visibleManagementItems.length > 0 && (
    <>
      <Separator className="my-2" />
      <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">管理</p>
      {visibleManagementItems.map(renderNavItem)}
    </>
  )}
</nav>
```

- [ ] **Step 3: Run static checks for sidebar duplication**

Run:

```bash
rg -n "创作生成|工作台|视频工坊|资产库" apps/web/src/components/layout/sidebar.tsx apps/web/src/components/layout/mobile-sidebar.tsx
rg -n "团队管理|A豆管理|管理后台|操作手册" apps/web/src/components/layout/sidebar.tsx apps/web/src/components/layout/nav-config.ts
```

Expected:

- First command prints no stale sidebar labels from the old desktop/sidebar config.
- Second command prints management labels from `nav-config.ts`.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add apps/web/src/components/layout/sidebar.tsx apps/web/src/components/layout/mobile-sidebar.tsx
git commit -m "feat(web): split management sidebar"
```

---

### Task 4: Creative Home Static Data

**Files:**
- Create: `apps/web/src/components/dashboard/creative-home-data.ts`
- Create: `apps/web/src/components/dashboard/creative-home-data.test.ts`

- [ ] **Step 1: Write the failing home data test**

Create `apps/web/src/components/dashboard/creative-home-data.test.ts`:

```ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { creativeEntryCards, inspirationItems } from './creative-home-data'

describe('creativeEntryCards', () => {
  test('首页展示四个创作主入口', () => {
    assert.deepEqual(
      creativeEntryCards.map((item) => item.title),
      ['AI 生图', 'AI 视频', 'Toby Studio', '灵动画布']
    )
  })

  test('AI 视频同时包含快速生成和视频工坊动作', () => {
    const video = creativeEntryCards.find((item) => item.title === 'AI 视频')
    assert.deepEqual(
      video?.actions.map((action) => [action.label, action.href]),
      [
        ['快速生成', '/generation?mode=video'],
        ['视频工坊', '/video-studio'],
      ]
    )
  })
})

describe('inspirationItems', () => {
  test('精选灵感首版只展示静态内容，不包含跳转目标', () => {
    assert.ok(inspirationItems.length >= 8)
    assert.equal(inspirationItems.some((item) => 'href' in item), false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @aigc/web exec tsx --test src/components/dashboard/creative-home-data.test.ts
```

Expected: FAIL with module resolution error for `./creative-home-data`.

- [ ] **Step 3: Create home static data**

Create `apps/web/src/components/dashboard/creative-home-data.ts`:

```ts
import {
  Clapperboard,
  ImageIcon,
  Palette,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface CreativeEntryAction {
  label: string
  href: string
}

export interface CreativeEntryCard {
  title: string
  description: string
  eyebrow: string
  icon: LucideIcon
  href: string
  actions: CreativeEntryAction[]
}

export interface InspirationItem {
  title: string
  category: string
  prompt: string
  heightClass: string
  toneClass: string
}

export const creativeEntryCards: CreativeEntryCard[] = [
  {
    title: 'AI 生图',
    eyebrow: 'Image',
    description: '输入创意描述，快速生成图片资产。',
    icon: ImageIcon,
    href: '/generation?mode=image',
    actions: [{ label: '开始生图', href: '/generation?mode=image' }],
  },
  {
    title: 'AI 视频',
    eyebrow: 'Video',
    description: '快速生成单条视频，或进入视频工坊进行项目式创作。',
    icon: Clapperboard,
    href: '/generation?mode=video',
    actions: [
      { label: '快速生成', href: '/generation?mode=video' },
      { label: '视频工坊', href: '/video-studio' },
    ],
  },
  {
    title: 'Toby Studio',
    eyebrow: 'Studio',
    description: '进入 Toby Studio，组织更完整的创作项目。',
    icon: WandSparkles,
    href: '/toby-studio',
    actions: [{ label: '进入 Studio', href: '/toby-studio' }],
  },
  {
    title: '灵动画布',
    eyebrow: 'Canvas',
    description: '在画布中编排素材、节点和创作流程。',
    icon: Palette,
    href: '/canvas',
    actions: [{ label: '打开画布', href: '/canvas' }],
  },
]

export const inspirationItems: InspirationItem[] = [
  {
    title: '未来城市晨光',
    category: '视觉设定',
    prompt: '玻璃幕墙城市、晨雾、柔和逆光、电影感构图',
    heightClass: 'h-56',
    toneClass: 'from-primary/20 via-background to-secondary/20',
  },
  {
    title: '产品广告短片',
    category: '视频灵感',
    prompt: '高级质感产品旋转展示、微距细节、干净背景',
    heightClass: 'h-72',
    toneClass: 'from-secondary/20 via-background to-primary/10',
  },
  {
    title: '童话角色海报',
    category: '角色设计',
    prompt: '温暖插画风、儿童故事主角、柔和色彩、细节丰富',
    heightClass: 'h-64',
    toneClass: 'from-accent via-background to-primary/20',
  },
  {
    title: '品牌视觉板',
    category: '灵动画布',
    prompt: '品牌关键词、色彩情绪、素材拼贴、布局实验',
    heightClass: 'h-80',
    toneClass: 'from-muted via-background to-secondary/20',
  },
  {
    title: '短剧分镜氛围',
    category: 'Toby Studio',
    prompt: '夜景街道、人物对话、镜头切换、叙事节奏',
    heightClass: 'h-60',
    toneClass: 'from-primary/10 via-background to-muted',
  },
  {
    title: '电商场景图',
    category: '商业素材',
    prompt: '自然光桌面、产品组合、真实摄影、清爽构图',
    heightClass: 'h-72',
    toneClass: 'from-secondary/10 via-background to-accent',
  },
  {
    title: '梦境风景',
    category: 'AI 生图',
    prompt: '超现实天空、漂浮岛屿、柔雾、细腻光影',
    heightClass: 'h-64',
    toneClass: 'from-primary/20 via-background to-muted',
  },
  {
    title: '社媒预告片',
    category: 'AI 视频',
    prompt: '快节奏转场、标题卡、动感镜头、竖屏构图',
    heightClass: 'h-56',
    toneClass: 'from-muted via-background to-primary/10',
  },
]

export const SparkleIcon = Sparkles
```

- [ ] **Step 4: Run the home data test**

Run:

```bash
pnpm --filter @aigc/web exec tsx --test src/components/dashboard/creative-home-data.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add apps/web/src/components/dashboard/creative-home-data.ts apps/web/src/components/dashboard/creative-home-data.test.ts
git commit -m "feat(web): add creative home data"
```

---

### Task 5: Creative Home Page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/page.tsx`

- [ ] **Step 1: Replace the dashboard page with the creative homepage**

Modify `apps/web/src/app/(dashboard)/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { creativeEntryCards, inspirationItems } from '@/components/dashboard/creative-home-data'

export default function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">灵感</p>
            <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">开始一次新的 AI 创作</h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            从图片、视频、Toby Studio 或灵动画布进入创作。精选灵感首版仅作展示，后续可接入精选作品数据。
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {creativeEntryCards.map((entry) => {
          const Icon = entry.icon
          return (
            <Card key={entry.title} className="overflow-hidden border-border/80 bg-card/95">
              <CardContent className="flex h-full flex-col gap-5 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg gradient-accent">
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    {entry.eyebrow}
                  </span>
                </div>

                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">{entry.title}</h2>
                  <p className="min-h-[48px] text-sm leading-6 text-muted-foreground">{entry.description}</p>
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  {entry.actions.map((action, index) => (
                    <Button
                      key={action.href}
                      asChild
                      size="sm"
                      variant={index === 0 ? 'gradient' : 'outline'}
                      className="gap-1.5"
                    >
                      <Link href={action.href}>
                        {action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">精选灵感</h2>
            <p className="text-sm text-muted-foreground">静态瀑布流展示，暂不绑定点击行为。</p>
          </div>
          <Sparkles className="h-5 w-5 text-primary" />
        </div>

        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
          {inspirationItems.map((item) => (
            <article
              key={`${item.category}-${item.title}`}
              className="mb-4 break-inside-avoid overflow-hidden rounded-lg border bg-card"
            >
              <div className={`flex ${item.heightClass} bg-gradient-to-br ${item.toneClass} p-4`}>
                <div className="mt-auto rounded-lg bg-background/85 p-3 shadow-sm backdrop-blur">
                  <p className="text-xs font-medium text-primary">{item.category}</p>
                  <h3 className="mt-1 text-sm font-semibold">{item.title}</h3>
                </div>
              </div>
              <div className="p-4">
                <p className="text-sm leading-6 text-muted-foreground">{item.prompt}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Run static checks for homepage scope**

Run:

```bash
rg -n "StatsCards|RecentBatches|QuickGenerate|useBatches|useSWR" apps/web/src/app/\(dashboard\)/page.tsx
rg -n "做同款|href=.*inspiration|AI 片场|工作流" apps/web/src/app/\(dashboard\)/page.tsx apps/web/src/components/dashboard/creative-home-data.ts
```

Expected:

- First command prints no matches, because the new homepage does not fetch dashboard stats or recent batches.
- Second command prints no matches, because the current selected feed is display-only and uses project names.

- [ ] **Step 3: Commit Task 5**

Run:

```bash
git add apps/web/src/app/\(dashboard\)/page.tsx
git commit -m "feat(web): redesign dashboard home"
```

---

### Task 6: Final Static Verification And Task Records

**Files:**
- Modify: `.claude/task-plan.md`
- Modify: `.claude/task-log.md`

- [ ] **Step 1: Run focused static verification**

Run:

```bash
pnpm --filter @aigc/web exec tsx --test src/components/layout/nav-config.test.ts src/components/dashboard/creative-home-data.test.ts
rg -n "AI 片场|工作流" apps/web/src/components/layout apps/web/src/components/dashboard apps/web/src/app/\(dashboard\)/page.tsx
rg -n "Toby Studio|灵动画布|AI 生图|AI 视频|精选灵感" apps/web/src/components/layout apps/web/src/components/dashboard apps/web/src/app/\(dashboard\)/page.tsx
git status --short
```

Expected:

- Test command PASS.
- First `rg` command prints no implementation matches for forbidden UI wording.
- Second `rg` command prints the expected project names.
- `git status --short` only shows `.claude` local notes if they are ignored, or no tracked changes if commits are complete.

- [ ] **Step 2: Update local task records**

Modify `.claude/task-plan.md` implementation status:

```md
## 阶段

1. 已完成：创建隔离 worktree。
2. 已完成：查看外部参考页和本地参考 HTML。
3. 已完成：澄清核心需求。
4. 已完成：沉淀设计文档。
5. 已完成：用户审核设计。
6. 已完成：编写实施计划。
7. 已完成：按计划小步实现。
```

Append to `.claude/task-log.md`:

```md
- 创建顶部创作主导航配置，并将 AI 片场映射为 Toby Studio、工作流映射为灵动画布。
- 将左侧栏调整为管理入口，创作入口迁移到顶部主导航。
- 将首页调整为四个创作入口和精选静态瀑布流。
- 完成静态验证：不展示 AI 片场/工作流界面文案，不新增接口和数据库表。
```

- [ ] **Step 3: Final git status**

Run:

```bash
git status --short
```

Expected: no tracked changes. `.claude` can remain ignored local state.

---

## Self-Review

- Spec coverage:
  - 顶部创作主导航：Task 1、Task 2。
  - 左侧管理栏：Task 3。
  - 首页四个创作入口：Task 4、Task 5。
  - AI 视频双入口：Task 1、Task 4、Task 5。
  - Toby Studio 和灵动画布映射：Task 1、Task 4、Task 6。
  - 精选静态瀑布流展示：Task 4、Task 5。
  - 不新增接口、数据库、seed、prompt 预填：Task 5、Task 6 静态检查覆盖。
  - 不构建、不刷新、不重启 `localhost:6006`：所有验证命令均为 node:test 和 `rg`，没有 dev server、build 或 browser preview。
- Placeholder scan:
  - 本计划不包含未完成占位语句。
- Type consistency:
  - `NavItem`、`CreativeEntryCard`、`InspirationItem` 在定义和使用处名称一致。
  - `isNavItemActive(href, pathname)` 在 `CreativeTopNav`、`Sidebar`、`MobileSidebar` 的调用顺序一致。
