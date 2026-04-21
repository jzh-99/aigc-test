'use client'

import { useAuthStore } from '@/stores/auth-store'
import { MemberList } from '@/components/team/member-list'
import { WorkspaceList } from '@/components/team/workspace-list'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { TeamCreditsSettings } from '@/components/team/team-credits-settings'

export default function TeamPage() {
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const isOwner = activeTeam?.role === 'owner'

  type TabKey = 'members' | 'workspaces' | 'credits'
  const [activeTab, setActiveTab] = useState<TabKey>('members')

  const tabs = [
    { key: 'members' as TabKey, label: '成员管理' },
    { key: 'workspaces' as TabKey, label: '工作区管理' },
    ...(isOwner ? [{ key: 'credits' as TabKey, label: '积分设置' }] : []),
  ]

  if (!activeTeamId) {
    return <div className="p-6 text-muted-foreground">请先选择一个团队</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">团队管理</h1>
        <p className="text-muted-foreground">管理团队成员、配额和工作区</p>
      </div>

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
