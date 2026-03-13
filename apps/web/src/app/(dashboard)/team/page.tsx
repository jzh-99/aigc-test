'use client'

import { useAuthStore } from '@/stores/auth-store'
import { MemberList } from '@/components/team/member-list'
import { WorkspaceList } from '@/components/team/workspace-list'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const tabs = [
  { key: 'members', label: '成员管理' },
  { key: 'workspaces', label: '工作区管理' },
] as const

export default function TeamPage() {
  const [activeTab, setActiveTab] = useState<'members' | 'workspaces'>('members')
  const activeTeamId = useAuthStore((s) => s.activeTeamId)

  if (!activeTeamId) {
    return <div className="p-6 text-muted-foreground">请先选择一个团队</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">团队管理</h1>
        <p className="text-muted-foreground">管理团队成员、配额和工作区</p>
      </div>

      {/* Tab navigation */}
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
    </div>
  )
}
