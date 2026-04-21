'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Coins } from 'lucide-react'
import { apiPost, ApiError } from '@/lib/api-client'
import useSWR from 'swr'
import { toast } from 'sonner'
import type { TopupPackage, CreateOrderResponse } from '@aigc/types'

interface TopupModalProps {
  open: boolean
  onClose: () => void
  teamId?: string
}

export function TopupModal({ open, onClose, teamId }: TopupModalProps) {
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const { data } = useSWR<{ data: TopupPackage[] }>(open ? '/payment/packages' : null)
  const packages = data?.data ?? []

  // Auto-select recommended package on load
  if (packages.length > 0 && !selected) {
    const recommended = packages.find((p) => p.tag === '推荐') ?? packages[0]
    setSelected(recommended.id)
  }

  async function handlePay() {
    if (!selected) return
    setLoading(true)
    try {
      const res = await apiPost<CreateOrderResponse>('/payment/orders', {
        package_id: selected,
        team_id: teamId,
      })
      window.location.href = res.pay_url
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建订单失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const pkg = packages.find((p) => p.id === selected)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-accent-orange" />
            {teamId ? '充值团队积分' : '充值个人积分'}
          </DialogTitle>
        </DialogHeader>

        {packages.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 py-2">
            {packages.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`relative rounded-lg border p-3 text-left transition-colors ${
                  selected === p.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {p.tag && (
                  <Badge className="absolute -top-2 right-2 text-[10px] px-1.5 py-0">
                    {p.tag}
                  </Badge>
                )}
                <div className="text-sm font-semibold">{p.credits.toLocaleString()} 积分</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  ¥{(p.amount_fen / 100).toFixed(2)}
                </div>
              </button>
            ))}
          </div>
        )}

        <Button onClick={handlePay} disabled={loading || !selected} className="w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {pkg ? `支付 ¥${(pkg.amount_fen / 100).toFixed(2)}` : '去支付'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
