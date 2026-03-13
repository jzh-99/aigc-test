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
  const setAuth = useAuthStore((s) => s.setAuth)

  const [email, setEmail] = useState(emailFromUrl)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!token) {
      toast.error('缺少邀请令牌')
      return
    }

    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }

    if (password.length < 8) {
      toast.error('密码至少需要8个字符')
      return
    }

    setLoading(true)
    try {
      const res = await apiPost<AuthResponse>('/auth/accept-invite', {
        token,
        email,
        password,
        username,
      } satisfies AcceptInviteRequest)
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
    <Card className="border-border">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">接受邀请</CardTitle>
        <CardDescription>设置您的账户信息以加入团队</CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <div className="text-center text-muted-foreground">
            <p>无效的邀请链接</p>
            <Link href="/login" className="text-accent-blue hover:underline mt-2 block">
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                readOnly={!!emailFromUrl}
                className={emailFromUrl ? 'bg-muted' : ''}
              />
              {emailFromUrl && (
                <p className="text-xs text-muted-foreground">邮箱由邀请链接指定，不可修改</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                type="text"
                placeholder="您的用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="至少8个字符"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" className="w-full" variant="gradient" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              注册并加入
            </Button>
          </form>
        )}
        <div className="mt-4 text-center text-sm text-muted-foreground">
          已有账户？{' '}
          <Link href="/login" className="text-accent-blue hover:underline">
            登录
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
