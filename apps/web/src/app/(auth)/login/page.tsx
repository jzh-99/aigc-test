'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { apiPost, ApiError } from '@/lib/api-client'
import type { AuthResponse, LoginRequest } from '@aigc/types'
import { Loader2 } from 'lucide-react'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const resetGeneration = useGenerationStore((s) => s.reset)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [suspended, setSuspended] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return

    setLoading(true)
    setErrorMsg(null)
    setSuspended(false)
    try {
      const res = await apiPost<AuthResponse>('/auth/login', { email, password } satisfies LoginRequest)
      resetGeneration()
      setAuth(res.user, res.access_token)
      router.replace('/')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ACCOUNT_SUSPENDED') {
          setSuspended(true)
        } else {
          setErrorMsg(err.message)
        }
      } else {
        setErrorMsg('登录失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">AIGC 创作平台</CardTitle>
        <CardDescription>登录您的账户</CardDescription>
      </CardHeader>
      <CardContent>
        {suspended && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">账户已停用</p>
            <p className="mt-1 text-muted-foreground">
              您已被移出所有团队，账户已自动停用。请联系团队管理员重新发送邀请链接以恢复使用。
            </p>
          </div>
        )}
        {errorMsg && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errorMsg}
          </div>
        )}
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
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" variant="gradient" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            登录
          </Button>
        </form>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          收到邀请？{' '}
          <Link href="/accept-invite" className="text-accent-blue hover:underline">
            接受邀请
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
