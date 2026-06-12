'use client'

import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { GenerationPanel } from '@/components/generation/generation-panel'
import { BatchList, type BatchListHandle } from '@/components/history/batch-list'
import { BatchDetail } from '@/components/history/batch-detail'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { AlertTriangle, FolderX } from 'lucide-react'
import useSWR, { mutate } from 'swr'
import type { BatchResponse } from '@aigc/types'
import { useBatches } from '@/hooks/use-batches'
import { useBatchSSE } from '@/hooks/use-batch-sse'
import { Button } from '@/components/ui/button'
import { AssetsLibraryTab } from '@/components/generation/assets-library-tab'
import { cn } from '@/lib/utils'

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

function ImagePageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const _mode = searchParams.get('mode')
  const initialMode = (_mode === 'video' ? 'video' : _mode === 'avatar' ? 'avatar' : _mode === 'action_imitation' ? 'action_imitation' : 'image') as 'image' | 'video' | 'avatar' | 'action_imitation'
  const batchListRef = useRef<BatchListHandle>(null)

  // 从 URL 读取 prompt / model 参数，写入 generation store（灵感页「做同款」跳转场景）
  const { setPrompt, setModelType } = useGenerationStore()
  const promptParam = searchParams.get('prompt')
  const modelParam = searchParams.get('model')
  useEffect(() => {
    if (promptParam) setPrompt(promptParam)
    if (modelParam) setModelType(modelParam)
    // 清除 URL 中的 prompt/model 参数，避免刷新时重复写入
    if (promptParam || modelParam) {
      router.replace('/generation?mode=image', { scroll: false })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 当前正在进行中的 batch ID 集合，用于挂载 SSE 订阅
  const [activeBatchIds, setActiveBatchIds] = useState<Set<string>>(new Set())
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [rightTab, setRightTab] = useState<'history' | 'assets'>('history')
  const { batches } = useBatches('generation')

  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const activeTeamIdRef = useRef(activeTeamId)
  const hasInitiallyLoadedBatches = useRef(false)
  useEffect(() => { activeTeamIdRef.current = activeTeamId }, [activeTeamId])
  const { data: teamData } = useSWR<TeamInfo>(isInitialized && activeTeamId ? `/teams/${activeTeamId}` : null)

  // 切换工作区时清空所有活跃订阅
  useEffect(() => {
    setActiveBatchIds(new Set())
    hasInitiallyLoadedBatches.current = false
  }, [activeWorkspaceId])

  // 从 batches 中筛选出正在进行中的任务并自动订阅 SSE
  useEffect(() => {
    if (!activeWorkspaceId) return

    if (batches.length > 0) {
      hasInitiallyLoadedBatches.current = true
    }

    if (!hasInitiallyLoadedBatches.current) return

    const activeIds = new Set<string>()
    for (const batch of batches) {
      if (!isTerminalStatus(batch.status)) {
        activeIds.add(batch.id)
      }
    }

    setActiveBatchIds((prev) => {
      if (activeIds.size === 0 && prev.size === 0) return prev
      if (activeIds.size === prev.size && [...activeIds].every(id => prev.has(id))) return prev
      return activeIds
    })
  }, [activeWorkspaceId, batches.length])

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
    // 任务结束后刷新A豆余额（A豆已确认扣除或退还）
    if (activeTeamIdRef.current) mutate(`/teams/${activeTeamIdRef.current}`)
  }, [])

  const handleBatchCreated = useCallback((batch: BatchResponse) => {
    batchListRef.current?.prepend(batch)
    setActiveBatchIds((prev) => new Set(prev).add(batch.id))
    // 提交后立即刷新A豆（A豆已冻结）
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
    <div className="generation-dream-page -m-4 flex h-[calc(100%+2rem)] flex-col gap-6 p-5 md:-m-6 md:h-[calc(100%+3rem)] md:p-7 lg:flex-row">
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
      <div className="generation-dream-left w-full shrink-0 flex flex-col lg:w-[400px]">
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
                ? 'A豆余额不足，请充值后再继续生成。'
                : '你的可用A豆已耗尽，请联系团队负责人增加你的A豆配额。'
              }
            </AlertDescription>
          </Alert>
        )}

        <div className="flex-1 flex flex-col min-h-0">
          <GenerationPanel onBatchCreated={handleBatchCreated} disabled={noWorkspace} initialMode={initialMode} />
        </div>
      </div>

      {/* Right column — History */}
      <div className="generation-dream-right flex-1 min-h-[400px] flex flex-col min-w-0 max-w-full">
        <Card className="generation-dream-stage flex-1 flex flex-col overflow-hidden">
          <CardHeader className="shrink-0 px-6 pb-4 pt-6">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="generation-dream-segmented flex rounded-full border p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('h-8 rounded-full px-4 text-xs', rightTab === 'history' ? 'generation-dream-pill-active' : 'generation-dream-pill')}
                  onClick={() => setRightTab('history')}
                >
                  历史记录
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('h-8 rounded-full px-4 text-xs', rightTab === 'assets' ? 'generation-dream-pill-active' : 'generation-dream-pill')}
                  onClick={() => setRightTab('assets')}
                >
                  资产库
                </Button>
              </div>
              {activeBatchIds.size > 0 && rightTab === 'history' && (
                <Badge variant="processing" className="text-xs">生成中 ({activeBatchIds.size})</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="generation-dream-stage-content flex-1 overflow-y-auto min-w-0 px-6 pb-6">
            {rightTab === 'history' ? (
              <BatchList
                ref={batchListRef}
                onSelect={(batch) => { setSelectedBatchId(batch.id); setDetailOpen(true) }}
                onBatchCreated={handleBatchCreated}
              />
            ) : (
              <AssetsLibraryTab
                onSelectBatch={(batchId) => {
                  setSelectedBatchId(batchId)
                  setDetailOpen(true)
                }}
              />
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

export default function GenerationPage() {
  return (
    <Suspense>
      <ImagePageContent />
    </Suspense>
  )
}
