'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { GenerationPanel } from '@/components/generation/generation-panel'
import { BatchList, type BatchListHandle } from '@/components/history/batch-list'
import { BatchDetail } from '@/components/history/batch-detail'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { AlertTriangle, FolderX } from 'lucide-react'
import useSWR from 'swr'
import type { BatchResponse } from '@aigc/types'

interface TeamMember {
  user_id: string
  credit_quota: number | null
  credit_used: number
}

interface TeamInfo {
  credits: { balance: number }
  members: TeamMember[]
}

export default function ImagePage() {
  const batchListRef = useRef<BatchListHandle>(null)

  const [activeBatchCount, setActiveBatchCount] = useState(0)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // Each batch gets its own AbortController — independent of other batches
  const sseControllersRef = useRef<Map<string, AbortController>>(new Map())

  const resetGeneration = useGenerationStore((s) => s.reset)
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const { data: teamData } = useSWR<TeamInfo>(activeTeamId ? `/teams/${activeTeamId}` : null)

  useEffect(() => {
    return () => { resetGeneration() }
  }, [resetGeneration])

  useEffect(() => {
    setActiveBatchCount(0)
    sseControllersRef.current.forEach((c) => c.abort())
    sseControllersRef.current.clear()
  }, [activeWorkspaceId])

  // Abort all connections on unmount
  useEffect(() => {
    const controllers = sseControllersRef.current
    return () => { controllers.forEach((c) => c.abort()) }
  }, [])

  const handleBatchCreated = useCallback((batch: BatchResponse) => {
    batchListRef.current?.prepend(batch)
    setActiveBatchCount((c) => c + 1)

    const controller = new AbortController()
    sseControllersRef.current.set(batch.id, controller)

    ;(async () => {
      try {
        const { useAuthStore } = await import('@/stores/auth-store')
        const token = useAuthStore.getState().accessToken
        const headers: Record<string, string> = {}
        if (token) headers['Authorization'] = `Bearer ${token}`

        const res = await fetch(`/api/v1/sse/batches/${batch.id}`, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          sseControllersRef.current.delete(batch.id)
          setActiveBatchCount((c) => Math.max(0, c - 1))
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          let eventName = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim()
            } else if (line.startsWith('data:') && eventName === 'batch_update') {
              try {
                const updated: BatchResponse = JSON.parse(line.slice(5).trim())
                console.log('[SSE] batch_update:', updated.id, updated.status, updated.completed_count)
                batchListRef.current?.update(updated)

                const isTerminal =
                  updated.status === 'completed' ||
                  updated.status === 'failed' ||
                  updated.status === 'partial_complete'

                if (isTerminal) {
                  // SSE data is authoritative; refresh after a short delay to fetch
                  // API-enriched fields (e.g. thumbnail_urls) without race conditions
                  setTimeout(() => { batchListRef.current?.refresh() }, 1500)
                  sseControllersRef.current.delete(batch.id)
                  setActiveBatchCount((c) => Math.max(0, c - 1))
                  return
                }
              } catch {
                // ignore malformed JSON
              }
              eventName = ''
            } else if (line === '') {
              eventName = ''
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('[SSE] Error for batch', batch.id, err)
      } finally {
        sseControllersRef.current.delete(batch.id)
      }
    })()
  }, [])

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
          <GenerationPanel onBatchCreated={handleBatchCreated} disabled={noWorkspace} />
        </div>
      </div>

      {/* Right column — History */}
      <div className="flex-1 min-h-[400px] flex flex-col">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <span>历史记录</span>
              {activeBatchCount > 0 && (
                <Badge variant="processing" className="text-xs">生成中 ({activeBatchCount})</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
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
