'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Loader2, CheckCircle2 } from 'lucide-react'

interface InviteDialogProps {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface CreateMemberResponse {
  user_id: string
  username: string
  workspace_id: string
  workspace_name: string
  account: string
}

export function InviteDialog({
  teamId,
  open,
  onOpenChange,
  onSuccess,
}: InviteDialogProps) {
  const [identifier, setIdentifier] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [creditQuota, setCreditQuota] = useState('1000')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CreateMemberResponse | null>(null)
  const [phoneError, setPhoneError] = useState('')

  function handleIdentifierChange(val: string) {
    setIdentifier(val)
    const trimmed = val.trim()
    if (trimmed && !trimmed.includes('@')) {
      setPhoneError(/^\d{11}$/.test(trimmed) ? '' : '手机号必须是 11 位数字')
    } else {
      setPhoneError('')
    }
  }

  async function handleCreate() {
    const trimmedId = identifier.trim()
    if (!trimmedId || phoneError) return

    const quota = parseInt(creditQuota, 10)
    if (isNaN(quota) || quota < 0) {
      toast.error('积分上限必须是非负整数')
      return
    }

    setLoading(true)
    try {
      const res = await apiPost<CreateMemberResponse>(`/teams/${teamId}/members/create`, {
        identifier: trimmedId,
        role,
        credit_quota: quota,
        default_password: '123456',
      })

      setResult(res)
      toast.success('成员创建成功')
      onSuccess()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setIdentifier('')
      setRole('editor')
      setCreditQuota('1000')
      setResult(null)
      setPhoneError('')
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加成员</DialogTitle>
          <DialogDescription>
            直接创建可登录账号，默认密码为 123456（首次登录需修改）
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-green-900">成员创建成功</p>
                <p className="text-green-800 mt-1">账号已激活，可直接登录使用</p>
              </div>
            </div>

            <div className="space-y-3 p-4 bg-muted rounded-lg text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">账号：</span>
                <span className="font-medium font-mono">{result.account}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">用户名：</span>
                <span className="font-medium">{result.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">工作区：</span>
                <span className="font-medium">{result.workspace_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">默认密码：</span>
                <span className="font-medium font-mono">123456</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              请将账号和密码告知新成员，首次登录需修改密码
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>邮箱 / 手机号</Label>
              <Input
                type="text"
                placeholder="member@example.com 或 11 位手机号"
                value={identifier}
                onChange={(e) => handleIdentifierChange(e.target.value)}
                autoFocus
              />
              {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
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
              <p className="font-medium text-blue-900 mb-1">创建说明：</p>
              <ul className="text-blue-800 space-y-1 text-xs">
                <li>• 默认密码：123456（首次登录强制修改）</li>
                <li>• 自动创建独立工作区："{'{用户名}'}工作区"</li>
                <li>• 用户名规则：邮箱取@前部分，手机号取后4位</li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleClose(false)}>完成</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)}>
                取消
              </Button>
              <Button
                onClick={handleCreate}
                disabled={loading || !identifier.trim() || !!phoneError}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                创建成员
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
