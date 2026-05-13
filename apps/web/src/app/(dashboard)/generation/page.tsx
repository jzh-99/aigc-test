'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { GenerationPanel } from '@/components/generation/generation-panel'
import { BatchList, type BatchListHandle } from '@/components/history/batch-list'
import { BatchDetail } from '@/components/history/batch-detail'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { AlertTriangle, FolderX, EyeOff } from 'lucide-react'
import useSWR, { mutate } from 'swr'
import type { BatchResponse } from '@aigc/types'
import { useHiddenBatches } from '@/hooks/use-batches'
import { useBatchSSE } from '@/hooks/use-batch-sse'
import { Button } from '@/components/ui/button'
import { AssetsLibraryTab } from '@/components/generation/assets-library-tab'

interface TeamMember {
  user_id: string
  credit_quota: number | null
  credit_used: number
}

interface TeamInfo {
  credits: { balance: number }
  members: TeamMember[]
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'partial_complete'
}

/** 单个 batch 的 SSE 订阅组件，hooks 不能在循环里调用，用组件隔离 */
interface BatchSSEWatcherProps {
  batchId: string
  onUpdate: (batch: BatchResponse) => void
  onTerminal: (batchId: string, batch: BatchResponse) => void
}

function BatchSSEWatcher({ batchId, onUpdate, onTerminal }: BatchSSEWatcherProps) {
  const onTerminalRef = useRef(onTerminal)
  onTerminalRef.current = onTerminal

  const handleUpdate = useCallback((batch: BatchResponse) => {
    onUpdate(batch)
    if (isTerminalStatus(batch.status)) {
      onTerminalRef.current(batchId, batch)
    }
  }, [batchId, onUpdate])

  useBatchSSE({ batchId, onUpdate: handleUpdate })
  return null
}

export default function ImagePage() {
  const searchParams = useSearchParams()
  const _mode = searchParams.get('mode')
  const initialMode = (_mode === 'video' ? 'video' : _mode === 'avatar' ? 'avatar' : _mode === 'action_imitation' ? 'action_imitation' : 'image') as 'image' | 'video' | 'avatar' | 'action_imitation'
  const batchListRef = useRef<BatchListHandle>(null)

  // 当前正在进行中的 batch ID 集合，用于挂载 SSE 订阅
  const [activeBatchIds, setActiveBatchIds] = useState<Set<string>>(new Set())
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [rightTab, setRightTab] = useState<'history' | 'assets'>('history')
  const { batches: hiddenBatches } = useHiddenBatches(true)
  const hasHidden = hiddenBatches.length > 0

  const resetGeneration = useGenerationStore((s) => s.reset)
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeTeamIdRef = useRef(activeTeamId)
  useEffect(() => { activeTeamIdRef.current = activeTeamId }, [activeTeamId])
  const { data: teamData } = useSWR<TeamInfo>(activeTeamId ? `/teams/${activeTeamId}` : null)

  useEffect(() => {
    return () => { resetGeneration() }
  }, [resetGeneration])

  // 切换工作区时清空所有活跃订阅
  useEffect(() => {
    setActiveBatchIds(new Set())
  }, [activeWorkspaceId])

  const handleBatchUpdate = useCallback((batch: BatchResponse) => {
    batchListRef.current?.update(batch)
  }, [])

  const handleBatchTerminal = useCallback((batchId: string, batch: BatchResponse) => {
    setActiveBatchIds((prev) => {
      const next = new Set(prev)
      next.delete(batchId)
      return next
    })
    // 刷新列表以获取最终状态（含资产 URL）
    batchListRef.current?.update(batch)
    batchListRef.current?.refresh()
    setTimeout(() => { batchListRef.current?.refresh() }, 800)
    // 任务结束后刷新积分余额（积分已确认扣除或退还）
    if (activeTeamIdRef.current) mutate(`/teams/${activeTeamIdRef.current}`)
  }, [])

  const handleBatchCreated = useCallback((batch: BatchResponse) => {
    batchListRef.current?.prepend(batch)
    setActiveBatchIds((prev) => new Set(prev).add(batch.id))
    // 提交后立即刷新积分（积分已冻结）
    if (activeTeamId) mutate(`/teams/${activeTeamId}`)
  }, [activeTeamId])

  const teamRole = activeTeam()?.role
  const isOwnerOrAdmin = teamRole === 'owner' || user?.role === 'admin'
  const noWorkspace = !activeWorkspaceId

  let lowCredits = false
  if (!isOwnerOrAdmin && teamData) {
    const me = teamData.members?.find((m) => m.user_id === user?.id)
    if (me && me.credit_quota !== null && me.credit_quota !== undefined) {
      const remaining = me.credit_quota - (me.credit_used ?? 0)
      if (remaining <= 0) lowCredits = true
    } else if (teamData.credits.balance <= 0) {
      lowCredits = true
    }
  }
  if (isOwnerOrAdmin && teamData && teamData.credits.balance <= 0) {
    lowCredits = true
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* 为每个活跃 batch 挂载 SSE 订阅，组件不渲染任何 DOM */}
      {Array.from(activeBatchIds).map((id) => (
        <BatchSSEWatcher
          key={id}
          batchId={id}
          onUpdate={handleBatchUpdate}
          onTerminal={handleBatchTerminal}
        />
      ))}

      {/* Left column — Generation Panel */}
      <div className="w-full lg:w-[400px] shrink-0 flex flex-col">
        {noWorkspace && (
          <Alert variant="destructive" className="mb-4">
            <FolderX className="h-4 w-4" />
            <AlertDescription>
              {isOwnerOrAdmin
                ? '当前没有可用的工作区。请前往团队管理创建工作区并分配成员。'
                : '你还没有被分配到任何工作区，请联系团队负责人为你分配工作区后再进行创作。'
              }
            </AlertDescription>
          </Alert>
        )}

        {lowCredits && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {isOwnerOrAdmin
                ? '团队积分余额不足，请充值后再继续生成。'
                : '你的可用积分已耗尽，请联系团队负责人增加你的积分配额。'
              }
            </AlertDescription>
          </Alert>
        )}

        <div className="flex-1 flex flex-col min-h-0">
          <GenerationPanel onBatchCreated={handleBatchCreated} disabled={noWorkspace} initialMode={initialMode} />
        </div>
      </div>

      {/* Right column — History */}
      <div className="flex-1 min-h-[400px] flex flex-col min-w-0 max-w-full">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="flex rounded-lg border p-1">
                <Button
                  variant={rightTab === 'history' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setRightTab('history')}
                >
                  历史记录
                </Button>
                <Button
                  variant={rightTab === 'assets' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setRightTab('assets')}
                >
                  资产库
                </Button>
              </div>
              {activeBatchIds.size > 0 && rightTab === 'history' && (
                <Badge variant="processing" className="text-xs">生成中 ({activeBatchIds.size})</Badge>
              )}
              {hasHidden && rightTab === 'history' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs text-muted-foreground gap-1"
                  onClick={() => batchListRef.current?.openHiddenDrawer()}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  已隐藏
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto min-w-0">
            {rightTab === 'history' ? (
              <BatchList
                ref={batchListRef}
                onSelect={(batch) => { setSelectedBatchId(batch.id); setDetailOpen(true) }}
              />
            ) : (
              <AssetsLibraryTab />
            )}
          </CardContent>
        </Card>
      </div>

      <BatchDetail
        batchId={selectedBatchId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}
