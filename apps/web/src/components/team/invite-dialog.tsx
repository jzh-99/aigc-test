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
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [creditQuota, setCreditQuota] = useState('1000')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CreateMemberResponse | null>(null)
  const [phoneError, setPhoneError] = useState('')
  const [usernameError, setUsernameError] = useState('')

  function handleIdentifierChange(val: string) {
    const phone = val.replace(/\D/g, '').slice(0, 11)
    setIdentifier(phone)
    setPhoneError(phone && phone.length !== 11 ? '手机号必须是 11 位数字' : '')
  }

  function handleUsernameChange(val: string) {
    const nextUsername = val.trimStart().slice(0, 30)
    setUsername(nextUsername)
    const trimmed = nextUsername.trim()
    if (!trimmed) {
      setUsernameError('')
    } else if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,30}$/.test(trimmed)) {
      setUsernameError('用户名需为 2-30 位中文、字母、数字、下划线或横线')
    } else {
      setUsernameError('')
    }
  }

  async function handleCreate() {
    const trimmedId = identifier.trim()
    const trimmedUsername = username.trim()
    if (!/^\d{11}$/.test(trimmedId)) {
      setPhoneError('手机号必须是 11 位数字')
      return
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,30}$/.test(trimmedUsername)) {
      setUsernameError('用户名需为 2-30 位中文、字母、数字、下划线或横线')
      return
    }

    const quota = parseInt(creditQuota, 10)
    if (isNaN(quota) || quota < 0) {
      toast.error('A豆上限必须是非负整数')
      return
    }

    setLoading(true)
    try {
      const res = await apiPost<CreateMemberResponse>(`/teams/${teamId}/members/create`, {
        identifier: trimmedId,
        username: trimmedUsername,
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
      setUsername('')
      setRole('editor')
      setCreditQuota('1000')
      setResult(null)
      setPhoneError('')
      setUsernameError('')
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>用户名</Label>
                <Input
                  type="text"
                  maxLength={30}
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  autoFocus
                />
                {usernameError && <p className="text-xs text-destructive">{usernameError}</p>}
              </div>

              <div className="space-y-2">
                <Label>手机号</Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  pattern="\d{11}"
                  maxLength={11}
                  placeholder="请输入 11 位手机号"
                  value={identifier}
                  onChange={(e) => handleIdentifierChange(e.target.value)}
                />
                {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
              </div>
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
                <Label>A豆上限</Label>
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
                <li>• 手机号作为登录账号，用户名用于成员显示</li>
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
                disabled={loading || !username.trim() || !identifier.trim() || !!usernameError || !!phoneError}
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
