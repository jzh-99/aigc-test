'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, Bot, TrendingUp, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FailedTask {
  task_id: string
  batch_id: string
  error_message: string | null
  retry_count: number
  module: string
  provider: string
  model: string
  prompt: string
  source: 'canvas' | 'generation'
  submitted_at: string
  completed_at: string | null
  user_id: string
  username: string
  account: string
}

interface AiError {
  id: string
  http_status: number | null
  error_detail: string | null
  created_at: string
  user_id: string
  username: string
  account: string
}

interface TopError {
  message: string
  count: number
  last_seen: string
}

interface ErrorDashboardData {
  failed_tasks: FailedTask[]
  ai_errors: AiError[]
  top_errors: TopError[]
  since: string
}

const SINCE_OPTIONS = [
  { label: '近 1 天', value: 1 * 24 * 60 * 60 * 1000 },
  { label: '近 7 天', value: 7 * 24 * 60 * 60 * 1000 },
  { label: '近 30 天', value: 30 * 24 * 60 * 60 * 1000 },
]

type ViewTab = 'summary' | 'tasks' | 'ai'

export function ErrorDashboard() {
  const [since, setSince] = useState(SINCE_OPTIONS[1].value)
  const [view, setView] = useState<ViewTab>('summary')

  const { data, error, isLoading, mutate } = useSWR<ErrorDashboardData>(
    `/admin/errors?since=${since}&limit=100`
  )

  return (
    <div className="space-y-4">
      {/* Time range + refresh */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {SINCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSince(opt.value)}
              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                since === opt.value
                  ? 'bg-accent-blue/10 border-accent-blue text-accent-blue'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => mutate()} className="h-7 gap-1 text-xs">
          <RefreshCw className="h-3 w-3" />
          刷新
        </Button>
      </div>

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">失败任务</p>
            <p className="text-2xl font-semibold text-destructive">{data.failed_tasks.length}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">AI 助手错误</p>
            <p className="text-2xl font-semibold text-orange-500">{data.ai_errors.length}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">错误类型数</p>
            <p className="text-2xl font-semibold">{data.top_errors.length}</p>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b">
        {([
          { key: 'summary' as ViewTab, label: '错误汇总', Icon: TrendingUp },
          { key: 'tasks' as ViewTab, label: '失败任务', Icon: AlertCircle },
          { key: 'ai' as ViewTab, label: 'AI 助手错误', Icon: Bot },
        ]).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              view === key
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {data && key === 'tasks' && data.failed_tasks.length > 0 && (
              <Badge variant="destructive" className="text-xs px-1 py-0 h-4">
                {data.failed_tasks.length}
              </Badge>
            )}
            {data && key === 'ai' && data.ai_errors.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1 py-0 h-4">
                {data.ai_errors.length}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">加载失败，请重试</p>}

      {/* Summary: top errors by frequency */}
      {data && view === 'summary' && (
        <div className="space-y-2">
          {data.top_errors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">该时间段内无错误记录</p>
          ) : (
            data.top_errors.map((e, i) => (
              <div key={i} className="rounded-md border p-3 flex items-start gap-3">
                <span className="text-base font-bold text-muted-foreground w-8 shrink-0 text-right tabular-nums">
                  {e.count}
                </span>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="font-mono text-xs text-destructive break-all">{e.message}</div>
                  <p className="text-xs text-muted-foreground">
                    最近出现：{new Date(e.last_seen).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Failed tasks list */}
      {data && view === 'tasks' && (
        <div className="space-y-2">
          {data.failed_tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">该时间段内无失败任务</p>
          ) : (
            data.failed_tasks.map((t) => (
              <div key={t.task_id} className="rounded-md border p-3 text-sm space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">{t.module}</Badge>
                  <Badge variant="outline" className="text-xs">{t.provider} / {t.model}</Badge>
                  <Badge
                    variant={t.source === 'canvas' ? 'secondary' : 'outline'}
                    className="text-xs"
                  >
                    {t.source === 'canvas' ? '画布' : '生成面板'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t.username}（{t.account}）
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(t.submitted_at).toLocaleString('zh-CN')}
                  </span>
                </div>
                {t.prompt && (
                  <p className="text-xs text-muted-foreground truncate" title={t.prompt}>
                    提示词：{t.prompt}
                  </p>
                )}
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
            ))
          )}
        </div>
      )}

      {/* AI assistant errors list */}
      {data && view === 'ai' && (
        <div className="space-y-2">
          {data.ai_errors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">该时间段内无 AI 助手错误</p>
          ) : (
            data.ai_errors.map((e) => (
              <div key={e.id} className="rounded-md border p-3 text-sm space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">HTTP {e.http_status ?? '—'}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {e.username}（{e.account}）
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(e.created_at).toLocaleString('zh-CN')}
                  </span>
                </div>
                <div className="rounded bg-orange-500/10 px-2 py-1.5 text-xs text-orange-700 dark:text-orange-400 font-mono break-all">
                  {e.error_detail || '（无详情）'}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
