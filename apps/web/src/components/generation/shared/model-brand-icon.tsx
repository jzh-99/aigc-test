'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelBrandIconProps {
  /** 模型图标 URL（已签名）。无值时显示占位图标 */
  avatar?: string | null
  /** 模型 code，用于 <img alt> 无障碍标签 */
  modelCode: string
  size: number
  className?: string
}

/**
 * 模型图标渲染：
 * 1. 有 avatar → 渲染 <img>，加载失败回退占位图标（避免裂图）
 * 2. 无 avatar → 渲染统一占位图标（lucide Sparkles）
 */
export function ModelBrandIcon({ avatar, modelCode, size, className }: ModelBrandIconProps): React.ReactElement {
  const [imgError, setImgError] = useState(false)

  if (avatar && !imgError) {
    return (
      <img
        src={avatar}
        alt={modelCode}
        width={size}
        height={size}
        onError={() => setImgError(true)}
        className={cn('object-contain', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return <Sparkles style={{ width: size, height: size }} className={cn('text-muted-foreground', className)} />
}
