import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export function StudioReturnBar() {
  return (
    <div className="sticky top-[-1rem] z-30 flex h-16 items-center border-b bg-card/95 px-5 backdrop-blur md:top-[-1.5rem] md:px-8 dark:bg-card/95">
      <Link href="/toby-studio" className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        返回列表
      </Link>
    </div>
  )
}
