'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { apiPost, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'

// 被操作的副卡成员（仅用到展示与编号字段；Member 类型由 member-list 透传，这里保持宽松）。
interface TargetMember {
  user_id: string
  username: string
  biz_mgmt_user_id?: string | null
  a_bean_balance?: number | null
}

interface PointsChangeDialogProps {
  teamId: string
  member: TargetMember | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

// 业管 MEMBER-1005 changeType：1副卡增加 / 2副卡扣减。
type ChangeType = 1 | 2

interface PointsChangeResponse {
  main_user_id: string
  sub_user_id: string
  main_balance: number | null
  sub_balance: number | null
}

export function PointsChangeDialog({
  teamId,
  member,
  open,
  onOpenChange,
  onSuccess,
}: PointsChangeDialogProps) {
  const [changeType, setChangeType] = useState<ChangeType>(1)
  const [pointsNum, setPointsNum] = useState('')
  const [loading, setLoading] = useState(false)

  // 数量必须是正整数（不支持小数）：输入时仅保留数字、去除前导 0。
  const parsedPoints = Number(pointsNum)
  const pointsValid = pointsNum !== '' && Number.isInteger(parsedPoints) && parsedPoints > 0

  function handlePointsNumChange(raw: string) {
    // 仅保留数字字符并去掉前导 0，杜绝小数点与负号输入。
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
    setPointsNum(digits)
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setChangeType(1)
      setPointsNum('')
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit() {
    if (!member || !pointsValid) return
    setLoading(true)
    try {
      const result = await apiPost<PointsChangeResponse>(
        `/teams/${teamId}/members/${member.user_id}/points-change`,
        { changeType, pointsNum: parsedPoints },
      )
      const mainText =
        typeof result.main_balance === 'number' ? `主卡 ${result.main_balance.toLocaleString()} A豆` : ''
      const subText =
        typeof result.sub_balance === 'number' ? `副卡 ${result.sub_balance.toLocaleString()} A豆` : ''
      const detail = [mainText, subText].filter(Boolean).join('，')
      toast.success(`A豆变更成功${detail ? `（${detail}）` : ''}`)
      onSuccess?.()
      handleClose(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'A豆变更失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>变更副卡 A豆</DialogTitle>
          <DialogDescription>
            对副卡成员 {member?.username ?? ''} 发起 A豆增加或扣减，调用业管平台处理。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-3 text-sm">
            <span className="text-muted-foreground">当前 A豆余额</span>
            <span className="font-medium tabular-nums">
              {typeof member?.a_bean_balance === 'number'
                ? `${member.a_bean_balance.toLocaleString()} A豆`
                : member?.biz_mgmt_user_id
                  ? '未刷新'
                  : '未同步'}
            </span>
          </div>

          <div className="space-y-2">
            <Label>变更类型</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={changeType === 1}
                onClick={() => setChangeType(1)}
                disabled={loading}
                className={[
                  'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  changeType === 1
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent',
                ].join(' ')}
              >
                增加
              </button>
              <button
                type="button"
                aria-pressed={changeType === 2}
                onClick={() => setChangeType(2)}
                disabled={loading}
                className={[
                  'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  changeType === 2
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent',
                ].join(' ')}
              >
                扣减
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="points-num">A豆数量</Label>
            <div className="relative">
              <Input
                id="points-num"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="请输入数量（仅整数）"
                value={pointsNum}
                onChange={(e) => handlePointsNumChange(e.target.value)}
                disabled={loading}
                className="pr-12 tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                A豆
              </span>
            </div>
            {pointsNum !== '' && !pointsValid && (
              <p className="text-xs text-destructive">A豆数量必须是大于 0 的整数</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !pointsValid}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            确认变更
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
