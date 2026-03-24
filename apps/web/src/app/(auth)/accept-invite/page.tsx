'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { apiPost, ApiError } from '@/lib/api-client'
import type { AuthResponse, AcceptInviteRequest } from '@aigc/types'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <AcceptInviteForm />
    </Suspense>
  )
}

function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const emailFromUrl = searchParams.get('email') ?? ''
  const phoneFromUrl = searchParams.get('phone') ?? ''
  const identifierFromUrl = emailFromUrl || phoneFromUrl
  const setAuth = useAuthStore((s) => s.setAuth)

  const [identifier, setIdentifier] = useState(identifierFromUrl)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const passwordOk = password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password)
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!token) {
      toast.error('缺少邀请令牌')
      return
    }

    if (!passwordOk) {
      toast.error('密码至少8位，且必须同时包含字母和数字')
      return
    }

    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }

    setLoading(true)
    try {
      const isEmail = identifier.includes('@')
      const body: AcceptInviteRequest = isEmail
        ? { token, email: identifier, password, username }
        : { token, phone: identifier, password, username }

      const res = await apiPost<AuthResponse>('/auth/accept-invite', body)
      setAuth(res.user, res.access_token)
      toast.success('注册成功！')
      router.replace('/')
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      } else {
        toast.error('注册失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* Logo and Toby.AI 企业版 - 在卡片外部 */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-accent shrink-0 shadow-lg">
          <svg viewBox="0 0 20 20" className="h-6 w-6" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* T crossbar */}
            <rect x="2" y="2.5" width="16" height="4" rx="1.5" fill="white"/>
            {/* T stem */}
            <rect x="7.5" y="6" width="5" height="11.5" rx="1.5" fill="white"/>
            {/* AI dot */}
            <circle cx="17" cy="15.5" r="1.5" fill="rgba(255,255,255,0.7)"/>
          </svg>
        </div>
        <h1 className="font-bold text-3xl gradient-accent-text tracking-tight drop-shadow-sm">
          Toby.AI 企业版
        </h1>
      </div>

      {/* Accept Invite Card - 包含 AIGC 创作平台和表单 */}
      <Card className="border-border shadow-xl">
        <CardContent className="pt-8 pb-6 px-8">
          {/* AIGC 创作平台标题 */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground tracking-wide mb-2">
              AIGC 创作平台
            </h2>
            <p className="text-sm text-muted-foreground">设置您的账户信息以加入团队</p>
          </div>

          {!token ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">无效的邀请链接</p>
              <Link href="/login" className="text-accent-blue hover:underline font-medium">
                返回登录
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-sm font-medium">
                  邮箱 / 手机号
                </Label>
                <Input
                  id="identifier"
                  type="text"
                  placeholder="请输入邮箱或手机号"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  readOnly={!!identifierFromUrl}
                  className={identifierFromUrl ? 'bg-muted h-11' : 'h-11'}
                />
                {identifierFromUrl && (
                  <p className="text-xs text-muted-foreground">账号由邀请链接指定，不可修改</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">
                  用户名
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="请输入您的用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  密码
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="至少8位，含字母和数字"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">至少 8 位，需同时包含字母和数字</p>
                {password.length > 0 && !passwordOk && (
                  <p className="text-xs text-destructive">
                    {password.length < 8 ? '密码至少需要 8 位' : '密码必须同时包含字母和数字'}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium">
                  确认密码
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="请再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="h-11"
                />
                {passwordMismatch && (
                  <p className="text-xs text-destructive">两次输入的密码不一致</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-base font-medium"
                variant="gradient"
                disabled={loading || !passwordOk || passwordMismatch}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    注册中...
                  </>
                ) : (
                  '注册并加入'
                )}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              已有账户？
              <Link href="/login" className="ml-1 text-accent-blue hover:underline font-medium">
                登录
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
