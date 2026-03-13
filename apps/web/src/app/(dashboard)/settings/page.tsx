'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { apiPatch, apiPost, ApiError } from '@/lib/api-client'
import type { UserProfile } from '@aigc/types'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const updateUser = useAuthStore((s) => s.updateUser)
  const [username, setUsername] = useState(user?.username ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? '')
  const [loading, setLoading] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const updated = await apiPatch<UserProfile>('/users/me', {
        username: username || undefined,
        avatar_url: avatarUrl || null,
      })
      updateUser(updated)
      toast.success('设置已保存')
    } catch {
      toast.error('保存失败')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }
    if (newPassword.length < 8) {
      toast.error('新密码长度至少为 8 个字符')
      return
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast.error('新密码必须包含字母和数字')
      return
    }
    setPwLoading(true)
    try {
      await apiPost<{ success: boolean }>('/users/me/password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      toast.success('密码已修改')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      } else {
        toast.error('密码修改失败')
      }
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">个人设置</h1>
        <p className="text-muted-foreground">管理您的个人信息</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>更新您的用户名和头像</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input value={user?.email ?? ''} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">邮箱不可修改</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="您的用户名"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avatar">头像 URL</Label>
              <Input
                id="avatar"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
              />
              <p className="text-xs text-muted-foreground">输入头像图片链接（文件上传功能后续开放）</p>
            </div>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              保存修改
            </Button>
          </form>
        </CardContent>
      </Card>

      {activeTeam && activeTeam.role !== 'owner' && activeTeam.owner && (
        <Card>
          <CardHeader>
            <CardTitle>团队信息</CardTitle>
            <CardDescription>您当前所在的团队</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground">团队名称</Label>
              <p className="text-sm font-medium">{activeTeam.name}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">团队负责人</Label>
              <p className="text-sm">
                <span className="font-medium">{activeTeam.owner.username}</span>
                <span className="text-muted-foreground ml-2">{activeTeam.owner.email}</span>
              </p>
              <p className="text-xs text-muted-foreground">如需调整积分配额或权限，请联系团队负责人</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>更改您的登录密码</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">当前密码</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 位，包含字母和数字"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">确认新密码</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={pwLoading}>
              {pwLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              修改密码
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
