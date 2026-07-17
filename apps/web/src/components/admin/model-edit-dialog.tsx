'use client'

import { useEffect, useState } from 'react'
import { Loader2, Image as ImageIcon } from 'lucide-react'
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
import type { ModelItem, ParamsPricingRule } from '@aigc/types'

const MUSIC_PRICING_LABELS: Record<string, string> = {
  inspiration_song: '灵感模式生成歌曲',
  instrumental: '纯音乐',
  custom_song: '自定义模式生成歌曲',
}

interface ModelEditDialogProps {
  model: ModelItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 保存成功后回调，用于刷新列表 */
  onSaved: () => void
}

/** 编辑模型信息弹窗 */
export function ModelEditDialog({ model, open, onOpenChange, onSaved }: ModelEditDialogProps): React.ReactElement | null {
  const [description, setDescription] = useState('')
  const [avatar, setAvatar] = useState('')
  const [isActive, setIsActive] = useState(true)
  // 可编辑的定价规则列表，unit_price 允许修改
  const [pricingRules, setPricingRules] = useState<ParamsPricingRule[]>([])
  const [saving, setSaving] = useState(false)
  const isMusicModel = model?.module === 'music'
  const isAgentModel = model?.module === 'agent'

  // 每次打开弹窗时，将表单重置为当前模型数据
  useEffect(() => {
    if (model) {
      setDescription(model.description ?? '')
      setAvatar(model.avatar ?? '')
      setIsActive(model.is_active)
      // 深拷贝，避免直接修改原始数据
      setPricingRules(model.params_pricing.map((r) => ({ ...r })))
    }
  }, [model])

  /** 更新某条定价规则的 unit_price */
  function handleUnitPriceChange(index: number, value: string) {
    setPricingRules((prev) =>
      prev.map((rule, i) =>
        i === index ? { ...rule, unit_price: Number(value) } : rule,
      ),
    )
  }

  async function handleSubmit() {
    if (!model) return

    // 校验所有 unit_price 必须为非负数
    const hasInvalidPrice = pricingRules.some((r) => isNaN(r.unit_price) || r.unit_price < 0)
    if (hasInvalidPrice) {
      toast.error('A豆单价必须为非负数')
      return
    }

    setSaving(true)
    try {
      await apiPatch(`/admin/models/${model.id}`, {
        description: description.trim() || null,
        avatar: avatar.trim() || null,
        is_active: isActive,
        params_pricing: pricingRules,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑模型</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 模型名称：只读展示 */}
          <div className="space-y-1.5">
            <Label htmlFor="model-name">模型名称</Label>
            <Input
              id="model-name"
              value={model?.name ?? ''}
              disabled
              className="cursor-not-allowed opacity-60"
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

          {/* 模型图标 avatar */}
          <div className="space-y-1.5">
            <Label htmlFor="model-avatar">模型图标 URL</Label>
            <div className="flex items-center gap-2">
              <Input
                id="model-avatar"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="TOS 存储地址，如 https://.../assets/llm/openai.png"
              />
              {avatar.trim() && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar}
                  alt="图标预览"
                  className="h-9 w-9 shrink-0 rounded object-contain ring-1 ring-border"
                />
              )}
              {!avatar.trim() && <ImageIcon className="h-9 w-9 shrink-0 text-muted-foreground" />}
            </div>
          </div>

          {/* 定价规则 */}
          {pricingRules.length > 0 && (
            <div className="space-y-2">
              <Label>
                {isMusicModel
                  ? '音乐模式定价（A豆/次）'
                  : isAgentModel
                    ? '千字定价（A豆/千字）'
                    : `分辨率定价（${model?.module === 'video' ? 'A豆/秒' : 'A豆/张'}）`}
              </Label>
              {/* 表头 */}
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground px-1">
                <span>底层模型</span>
                <span>{isMusicModel ? '业务模式' : isAgentModel ? '规格' : '分辨率'}</span>
                <span>A豆单价</span>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {pricingRules.map((rule, index) => (
                  <div key={`${rule.model}-${rule.resolution}`} className="grid grid-cols-3 gap-2 items-center">
                    {/* 底层模型 code：只读 */}
                    <Input
                      value={rule.model}
                      disabled
                      className="cursor-not-allowed opacity-60 text-xs h-8"
                    />
                    {/* 分辨率/规格：只读 */}
                    <Input
                      value={isMusicModel ? MUSIC_PRICING_LABELS[rule.resolution] ?? rule.resolution : rule.resolution}
                      disabled
                      className="cursor-not-allowed opacity-60 text-xs h-8"
                    />
                    {/* A豆单价：可编辑 */}
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={rule.unit_price}
                      onChange={(e) => handleUnitPriceChange(index, e.target.value)}
                      className="text-xs h-8"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
