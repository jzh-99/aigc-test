'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, Bot, CheckCircle2 } from 'lucide-react'

interface FailedTask {
  task_id: string
  batch_id: string
  error_message: string | null
  task_status: string
  retry_count: number
  module: string
  provider: string
  model: string
  prompt: string
  source: 'canvas' | 'generation'
  canvas_id: string | null
  submitted_at: string
  completed_at: string | null
}

interface AiError {
  id: string
  http_status: number | null
  error_detail: string | null
  created_at: string
}

interface DiagnosisData {
  user: { id: string; username: string; account: string; status: string }
  failed_tasks: FailedTask[]
  ai_assistant_errors: AiError[]
}

interface Props {
  userId: string | null
  username: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserDiagnosisSheet({ userId, username, open, onOpenChange }: Props) {
  const { data, error } = useSWR<DiagnosisData>(
    userId && open ? `/admin/users/${userId}/diagnosis` : null
  )

  const loading = !data && !error

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>用户诊断 — {username}</SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">加载失败，请重试</p>
        )}

        {data && (
          <div className="space-y-6">
            {/* Failed Tasks */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <h3 className="text-sm font-medium">失败任务（最近 30 条）</h3>
                <Badge variant="destructive" className="text-xs">{data.failed_tasks.length}</Badge>
              </div>

              {data.failed_tasks.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  无失败任务
                </div>
              ) : (
                <div className="space-y-2">
                  {data.failed_tasks.map((t) => (
                    <div key={t.task_id} className="rounded-md border p-3 text-sm space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">{t.module}</Badge>
                        <Badge variant="outline" className="text-xs">{t.provider} / {t.model}</Badge>
                        <Badge variant={t.source === 'canvas' ? 'secondary' : 'outline'} className="text-xs">
                          {t.source === 'canvas' ? '画布' : '生成面板'}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(t.submitted_at).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate" title={t.prompt}>
                        提示词：{t.prompt || '—'}
                      </p>
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">API 原始错误：</p>
                        <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive font-mono break-all">
                          {t.error_message || '（无错误信息）'}
                        </div>
                      </div>
                      {t.retry_count > 0 && (
                        <p className="text-xs text-muted-foreground">重试次数：{t.retry_count}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* AI Assistant Errors */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Bot className="h-4 w-4 text-orange-500" />
                <h3 className="text-sm font-medium">AI 助手错误（近 7 天）</h3>
                <Badge variant="secondary" className="text-xs">{data.ai_assistant_errors.length}</Badge>
              </div>

              {data.ai_assistant_errors.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  无错误记录
                </div>
              ) : (
                <div className="space-y-2">
                  {data.ai_assistant_errors.map((e) => (
                    <div key={e.id} className="rounded-md border p-3 text-sm space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">HTTP {e.http_status ?? '—'}</Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(e.created_at).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div className="rounded bg-orange-500/10 px-2 py-1.5 text-xs text-orange-700 dark:text-orange-400 font-mono break-all">
                        {e.error_detail || '（无详情）'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
