'use client'

import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { TeamTable } from '@/components/admin/team-table'
import { CreateTeamForm } from '@/components/admin/create-team-form'
import { UserTable } from '@/components/admin/user-table'
import { cn } from '@/lib/utils'

const tabs = [
  { key: 'teams', label: '团队列表' },
  { key: 'create', label: '创建团队' },
  { key: 'users', label: '用户列表' },
] as const

type TabKey = typeof tabs[number]['key']

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('teams')
  const user = useAuthStore((s) => s.user)

  if (user?.role !== 'admin') {
    return <div className="p-6 text-muted-foreground">无权访问管理后台</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">管理后台</h1>
        <p className="text-muted-foreground">管理所有团队、用户和积分</p>
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

      {activeTab === 'teams' && <TeamTable />}
      {activeTab === 'create' && <CreateTeamForm onCreated={() => setActiveTab('teams')} />}
      {activeTab === 'users' && <UserTable />}
    </div>
  )
}
