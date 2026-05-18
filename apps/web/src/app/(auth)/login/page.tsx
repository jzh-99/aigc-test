'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { apiPost, ApiError } from '@/lib/api-client'
import type { AuthResponse, LoginRequest } from '@aigc/types'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

function KickedMessage() {
  const searchParams = useSearchParams()
  const isKicked = searchParams.get('reason') === 'kicked'
  if (!isKicked) return null
  return (
    <div className="mb-5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm">
      <p className="font-semibold text-yellow-500 mb-1">账号已登出</p>
      <p className="text-white/40 leading-relaxed">
        您的账号已在其他设备登录。如果这不是您本人的操作，请修改密码。
      </p>
    </div>
  )
}

function SsoHandler() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const resetGeneration = useGenerationStore((s) => s.reset)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) return
    const redirect = searchParams.get('redirect') ?? '/'
    const safePath = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
    apiPost<AuthResponse>('/auth/sso', { token })
      .then((res) => {
        resetGeneration()
        setAuth(res.user, res.access_token)
        router.replace(safePath)
      })
      .catch(() => {
        toast.error('单点登录失败，请手动登录', { duration: 6000 })
      })
  }, [])

  return null
}

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
    <div className="login-split-layout">
      {/* ── 左侧品牌面板 ── */}
      <div className="login-brand-panel" aria-hidden="true">
        <video
          className="login-brand-video"
          src="https://toby-ai-dev.tos-cn-shanghai.volces.com/assets/video/bg.mp4"
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback"
        />
        <div className="login-brand-video-overlay" />
      </div>

      {/* ── 右侧表单面板 ── */}
      <div className="login-form-panel">
        {/* 背景装饰光晕 */}
        <div className="login-panel-orb login-panel-orb-1" />
        <div className="login-panel-orb login-panel-orb-2" />
        <div className="login-panel-noise" />

        <div className="login-form-inner">
          {/* Logo + Slogan */}
          <div className="login-logo-block">
            <div className="login-logo-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="3" width="20" height="5" rx="2" fill="white" />
                <rect x="9" y="7.5" width="6" height="13.5" rx="2" fill="white" />
                <circle cx="20" cy="18" r="2" fill="rgba(200,155,236,0.9)" />
              </svg>
            </div>
            <div className="login-logo-text">
              <span className="login-logo-name">Toby.AI</span>
              <span className="login-logo-slogan">让美好，被看见。</span>
            </div>
          </div>

          {/* 表单头部 */}
          <div className="login-form-header">
            <h2 className="login-form-title">欢迎回来</h2>
            <p className="login-form-subtitle">登录您的账户，开启 AI 创作之旅</p>
          </div>

          <Suspense fallback={null}>
            <KickedMessage />
            <SsoHandler />
          </Suspense>

          {suspended && (
            <div className="mb-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
              <p className="font-semibold text-red-400 mb-1">账户已停用</p>
              <p className="text-white/40 leading-relaxed">
                您已被移出所有团队，账户已自动停用。请联系团队管理员重新发送邀请链接以恢复使用。
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="identifier" className="login-label">邮箱 / 手机号</label>
              <Input
                id="identifier"
                type="text"
                placeholder="请输入邮箱或手机号"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoFocus
                className="login-input"
              />
            </div>

            <div className="login-field">
              <label htmlFor="password" className="login-label">密码</label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="login-input"
              />
            </div>

            <button
              type="submit"
              className="login-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中...
                </span>
              ) : (
                '登 录'
              )}
            </button>
          </form>

          <div className="login-footer-links">
            <Link href="/accept-invite" className="login-link">接受邀请</Link>
            <span className="login-link-divider">·</span>
            <Link href="/docs" className="login-link">使用手册</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
