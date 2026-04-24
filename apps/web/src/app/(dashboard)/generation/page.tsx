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
import { apiGet } from '@/lib/api-client'
import { ApiError } from '@/lib/api-client'
import { AlertTriangle, FolderX, EyeOff } from 'lucide-react'
import useSWR, { mutate } from 'swr'
import type { BatchResponse } from '@aigc/types'
import { useHiddenBatches } from '@/hooks/use-batches'
import { Button } from '@/components/ui/button'

interface TeamMember {
  user_id: string
  credit_quota: number | null
  credit_used: number
}

interface TeamInfo {
  credits: { balance: number }
  members: TeamMember[]
}

const POLL_INTERVAL_MS = 3000
const VIDEO_POLL_INTERVAL_MS = 5000 // Videos take minutes; 5s polling is sufficient

function isTerminalStatus(status: string) {
  return status === 'completed' || status === 'failed' || status === 'partial_complete'
}

export default function ImagePage() {
  const searchParams = useSearchParams()
  const _mode = searchParams.get('mode')
  const initialMode = (_mode === 'video' ? 'video' : _mode === 'avatar' ? 'avatar' : _mode === 'action_imitation' ? 'action_imitation' : 'image') as 'image' | 'video' | 'avatar' | 'action_imitation'
  const batchListRef = useRef<BatchListHandle>(null)

  const [activeBatchCount, setActiveBatchCount] = useState(0)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const { batches: hiddenBatches } = useHiddenBatches(true)
  const hasHidden = hiddenBatches.length > 0

  // Map<batchId, intervalId> — each batch polled independently
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

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

  // Clear all polls when workspace changes
  useEffect(() => {
    pollTimersRef.current.forEach(clearInterval)
    pollTimersRef.current.clear()
    setActiveBatchCount(0)
  }, [activeWorkspaceId])

  // Clear all polls on unmount
  useEffect(() => {
    const timers = pollTimersRef.current
    return () => { timers.forEach(clearInterval); timers.clear() }
  }, [])

  const stopPolling = useCallback((batchId: string) => {
    const timer = pollTimersRef.current.get(batchId)
    if (timer !== undefined) {
      clearInterval(timer)
      pollTimersRef.current.delete(batchId)
    }
    setActiveBatchCount((c) => Math.max(0, c - 1))
  }, [])

  const pollOnce = useCallback(async (batchId: string) => {
    try {
      const updated = await apiGet<BatchResponse>(`/batches/${batchId}`)
      console.log('[Poll]', batchId, updated.status, updated.completed_count, '/', updated.quantity)
      batchListRef.current?.update(updated)

      if (isTerminalStatus(updated.status)) {
        stopPolling(batchId)
        // Short delay so the API has time to populate thumbnail_urls
        setTimeout(() => { batchListRef.current?.refresh() }, 800)
        // Refresh credit balance after task completes (credits confirmed/refunded)
        if (activeTeamIdRef.current) mutate(`/teams/${activeTeamIdRef.current}`)
      }
    } catch (err) {
      // 429: rate limited — skip this cycle, retry on next interval
      if (err instanceof ApiError && err.status === 429) {
        console.warn('[Poll] Rate limited for batch', batchId, '- retrying next cycle')
        return
      }
      console.error('[Poll] Error fetching batch', batchId, err)
      stopPolling(batchId)
    }
  }, [stopPolling])

  const startPolling = useCallback((batchId: string, intervalMs = POLL_INTERVAL_MS) => {
    // Avoid duplicate polling for the same batch
    if (pollTimersRef.current.has(batchId)) return

    // Stagger start by up to 1.5s so concurrent batches don't all fire at once
    const jitter = Math.floor(Math.random() * 1500)
    const startTimer = setTimeout(() => {
      if (!pollTimersRef.current.has(batchId)) return // stopped during jitter window
      const timer = setInterval(() => pollOnce(batchId), intervalMs)
      pollTimersRef.current.set(batchId, timer)
      pollOnce(batchId) // fire immediately after jitter
    }, jitter)
    pollTimersRef.current.set(batchId, startTimer)
  }, [pollOnce])

  // When tab becomes visible again, immediately poll all active batches
  // (browser throttles setInterval to ~1 min in background tabs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        for (const batchId of pollTimersRef.current.keys()) {
          pollOnce(batchId)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [pollOnce])

  const handleBatchCreated = useCallback((batch: BatchResponse) => {
    batchListRef.current?.prepend(batch)
    setActiveBatchCount((c) => c + 1)
    const intervalMs = ((batch as any).module === 'video' || (batch as any).module === 'avatar' || (batch as any).module === 'action_imitation') ? VIDEO_POLL_INTERVAL_MS : POLL_INTERVAL_MS
    startPolling(batch.id, intervalMs)
    // Refresh credit balance immediately after submission (credits are frozen)
    if (activeTeamId) mutate(`/teams/${activeTeamId}`)
  }, [startPolling, activeTeamId])

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
              <span>历史记录</span>
              {activeBatchCount > 0 && (
                <Badge variant="processing" className="text-xs">生成中 ({activeBatchCount})</Badge>
              )}
              {hasHidden && (
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
            <BatchList
              ref={batchListRef}
              onSelect={(batch) => { setSelectedBatchId(batch.id); setDetailOpen(true) }}
            />
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
