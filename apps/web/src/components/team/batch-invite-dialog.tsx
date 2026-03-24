'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiPost, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import { Loader2, Download, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

interface BatchInviteDialogProps {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface BatchResult {
  identifier: string
  status: 'success' | 'failed' | 'exists'
  user_id?: string
  workspace_id?: string
  workspace_name?: string
  username?: string
  error?: string
}

interface BatchResponse {
  success: number
  failed: number
  exists: number
  results: BatchResult[]
}

export function BatchInviteDialog({
  teamId,
  open,
  onOpenChange,
  onSuccess,
}: BatchInviteDialogProps) {
  const [identifiersText, setIdentifiersText] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [creditQuota, setCreditQuota] = useState('1000')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<BatchResponse | null>(null)

  const identifiers = identifiersText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const validCount = identifiers.filter((id) => {
    return id.includes('@') || /^\d{11}$/.test(id)
  }).length

  async function handleBatchCreate() {
    if (identifiers.length === 0) {
      toast.error('请输入至少一个手机号或邮箱')
      return
    }

    const quota = parseInt(creditQuota, 10)
    if (isNaN(quota) || quota < 0) {
      toast.error('积分上限必须是非负整数')
      return
    }

    setLoading(true)
    try {
      const res = await apiPost<BatchResponse>(`/teams/${teamId}/members/batch`, {
        identifiers,
        role,
        credit_quota: quota,
        default_password: '123456',
      })

      setResults(res)
      toast.success(`批量创建完成：成功 ${res.success} 个`)
      onSuccess()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '批量创建失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  function handleDownloadResults() {
    if (!results) return

    const csvLines = [
      '账号,用户名,工作区,状态,错误信息',
      ...results.results.map((r) => {
        const status = r.status === 'success' ? '成功' : r.status === 'exists' ? '已存在' : '失败'
        return `${r.identifier},${r.username ?? ''},${r.workspace_name ?? ''},${status},${r.error ?? ''}`
      }),
    ]

    const csv = csvLines.join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `batch-invite-results-${Date.now()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setIdentifiersText('')
      setRole('editor')
      setCreditQuota('1000')
      setResults(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量添加成员</DialogTitle>
          <DialogDescription>
            直接创建可登录账号，默认密码为 123456（首次登录需修改）
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-2xl font-bold">{results.success}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">成功</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-yellow-600">
                  <AlertCircle className="h-5 w-5" />
                  <span className="text-2xl font-bold">{results.exists}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">已存在</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-red-600">
                  <XCircle className="h-5 w-5" />
                  <span className="text-2xl font-bold">{results.failed}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">失败</p>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">账号</th>
                    <th className="text-left p-2">用户名</th>
                    <th className="text-left p-2">工作区</th>
                    <th className="text-left p-2">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 font-mono text-xs">{r.identifier}</td>
                      <td className="p-2">{r.username ?? '-'}</td>
                      <td className="p-2 text-xs">{r.workspace_name ?? '-'}</td>
                      <td className="p-2">
                        {r.status === 'success' && (
                          <span className="text-green-600 text-xs">✓ 成功</span>
                        )}
                        {r.status === 'exists' && (
                          <span className="text-yellow-600 text-xs">⚠ 已存在</span>
                        )}
                        {r.status === 'failed' && (
                          <span className="text-red-600 text-xs" title={r.error}>
                            ✗ {r.error?.slice(0, 20)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleDownloadResults} className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                下载结果 (CSV)
              </Button>
              <Button onClick={() => handleClose(false)} className="flex-1">
                完成
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>账号列表（每行一个手机号或邮箱）</Label>
              <Textarea
                placeholder="13812345678&#10;user@example.com&#10;13987654321"
                value={identifiersText}
                onChange={(e) => setIdentifiersText(e.target.value)}
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                已识别 {validCount} / {identifiers.length} 个有效账号（最多50个）
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>角色</Label>
                <Select value={role} onValueChange={(v) => setRole(v as 'editor' | 'viewer')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">编辑者 (Editor)</SelectItem>
                    <SelectItem value="viewer">查看者 (Viewer)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>积分上限</Label>
                <Input
                  type="number"
                  min="0"
                  value={creditQuota}
                  onChange={(e) => setCreditQuota(e.target.value)}
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p className="font-medium text-blue-900 mb-1">批量创建说明：</p>
              <ul className="text-blue-800 space-y-1 text-xs">
                <li>• 默认密码：123456（首次登录强制修改）</li>
                <li>• 自动为每人创建独立工作区："{'{用户名}'}工作区"</li>
                <li>• 用户名规则：邮箱取@前部分，手机号取后4位</li>
                <li>• 单次最多创建 50 个账号</li>
              </ul>
            </div>
          </div>
        )}

        {!results && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleClose(false)}>
              取消
            </Button>
            <Button
              onClick={handleBatchCreate}
              disabled={loading || identifiers.length === 0 || validCount === 0}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              批量创建 ({validCount})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
