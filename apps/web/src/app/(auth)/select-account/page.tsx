'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiPost, getRequestErrorMessage } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import type { BizMgmtMemberAccount, BizMgmtMemberSelectionResponse } from '@aigc/types'
import { BizMgmtMemberOptionCard } from '@/components/auth/biz-mgmt-member-option-card'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * 业管会员身份选择页。
 *
 * 进入条件：登录后 user.requireBizMgmtMemberSelection=true（同手机号多账号且未选）。
 * 选择接口返回 { user }（不重签 token），前端用原 token + updateUser 更新 profile，
 * 并通过 setActiveBizMgmtMember 同步切换到所选身份对应的 team/workspace。
 */
export default function SelectAccountPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.accessToken)
  const updateUser = useAuthStore((s) => s.updateUser)
  const setActiveBizMgmtMember = useAuthStore((s) => s.setActiveBizMgmtMember)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  // 兼容 camelCase / snake_case：后端两种字段风格都返回
  const members: BizMgmtMemberAccount[] = user?.bizMgmtMembers ?? user?.biz_mgmt_members ?? []

  // 未登录或无可选身份：回登录页（避免直接访问空页）
  useEffect(() => {
    if (!user || !token || members.length === 0) {
      router.replace('/login')
    }
  }, [user, token, members.length, router])

  async function handleSelect(member: BizMgmtMemberAccount) {
    const bizMgmtUserId = member.bizMgmtUserId ?? member.biz_mgmt_user_id
    setSubmittingId(bizMgmtUserId)
    try {
      const res = await apiPost<BizMgmtMemberSelectionResponse>('/auth/select-biz-mgmt-member', {
        biz_mgmt_user_id: bizMgmtUserId,
      })
      // select 接口不重签 token：用原 token，仅更新 profile 与当前身份/团队/工作区
      updateUser(res.user)
      const selected =
        res.user.bizMgmtMembers?.find((m) => m.isSelected) ??
        res.user.biz_mgmt_members?.find((m) => m.is_selected)
      if (selected) {
        setActiveBizMgmtMember(selected)
      }
      router.replace('/dashboard')
    } catch (err) {
      toast.error(getRequestErrorMessage(err, '账号身份选择失败，请稍后重试'), { duration: 8000 })
    } finally {
      setSubmittingId(null)
    }
  }

  if (!user || !token || members.length === 0) {
    return null
  }

  return (
    <main className="login-split-layout">
      {/* ── 左侧品牌面板（与登录页一致） ── */}
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

      {/* ── 右侧选择面板 ── */}
      <div className="login-form-panel">
        <div className="login-panel-orb login-panel-orb-1" />
        <div className="login-panel-orb login-panel-orb-2" />
        <div className="login-panel-noise" />

        <div className="login-form-inner">
          <div className="login-form-header">
            <h2 className="login-form-title">选择账号身份</h2>
            <p className="login-form-subtitle">该手机号关联多个业管会员身份，请选择本次登录使用的身份</p>
          </div>

          <div className="mt-2 space-y-3">
            {members.map((member) => {
              const bizMgmtUserId = member.bizMgmtUserId ?? member.biz_mgmt_user_id
              return (
                <BizMgmtMemberOptionCard
                  key={bizMgmtUserId}
                  member={member}
                  disabled={!!submittingId}
                  onSelect={handleSelect}
                />
              )
            })}
          </div>

          {submittingId && (
            <div className="mt-4 flex items-center justify-center text-white/40 text-sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在切换身份...
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
