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

const TECH_TAGS = ['AI 图像生成', '智能画布', '数字人', '视频创作', '团队协作']

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
        {/* 网格背景 */}
        <div className="login-grid-bg" />
        {/* 浮动光斑 */}
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
        {/* 底部扫光线 */}
        <div className="login-scan-line" />

        <div className="login-brand-content">
          {/* Logo 标志 */}
          <div className="login-logo-mark">
            <svg viewBox="0 0 20 20" className="h-7 w-7" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2.5" width="16" height="4" rx="1.5" fill="white" />
              <rect x="7.5" y="6" width="5" height="11.5" rx="1.5" fill="white" />
              <circle cx="17" cy="15.5" r="1.5" fill="rgba(255,255,255,0.7)" />
            </svg>
          </div>

          {/* 主标题 */}
          <h1 className="login-headline">
            <span className="login-headline-line">AI 创作</span>
            <span className="login-headline-line login-headline-accent">无限</span>
            <span className="login-headline-line">可能</span>
          </h1>

          {/* 副标题 */}
          <p className="login-subtext">
            Toby.AI 企业版 · 智能内容生成平台<br />
            图像、视频、数字人，一站式 AI 创作工作流
          </p>

          {/* 技术标签 */}
          <div className="login-tech-tags">
            {TECH_TAGS.map((tag) => (
              <span key={tag} className="login-tech-tag">{tag}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── 右侧表单面板 ── */}
      <div className="login-form-panel">
        <div className="login-form-inner">
          {/* 表单头部 */}
          <div className="login-form-header">
            <h2 className="login-form-title">欢迎回来</h2>
            <p className="login-form-subtitle">登录您的 Toby.AI 账户</p>
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
