'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { apiPost, ApiError } from '@/lib/api-client'
import type { AuthResponse, AcceptInviteRequest } from '@aigc/types'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#07091C]">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    }>
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
    if (!token) { toast.error('缺少邀请令牌'); return }
    if (!passwordOk) { toast.error('密码至少8位，且必须同时包含字母和数字'); return }
    if (password !== confirmPassword) { toast.error('两次输入的密码不一致'); return }

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
    <div className="login-split-layout">
      {/* ── 左侧品牌面板 ── */}
      <div className="login-brand-panel" aria-hidden="true">
        <div className="login-grid-bg" />
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
        <div className="login-scan-line" />

        <div className="login-brand-content">
          <div className="login-logo-mark">
            <svg viewBox="0 0 20 20" className="h-7 w-7" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2.5" width="16" height="4" rx="1.5" fill="white" />
              <rect x="7.5" y="6" width="5" height="11.5" rx="1.5" fill="white" />
              <circle cx="17" cy="15.5" r="1.5" fill="rgba(255,255,255,0.7)" />
            </svg>
          </div>
          <h1 className="login-headline">
            <span className="login-headline-line">加入团队</span>
            <span className="login-headline-line login-headline-accent">开启</span>
            <span className="login-headline-line">AI 创作</span>
          </h1>
          <p className="login-subtext">
            Toby.AI 企业版 · 智能内容生成平台<br />
            完成注册，立即开始您的 AI 创作之旅
          </p>
        </div>
      </div>

      {/* ── 右侧表单面板 ── */}
      <div className="login-form-panel">
        <div className="login-form-inner">
          <div className="login-form-header">
            <h2 className="login-form-title">接受邀请</h2>
            <p className="login-form-subtitle">设置账户信息以加入团队</p>
          </div>

          {!token ? (
            <div className="text-center py-8">
              <p className="text-white/40 mb-4">无效的邀请链接</p>
              <Link href="/login" className="login-link" style={{ color: 'rgba(107,163,245,0.8)' }}>
                返回登录
              </Link>
            </div>
          ) : (
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
                  readOnly={!!identifierFromUrl}
                  className="login-input"
                />
                {identifierFromUrl && (
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>账号由邀请链接指定，不可修改</p>
                )}
              </div>

              <div className="login-field">
                <label htmlFor="username" className="login-label">用户名</label>
                <Input
                  id="username"
                  type="text"
                  placeholder="请输入您的用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="login-input"
                />
              </div>

              <div className="login-field">
                <label htmlFor="password" className="login-label">密码</label>
                <Input
                  id="password"
                  type="password"
                  placeholder="至少8位，含字母和数字"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="login-input"
                />
                {password.length > 0 && !passwordOk && (
                  <p className="text-xs" style={{ color: '#F07080' }}>
                    {password.length < 8 ? '密码至少需要 8 位' : '密码必须同时包含字母和数字'}
                  </p>
                )}
              </div>

              <div className="login-field">
                <label htmlFor="confirmPassword" className="login-label">确认密码</label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="请再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="login-input"
                />
                {passwordMismatch && (
                  <p className="text-xs" style={{ color: '#F07080' }}>两次输入的密码不一致</p>
                )}
              </div>

              <button
                type="submit"
                className="login-submit-btn"
                disabled={loading || !passwordOk || passwordMismatch}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    注册中...
                  </span>
                ) : (
                  '注册并加入'
                )}
              </button>
            </form>
          )}

          <div className="login-footer-links">
            <Link href="/login" className="login-link">已有账户？登录</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
