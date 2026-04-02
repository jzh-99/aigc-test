'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ImagePlus, Sparkles } from 'lucide-react'

export function QuickGenerate() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full gradient-accent">
          <ImagePlus className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="font-medium">开始创作</p>
          <p className="text-sm text-muted-foreground mt-1">
            使用 AI 生成精美图片
          </p>
        </div>
        <Button variant="gradient" className="gap-2 mt-2" asChild>
          <Link href="/generation">
            <Sparkles className="h-4 w-4" />
            立即生成
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
