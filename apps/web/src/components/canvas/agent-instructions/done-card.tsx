'use client'

interface Props {
  onContinue?: () => void
}

export function DoneCard({ onContinue }: Props) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-green-500">✓</span>
        <span className="font-medium text-foreground">工作流已全部完成</span>
      </div>
      <p className="text-xs text-muted-foreground">
        你可以点击任意节点查看输出，或继续描述需求扩展流程。
      </p>
    </div>
  )
}
