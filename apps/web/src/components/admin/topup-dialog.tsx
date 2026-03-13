'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TopupDialogProps {
  teamId: string | null
  teamName?: string
  currentBalance?: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type Mode = 'add' | 'deduct'

export function TopupDialog({ teamId, teamName, currentBalance, open, onOpenChange, onSuccess }: TopupDialogProps) {
  const [mode, setMode] = useState<Mode>('add')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!teamId || !amount) return
    const num = parseInt(amount, 10)
    if (isNaN(num) || num <= 0) {
      toast.error('请输入大于 0 的整数')
      return
    }

    const finalAmount = mode === 'deduct' ? -num : num

    if (mode === 'deduct' && currentBalance !== undefined && num > currentBalance) {
      toast.error(`扣减数量 (${num}) 超过当前余额 (${currentBalance})`)
      return
    }

    setLoading(true)
    try {
      await apiPost(`/admin/teams/${teamId}/credits`, {
        amount: finalAmount,
        description: description || undefined,
      })
      toast.success(mode === 'add' ? `已充值 ${num} 积分` : `已扣减 ${num} 积分`)
      onSuccess()
      onOpenChange(false)
      setAmount('')
      setDescription('')
      setMode('add')
    } catch (e: any) {
      toast.error(e?.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const num = parseInt(amount, 10)
  const validNum = !isNaN(num) && num > 0 ? num : 0
  const newBalance = currentBalance !== undefined
    ? (mode === 'add' ? currentBalance + validNum : currentBalance - validNum)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>调整积分{teamName ? ` — ${teamName}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {currentBalance !== undefined && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">当前余额</span>
              <span className="font-medium">{currentBalance.toLocaleString()}</span>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex rounded-md border overflow-hidden">
            <button
              type="button"
              className={cn(
                'flex-1 py-2 text-sm font-medium transition-colors',
                mode === 'add' ? 'bg-accent-blue text-white' : 'text-muted-foreground hover:bg-muted',
              )}
              onClick={() => setMode('add')}
            >
              充值
            </button>
            <button
              type="button"
              className={cn(
                'flex-1 py-2 text-sm font-medium transition-colors',
                mode === 'deduct' ? 'bg-red-500 text-white' : 'text-muted-foreground hover:bg-muted',
              )}
              onClick={() => setMode('deduct')}
            >
              扣减
            </button>
          </div>

          <div className="space-y-2">
            <Label>{mode === 'add' ? '充值数量' : '扣减数量'}</Label>
            <Input
              type="number"
              min="1"
              placeholder="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {newBalance !== null && validNum > 0 && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">操作后余额</span>
              <span className={cn('font-medium', newBalance < 0 ? 'text-destructive' : '')}>
                {newBalance.toLocaleString()}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label>备注（可选）</Label>
            <Input
              placeholder={mode === 'add' ? '充值原因' : '扣减原因'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant={mode === 'deduct' ? 'destructive' : 'default'}
            onClick={handleSubmit}
            disabled={loading || !amount}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {mode === 'add' ? '确认充值' : '确认扣减'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
