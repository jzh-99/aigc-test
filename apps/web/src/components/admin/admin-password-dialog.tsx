'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { apiPatch, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface AdminPasswordDialogProps {
  userId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AdminPasswordDialog({ userId, open, onOpenChange }: AdminPasswordDialogProps) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [unlockAccount, setUnlockAccount] = useState(true)
  const [loading, setLoading] = useState(false)

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setNewPassword('')
      setConfirmPassword('')
      setUnlockAccount(true)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return

    if (newPassword !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }
    if (newPassword.length < 8) {
      toast.error('密码长度至少为 8 位')
      return
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast.error('密码必须包含字母和数字')
      return
    }

    setLoading(true)
    try {
      await apiPatch(`/admin/users/${userId}/password`, { new_password: newPassword, unlock_account: unlockAccount })
      toast.success(unlockAccount ? '密码已修改，账户锁定已解除' : '密码已修改，该用户下次登录需使用新密码')
      handleClose(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '修改失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改用户密码</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>新密码</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 位，包含字母和数字"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>确认新密码</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="unlock-account"
              checked={unlockAccount}
              onCheckedChange={setUnlockAccount}
            />
            <Label htmlFor="unlock-account" className="text-sm font-normal cursor-pointer">
              同时解除账户登录锁定（因多次失败被锁定 15 分钟）
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">修改后该用户的所有登录会话将失效，需重新登录。</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleClose(false)}>取消</Button>
            <Button type="submit" disabled={loading || !newPassword || !confirmPassword}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              确认修改
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
