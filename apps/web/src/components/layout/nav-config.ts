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
  // 仅当前业管选中身份为公司主卡（userType=2 且 isMaster）时可见。
  // 与后端 create-member 路由门控信号一致，避免 team_members.role 历史遗留导致误显。
  requireBizMgmtMaster?: boolean
  children?: Array<{
    href: string
    label: string
    description?: string
    feature?: 'videoStudio'
  }>
}

export const creativeNavItems: NavItem[] = [
  { href: '/', label: '灵感', icon: LayoutDashboard, description: '精选创作灵感' },
  {
    href: '/generation?mode=image',
    label: '创作',
    icon: Sparkles,
    description: 'AI生图、生视频',
    children: [
      { href: '/generation?mode=image', label: 'AI 生图', description: '快速生成图片' },
      { href: '/generation?mode=video', label: 'AI 视频', description: '单次 AI 视频生成' },
    ],
  },
  { href: '/toby-studio', label: 'Toby Studio', icon: WandSparkles, description: '剧情与内容工作室' },
  { href: '/canvas', label: '灵动画布', icon: Palette, description: '画布编排与自由创作' },
  { href: '/assets', label: '资产', icon: Images, description: '管理创作素材' },
]

export const managementNavItems: NavItem[] = [
  { href: '/team', label: '团队管理', icon: Users, requireBizMgmtMaster: true },
  // A 豆管理对普通成员可见：查看余额/流水是只读操作，普通成员（副卡）需要看自己的 A 豆消费记录。
  // 页面内的「团队成员管理」入口、「充值」按钮才用 isOwner 限制为公司主卡。
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
