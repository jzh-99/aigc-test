'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { apiPost, ApiError } from '@/lib/api-client'
import type { AuthResponse, LoginRequest } from '@aigc/types'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const resetGeneration = useGenerationStore((s) => s.reset)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [suspended, setSuspended] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!identifier || !password) return

    setLoading(true)
    setSuspended(false)
    try {
      const res = await apiPost<AuthResponse>('/auth/login', { identifier, password } satisfies LoginRequest)
      resetGeneration()
      setAuth(res.user, res.access_token)

      // Check if password change is required
      if (res.user.password_change_required) {
        router.replace('/settings?tab=security&change_password=true')
      } else {
        router.replace('/')
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ACCOUNT_SUSPENDED') {
          setSuspended(true)
        } else {
          toast.error(err.message, { duration: 8000 })
        }
      } else {
        toast.error('登录失败，请稍后重试', { duration: 8000 })
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

      {/* Login Card - 包含 AIGC 创作平台和表单 */}
      <Card className="border-border shadow-xl">
        <CardContent className="pt-8 pb-6 px-8">
          {/* AIGC 创作平台标题 */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground tracking-wide mb-2">
              AIGC 创作平台
            </h2>
            <p className="text-sm text-muted-foreground">登录您的账户</p>
          </div>

          {suspended && (
            <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5 text-sm">
              <p className="font-semibold text-destructive mb-1">账户已停用</p>
              <p className="text-muted-foreground leading-relaxed">
                您已被移出所有团队，账户已自动停用。请联系团队管理员重新发送邀请链接以恢复使用。
              </p>
            </div>
          )}

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
                autoFocus
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
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base font-medium"
              variant="gradient"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              收到邀请？
              <Link href="/accept-invite" className="ml-1 text-accent-blue hover:underline font-medium">
                接受邀请
              </Link>
            </p>
            <p className="text-sm text-muted-foreground">
              <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                查看使用手册 →
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
