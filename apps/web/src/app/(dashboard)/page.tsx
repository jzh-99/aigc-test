'use client'

import { StatsCards } from '@/components/dashboard/stats-cards'
import { RecentBatches } from '@/components/dashboard/recent-batches'
import { QuickGenerate } from '@/components/dashboard/quick-generate'

export default function DashboardPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">工作台</h2>

      <StatsCards />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h3 className="text-base font-medium mb-3">最近生成</h3>
          <RecentBatches />
        </div>
        <div>
          <h3 className="text-base font-medium mb-3">快速入口</h3>
          <QuickGenerate />
        </div>
      </div>
    </div>
  )
}
