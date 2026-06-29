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
  // 后端生成的初始密码；仅全新用户返回，已存在用户为 null（保留原密码）
  one_time_password: string | null
  created_new_user: boolean
  // 本次为该成员配置的初始 A 豆额度（已透传给业管 MEMBER-1002）
  initial_points_num?: number
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
  // 初始 A 豆默认 1000，主卡可编辑；业管 MEMBER-1002 约束 >=0
  const [initialPointsNum, setInitialPointsNum] = useState<string>('1000')
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

    setLoading(true)
    try {
      // 初始 A 豆透传给业管 MEMBER-1002（initialPointsNum），默认 1000 可编辑；A 豆账户实际由业管管理
      const parsedPoints = Math.max(0, Math.trunc(Number(initialPointsNum) || 0))
      const res = await apiPost<CreateMemberResponse>(`/teams/${teamId}/members/create`, {
        identifier: trimmedId,
        username: trimmedUsername,
        role,
        initial_points_num: parsedPoints,
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
      setInitialPointsNum('1000')
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
            通过业管会员副卡接口创建成员并建立其 A 豆账户，初始密码由系统自动生成
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-green-900">成员创建成功</p>
                <p className="text-green-800 mt-1">
                  {result.created_new_user ? '账号已激活，可直接登录使用' : '该账号已存在，已加入当前团队'}
                </p>
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
              {typeof result.initial_points_num === 'number' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">初始 A 豆：</span>
                  <span className="font-medium tabular-nums">{result.initial_points_num.toLocaleString()}</span>
                </div>
              )}
              {result.created_new_user && result.one_time_password ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">初始密码：</span>
                  <span className="font-medium font-mono">{result.one_time_password}</span>
                </div>
              ) : null}
            </div>

            {result.created_new_user && result.one_time_password ? (
              <p className="text-xs text-muted-foreground text-center">
                请将账号和初始密码告知新成员，首次登录需修改密码
              </p>
            ) : null}
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
              <Label>初始 A 豆</Label>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="请输入初始 A 豆额度"
                value={initialPointsNum}
                onChange={(e) => setInitialPointsNum(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                通过业管会员副卡接口（MEMBER-1002）为新成员建立 A 豆账户的初始额度，默认 1000，不可小于 0
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p className="font-medium text-blue-900 mb-1">创建说明：</p>
              <ul className="text-blue-800 space-y-1 text-xs">
                <li>• 系统自动生成初始密码，创建成功后展示给组长转告</li>
                <li>• 通过业管会员副卡接口建立成员 A 豆账户，初始额度由主卡配置</li>
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
