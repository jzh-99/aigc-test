'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Edit2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ModelEditDialog } from './model-edit-dialog'
import { cn } from '@/lib/utils'
import type { AigcModule, ModelItem } from '@aigc/types'

/** 模块 tab 配置 */
const MODULE_TABS: { key: AigcModule; label: string }[] = [
  { key: 'image', label: '图片模型' },
  { key: 'video', label: '视频模型' },
  // { key: 'avatar', label: '数字人' },
  // { key: 'action_imitation', label: '动作模仿' },
]

/** 全局模型列表，按 module 分 tab 展示 */
export function ModelTable(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<AigcModule>('image')
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null)

  const { data, error, mutate } = useSWR<ModelItem[]>(
    `/admin/models?module=${activeTab}`
  )

    console.log('data: ', data);
  const models = data ?? []
  console.log('models: ', models);
  const isLoading = !data && !error

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {/* Tab 切换栏 */}
          <div className="flex gap-1 px-4 pt-3 border-b overflow-x-auto">
            {MODULE_TABS.map((tab) => (
              <button
                key={tab.key}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors whitespace-nowrap',
                  activeTab === tab.key
                    ? 'border-accent-blue text-accent-blue'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 表格内容区 */}
          <div className="p-4">
            {isLoading ? (
              <ModelSkeleton />
            ) : models.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">暂无模型</p>
            ) : (
              <ModelList models={models} onEdit={setEditingModel} />
            )}
          </div>
        </CardContent>
      </Card>

      {/* 编辑弹窗 */}
      <ModelEditDialog
        model={editingModel}
        open={!!editingModel}
        onOpenChange={(open) => !open && setEditingModel(null)}
        onSaved={() => mutate()}
      />
    </>
  )
}

/** 加载骨架屏 */
function ModelSkeleton(): React.ReactElement {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

interface ModelListProps {
  models: ModelItem[]
  onEdit: (model: ModelItem) => void
}

/** 模型数据表格 */
function ModelList({ models, onEdit }: ModelListProps): React.ReactElement {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="text-left py-2 px-2 font-medium">模型名称</th>
          <th className="text-left py-2 px-2 font-medium">描述</th>
          <th className="text-left py-2 px-2 font-medium">Code</th>
          <th className="text-left py-2 px-2 font-medium">提供商</th>
          <th className="text-right py-2 px-2 font-medium">积分消耗</th>
          <th className="text-left py-2 px-2 font-medium">状态</th>
          <th className="text-right py-2 px-2 font-medium">操作</th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => (
          <tr key={model.id} className="border-b last:border-0">
            <td className="py-2 px-2 font-medium">{model.name}</td>
            <td className="py-2 px-2 text-muted-foreground max-w-[160px] truncate" title={model.description ?? ''}>
              {model.description || <span className="text-muted-foreground/40">—</span>}
            </td>
            <td className="py-2 px-2 text-muted-foreground font-mono">{model.code}</td>
            <td className="py-2 px-2 text-muted-foreground">{model.provider_code}</td>
            <td className="py-2 px-2 text-right">{model.credit_cost.toLocaleString()}</td>
            <td className="py-2 px-2">
              <Badge
                variant={model.is_active ? 'success' : 'outline'}
                className="text-[10px]"
              >
                {model.is_active ? '启用' : '禁用'}
              </Badge>
            </td>
            <td className="py-2 px-2 text-right">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="编辑模型"
                onClick={() => onEdit(model)}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
