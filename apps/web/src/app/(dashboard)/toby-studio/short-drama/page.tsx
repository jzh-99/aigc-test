import { Video } from 'lucide-react'

export default function ShortDramaPage() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border bg-card p-8 text-center">
      <Video className="mb-4 h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold tracking-normal">AI 短剧</h1>
      <p className="mt-2 text-sm text-muted-foreground">该模块待开发。</p>
    </div>
  )
}
