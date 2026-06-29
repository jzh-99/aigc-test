'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { apiPatch, apiPost, fetchWithAuth, ApiError } from '@/lib/api-client'
import { SettingsManagementNav } from '@/components/layout/settings-management-nav'
import type { UserProfile } from '@aigc/types'
import { toast } from 'sonner'
import { Loader2, AlertCircle, LogOut, ImagePlus } from 'lucide-react'

function SettingsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const updateUser = useAuthStore((s) => s.updateUser)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const watermark = useGenerationStore((s) => s.watermark)
  const setWatermark = useGenerationStore((s) => s.setWatermark)
  const resetGeneration = useGenerationStore((s) => s.reset)
  const [username, setUsername] = useState(user?.username ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? '')
  const [loading, setLoading] = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  const isOwnerOrAdmin =
    activeTeam?.role === 'owner' || activeTeam?.role === 'admin' || user?.role === 'admin'

  const showPasswordWarning = user?.password_change_required || searchParams.get('change_password') === 'true'
  const accountDisplay = user?.phone ?? user?.email ?? '已登录账号'

  // Auto-focus password change section when required
  useEffect(() => {
    if (showPasswordWarning) {
      // Scroll to top to show password change card
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [showPasswordWarning])

  useEffect(() => {
    setUsername(user?.username ?? '')
    setAvatarUrl(user?.avatar_url ?? '')
  }, [user?.avatar_url, user?.username])

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
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件')
      e.target.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('头像图片不能超过 10 MB')
      e.target.value = ''
      return
    }

    setAvatarUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetchWithAuth<{ url: string }>('/avatar/upload', { method: 'POST', body: form })
      setAvatarUrl(res.url)
      toast.success('头像已上传，请保存修改')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '头像上传失败')
    } finally {
      setAvatarUploading(false)
      e.target.value = ''
    }
  }

  async function handleLogout() {
    if (logoutLoading) return
    setLogoutLoading(true)
    try {
      await apiPost('/auth/logout', {})
    } catch {
      // 即使服务端登出失败，也清理本地会话，避免用户被困在当前账号。
    } finally {
      resetGeneration()
      clearAuth()
      router.replace('/login')
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

      // Update user profile to reflect password_change_required = false
      if (user) {
        updateUser({ ...user, password_change_required: false })
      }

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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">个人设置</h1>
        <p className="text-muted-foreground">管理您的个人信息、账户安全和团队相关入口</p>
      </div>

      <SettingsManagementNav />

      <Card className="border-destructive/25 bg-destructive/[0.03]">
        <CardHeader>
          <CardTitle>账户会话</CardTitle>
          <CardDescription>退出当前账号并返回登录页</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">{user?.username ?? '当前用户'}</p>
              <p className="text-xs text-muted-foreground">{accountDisplay}</p>
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={handleLogout}
              disabled={logoutLoading}
              className="w-full sm:w-auto"
            >
              {logoutLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              退出登录
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Password change card - show first if required */}
      {showPasswordWarning && (
        <Card className="border-yellow-500/50">
          <CardHeader>
            <CardTitle>修改密码</CardTitle>
            <CardDescription>更改您的登录密码</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-yellow-900">需要修改密码</p>
                <p className="mt-1 text-yellow-800">
                  您使用的是默认密码，为了账户安全，请立即修改密码。
                </p>
              </div>
            </div>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">当前密码</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoFocus
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
      )}

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>更新您的用户名和头像</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>账户</Label>
              <Input value={accountDisplay} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">账户不可修改</p>
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
              <Label>头像</Label>
              <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/20 p-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="h-6 w-6" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                    >
                      {avatarUploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ImagePlus className="mr-2 h-4 w-4" />
                      )}
                      上传头像
                    </Button>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {avatarUrl ? avatarUrl : '支持 JPG、PNG、WebP，上传后点击保存修改生效'}
                  </p>
                </div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
            <Button type="submit" disabled={loading || avatarUploading}>
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
              <p className="text-xs text-muted-foreground">如需调整A豆配额或权限，请联系团队负责人</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>生成偏好</CardTitle>
          <CardDescription>配置 AI 生成任务的全局默认设置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="watermark-switch">生成水印</Label>
              <p className="text-xs text-muted-foreground">
                开启后，所有支持水印的生成任务（图片/视频）均会添加水印
              </p>
            </div>
            <Switch
              id="watermark-switch"
              checked={watermark}
              onCheckedChange={setWatermark}
            />
          </div>
        </CardContent>
      </Card>

      {/* Password change card - show at bottom if not required */}
      {!showPasswordWarning && (
        <Card>
          <CardHeader>
            <CardTitle>修改密码</CardTitle>
            <CardDescription>更改您的登录密码</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password-normal">当前密码</Label>
                <Input
                  id="current-password-normal"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password-normal">新密码</Label>
                <Input
                  id="new-password-normal"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 8 位，包含字母和数字"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password-normal">确认新密码</Label>
                <Input
                  id="confirm-password-normal"
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
      )}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageContent />
    </Suspense>
  )
}
