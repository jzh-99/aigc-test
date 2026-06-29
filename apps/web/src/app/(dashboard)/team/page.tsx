'use client'

import { useAuthStore } from '@/stores/auth-store'
import { MemberList } from '@/components/team/member-list'
import { WorkspaceList } from '@/components/team/workspace-list'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { TeamCreditsSettings } from '@/components/team/team-credits-settings'
import { SettingsManagementNav } from '@/components/layout/settings-management-nav'

function TeamPageContent() {
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeBizMgmtMember = useAuthStore((s) => s.activeBizMgmtMember())
  const searchParams = useSearchParams()

  // 团队管理权限 = 当前业管选中身份为公司主卡（userType=2 且 isMaster）。
  // 与后端 create-member 路由门控、左侧管理导航门控信号一致。
  // 不用 team_members.role：历史遗留 role 可能滞后于业管 master 真实值。
  const isOwner =
    activeBizMgmtMember?.userType === '2' &&
    (activeBizMgmtMember.isMaster ?? activeBizMgmtMember.is_master)

  type TabKey = 'members' | 'workspaces' | 'credits'
  const [activeTab, setActiveTab] = useState<TabKey>('members')

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'credits' && isOwner) setActiveTab('credits')
  }, [searchParams, isOwner])

  const tabs = [
    { key: 'members' as TabKey, label: '成员管理' },
    { key: 'workspaces' as TabKey, label: '工作区管理' },
    ...(isOwner ? [{ key: 'credits' as TabKey, label: 'A豆设置' }] : []),
  ]

  if (!activeTeamId) {
    return <div className="p-6 text-muted-foreground">请先选择一个团队</div>
  }

  // 防绕过：导航已对非主卡隐藏本页，直接输 URL 进入时显示无权限提示而非管理界面。
  if (!isOwner) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">团队管理</h1>
          <p className="text-muted-foreground">管理团队成员、配额和工作区</p>
        </div>

        <SettingsManagementNav showBack />

        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-medium">无权限访问</p>
          <p className="text-sm text-muted-foreground mt-2">
            仅公司主卡可管理团队，请切换到公司主卡身份后重试
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">团队管理</h1>
        <p className="text-muted-foreground">管理团队成员、配额和工作区</p>
      </div>

      <SettingsManagementNav showBack />

      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'members' && <MemberList teamId={activeTeamId} />}
      {activeTab === 'workspaces' && <WorkspaceList teamId={activeTeamId} />}
      {activeTab === 'credits' && isOwner && <TeamCreditsSettings teamId={activeTeamId} />}
    </div>
  )
}

export default function TeamPage() {
  return (
    <Suspense>
      <TeamPageContent />
    </Suspense>
  )
}
