'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiPatch, ApiError } from '@/lib/api-client'
import type { ModelItem } from '@aigc/types'

interface ModelEditDialogProps {
  model: ModelItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 保存成功后回调，用于刷新列表 */
  onSaved: () => void
}

/** 编辑模型信息弹窗 */
export function ModelEditDialog({ model, open, onOpenChange, onSaved }: ModelEditDialogProps): React.ReactElement | null {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creditCost, setCreditCost] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  // 每次打开弹窗时，将表单重置为当前模型数据
  useEffect(() => {
    if (model) {
      setName(model.name)
      setDescription(model.description ?? '')
      setCreditCost(String(model.credit_cost))
      setIsActive(model.is_active)
    }
  }, [model])

  async function handleSubmit() {
    if (!model) return

    const parsedCost = Number(creditCost)
    if (isNaN(parsedCost) || parsedCost < 0) {
      toast.error('积分消耗必须为非负数')
      return
    }

    setSaving(true)
    try {
      await apiPatch(`/admin/models/${model.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        credit_cost: parsedCost,
        is_active: isActive,
      })
      toast.success('保存成功')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>编辑模型</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 模型名称 */}
          <div className="space-y-1.5">
            <Label htmlFor="model-name">模型名称</Label>
            <Input
              id="model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入模型名称"
            />
          </div>

          {/* 模型描述 */}
          <div className="space-y-1.5">
            <Label htmlFor="model-description">描述</Label>
            <Textarea
              id="model-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="请输入模型描述（选填）"
              rows={3}
              className="resize-none"
            />
          </div>

          {/* 积分消耗 */}
          <div className="space-y-1.5">
            <Label htmlFor="credit-cost">积分消耗</Label>
            <Input
              id="credit-cost"
              type="number"
              min={0}
              value={creditCost}
              onChange={(e) => setCreditCost(e.target.value)}
              placeholder="请输入积分消耗"
            />
          </div>

          {/* 是否启用 */}
          <div className="flex items-center justify-between">
            <Label htmlFor="is-active">是否启用</Label>
            <Switch
              id="is-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
