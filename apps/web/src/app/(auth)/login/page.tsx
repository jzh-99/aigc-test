'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { apiPost, ApiError } from '@/lib/api-client'
import type { AuthResponse, LoginRequest } from '@aigc/types'
import { Loader2, ArrowRight, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

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
  // 两步式登录：第一步输手机号，第二步输密码。
  // 后端单接口 /auth/login 一次完成业管先行流程（查业管→判存亡→查本地→建用户/校验），
  // 前端两步只是纯视图切换，"下一步"不调后端，提交时才发 {identifier, password}。
  const [step, setStep] = useState<'phone' | 'password'>('phone')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [suspended, setSuspended] = useState(false)

  // 第一步手机号输入：复用 invite-dialog 的实时过滤（只留数字，截断 11 位）
  function handlePhoneChange(val: string) {
    setIdentifier(val.replace(/\D/g, '').slice(0, 11))
  }

  // 第一步"下一步"：本地校验手机号格式后，调 /auth/check-biz-mgmt 查业管。
  // 业管是账号唯一判官：查无会员（或故障）立即报"用户不存在"并停在第一步；
  // 业管有会员才进入密码输入步。这一步会触发后端清理本地孤儿 user（若存在）。
  async function handleNextStep(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{11}$/.test(identifier)) {
      toast.error('请输入 11 位手机号', { duration: 4000 })
      return
    }
    setLoading(true)
    try {
      await apiPost<{ exists: boolean }>('/auth/check-biz-mgmt', { phone: identifier })
      // 业管有会员，进入密码步
      setStep('password')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BIZ_MGMT_NOT_FOUND') {
        toast.error('用户不存在', { duration: 6000 })
      } else {
        toast.error('查询失败，请稍后重试', { duration: 6000 })
      }
    } finally {
      setLoading(false)
    }
  }

  // 返回第一步（保留已输手机号，清空密码）
  function handleBack() {
    setStep('phone')
    setPassword('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!identifier || !password) return
    setLoading(true)
    setSuspended(false)
    try {
      const res = await apiPost<AuthResponse>('/auth/login', { identifier, password } satisfies LoginRequest)
      resetGeneration()
      setAuth(res.user, res.access_token)

      // 首次从业管创建本地用户时，后端返回一次性初始密码，提示用户登录后修改
      const oneTimePassword = res.one_time_password ?? res.oneTimePassword
      if (oneTimePassword) {
        toast.info(`首次登录初始密码：${oneTimePassword}，登录后请尽快修改密码，遗失请联系管理员重置`, {
          duration: 12000,
        })
      }

      // 需要选择业管会员身份（同手机号多账号且未选）：跳账号选择页，优先于改密/首页
      if (res.user.requireBizMgmtMemberSelection || res.user.require_biz_mgmt_member_selection) {
        router.replace('/select-account')
        return
      }

      if (res.user.password_change_required) {
        router.replace('/settings?tab=security&change_password=true')
      } else {
        router.replace('/')
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'BIZ_MGMT_NOT_FOUND') {
          // 业管查无会员（或故障）：提示"用户不存在"，切回手机号步并清空密码
          toast.error('用户不存在', { duration: 6000 })
          setStep('phone')
          setPassword('')
        } else if (err.code === 'ACCOUNT_SUSPENDED') {
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

          {/* 表单头部（随步骤切换标题）*/}
          <div className="login-form-header">
            <h2 className="login-form-title">{step === 'phone' ? '欢迎回来' : '输入密码'}</h2>
            <p className="login-form-subtitle">
              {step === 'phone' ? '登录您的账户，开启 AI 创作之旅' : `正在登录 ${identifier}`}
            </p>
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

          {step === 'phone' ? (
            // ── 第一步：手机号输入 ──
            <form onSubmit={handleNextStep} className="login-form">
              <div className="login-field">
                <label htmlFor="identifier" className="login-label">手机号</label>
                <Input
                  id="identifier"
                  type="text"
                  inputMode="numeric"
                  placeholder="请输入手机号"
                  value={identifier}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  required
                  autoFocus
                  className="login-input"
                />
              </div>

              <button
                type="submit"
                className="login-submit-btn"
                disabled={loading || identifier.length !== 11}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    查询中...
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    下一步
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </button>
            </form>
          ) : (
            // ── 第二步：密码输入 ──
            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label htmlFor="password" className="login-label">密码</label>
                <Input
                  id="password"
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
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

              <button
                type="button"
                onClick={handleBack}
                className="login-back-btn"
                style={{
                  marginTop: '0.75rem',
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.6)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.25rem',
                  width: '100%',
                  fontSize: '0.875rem',
                }}
              >
                <ArrowLeft className="h-4 w-4" />
                返回修改手机号
              </button>
            </form>
          )}

          <div className="login-footer-links">
            <span>登录即代表同意</span>
            <span className="login-link">《用户协议》</span>
            <span>和</span>
            <span className="login-link">《隐私政策》</span>
          </div>
          <p className="basis-full text-center" style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)' }}>
            <Link href="/docs/user-guide" className="login-link">
              《AIGC 用户使用手册》
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
