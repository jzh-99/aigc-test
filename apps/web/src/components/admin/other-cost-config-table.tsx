'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { apiPatch, ApiError } from '@/lib/api-client'
import type { SystemCostConfigItem } from '@aigc/types'

/** 大模型之外的费用配置 */
export function OtherCostConfigTable(): React.ReactElement {
  const { data, error, mutate } = useSWR<SystemCostConfigItem[]>('/admin/cost-configs')
  const isLoading = !data && !error

  return (
    <Card>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="py-4 text-center text-sm text-destructive">费用配置加载失败</p>
        ) : !data?.length ? (
          <p className="py-4 text-center text-sm text-muted-foreground">暂无费用配置</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">费用项</th>
                <th className="px-2 py-2 text-left font-medium">说明</th>
                <th className="px-2 py-2 text-left font-medium">Key</th>
                <th className="px-2 py-2 text-right font-medium">积分费用</th>
                <th className="px-2 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <CostConfigRow key={item.key} item={item} onSaved={mutate} />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

interface CostConfigRowProps {
  item: SystemCostConfigItem
  onSaved: () => void
}

function CostConfigRow({ item, onSaved }: CostConfigRowProps): React.ReactElement {
  const [creditCost, setCreditCost] = useState(String(item.credit_cost))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCreditCost(String(item.credit_cost))
  }, [item.credit_cost])

  const normalizedCost = Number(creditCost)
  const isDirty = creditCost.trim() !== String(item.credit_cost)
  const isInvalid = !Number.isInteger(normalizedCost) || normalizedCost < 0

  async function handleSave() {
    if (saving) return
    if (isInvalid) {
      toast.error('积分费用必须是非负整数')
      return
    }

    setSaving(true)
    try {
      await apiPatch(`/admin/cost-configs/${item.key}`, { credit_cost: normalizedCost })
      toast.success('保存成功')
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-2 font-medium">{item.label}</td>
      <td className="max-w-[260px] truncate px-2 py-2 text-muted-foreground" title={item.description ?? ''}>
        {item.description || <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-2 py-2 font-mono text-muted-foreground">{item.key}</td>
      <td className="px-2 py-2 text-right">
        <Input
          type="number"
          min={0}
          step={1}
          value={creditCost}
          onChange={(e) => setCreditCost(e.target.value)}
          className="ml-auto h-8 w-28 text-right text-xs"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={handleSave}
          disabled={saving || !isDirty || isInvalid}
          title="保存费用配置"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          保存
        </Button>
      </td>
    </tr>
  )
}
