'use client'

import useSWR from 'swr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { RotateCcw } from 'lucide-react'
import { apiPut, apiDelete, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'

// 模型配置项数据结构
interface TeamModelConfigItem {
  id: string
  code: string
  name: string
  module: string
  credit_cost: number
  is_active: boolean           // 全局默认值
  effective_is_active: boolean // 合并后的实际值（团队覆盖 > 全局默认）
  has_override: boolean        // 是否有团队级覆盖记录
}

interface TeamModelConfigProps {
  teamId: string
}

// module 中文标签映射
const MODULE_LABELS: Record<string, string> = {
  image: '图片模型',
  video: '视频模型',
  tts: 'TTS',
  lipsync: '口播',
  agent: 'Agent',
  avatar: '数字人',
  action_imitation: '动作模仿',
}

// 按 module 分组
function groupByModule(items: TeamModelConfigItem[]): Record<string, TeamModelConfigItem[]> {
  return items.reduce<Record<string, TeamModelConfigItem[]>>((acc, item) => {
    const key = item.module
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})
}

export function TeamModelConfig({ teamId }: TeamModelConfigProps): React.ReactElement {
  const { data, error, mutate } = useSWR<TeamModelConfigItem[]>(
    `/admin/teams/${teamId}/model-configs`
  )

  // 切换模型启用状态（乐观更新）
  async function handleToggle(model: TeamModelConfigItem, newValue: boolean): Promise<void> {
    // 乐观更新：先修改本地数据
    mutate(
      (prev) =>
        prev
          ? prev.map((m) =>
              m.id === model.id
                ? { ...m, effective_is_active: newValue, has_override: true }
                : m
            )
          : prev,
      false
    )
    try {
      await apiPut(`/admin/teams/${teamId}/model-configs/${model.id}`, {
        is_active: newValue,
      })
      // 成功后刷新确保数据一致
      mutate()
    } catch (err) {
      // 失败回滚
      mutate()
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    }
  }

  // 恢复全局默认（删除团队覆盖记录）
  async function handleRestore(model: TeamModelConfigItem): Promise<void> {
    try {
      await apiDelete(`/admin/teams/${teamId}/model-configs/${model.id}`)
      toast.success('已恢复全局默认')
      mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '恢复失败')
    }
  }

  // 加载中显示骨架屏
  if (!data && !error) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-destructive p-4">加载模型配置失败，请刷新重试</p>
    )
  }

  const items = data ?? []
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">暂无模型配置</p>
  }

  const grouped = groupByModule(items)
  // 按固定顺序排列 module
  const moduleOrder = ['image', 'video', 'tts', 'lipsync', 'agent', 'avatar', 'action_imitation']
  const sortedModules = [
    ...moduleOrder.filter((m) => grouped[m]),
    ...Object.keys(grouped).filter((m) => !moduleOrder.includes(m)),
  ]

  return (
    <div className="space-y-5 p-4">
      {sortedModules.map((module, idx) => (
        <div key={module}>
          {idx > 0 && <Separator className="mb-5" />}
          {/* 分组标题 */}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {MODULE_LABELS[module] ?? module}
          </h4>
          <div className="space-y-2">
            {grouped[module].map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                onToggle={handleToggle}
                onRestore={handleRestore}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// 单行模型配置展示，拆分子组件保持主组件简洁
interface ModelRowProps {
  model: TeamModelConfigItem
  onToggle: (model: TeamModelConfigItem, newValue: boolean) => Promise<void>
  onRestore: (model: TeamModelConfigItem) => Promise<void>
}

function ModelRow({ model, onToggle, onRestore }: ModelRowProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
      {/* 模型名称 + code */}
      <div className="flex-1 min-w-0">
        <span className="font-medium">{model.name}</span>
        <span className="ml-1.5 text-xs text-muted-foreground">{model.code}</span>
      </div>

      {/* 积分消耗 */}
      <span className="text-xs text-muted-foreground shrink-0">
        {model.credit_cost} 积分
      </span>

      {/* 已覆盖 Badge + 恢复默认按钮 */}
      {model.has_override && (
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 border-amber-400 text-amber-600"
          >
            已覆盖
          </Badge>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="恢复全局默认"
            onClick={() => onRestore(model)}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* 启用/禁用开关，显示合并后的实际值 */}
      <Switch
        checked={model.effective_is_active}
        onCheckedChange={(val) => onToggle(model, val)}
      />
    </div>
  )
}
