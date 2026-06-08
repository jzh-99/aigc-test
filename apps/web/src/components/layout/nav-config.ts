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

export function isNavItemActive(href: string, currentPath: string) {
  const [pathOnly, queryString = ''] = href.split('?')
  const [pathname, currentQueryString = ''] = currentPath.split('?')

  if (queryString) {
    if (pathname !== pathOnly) return false

    const hrefParams = new URLSearchParams(queryString)
    const currentParams = new URLSearchParams(currentQueryString)

    for (const [key, value] of hrefParams) {
      if (currentParams.get(key) !== value) return false
    }

    return true
  }

  if (pathOnly === '/') return pathname === '/'
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`)
}
