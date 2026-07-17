'use client'

import { useEffect, useState } from 'react'
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

const loadedIconUrls = new Set<string>()
const loadingIconUrls = new Map<string, Promise<void>>()

const LOCAL_MODEL_ICON_BY_FAMILY = {
  nanoBanana: '/images/nanoBanana.png',
  openai: '/images/openai.png',
  volcengine: '/images/volcengine.png',
} as const

function getLocalModelIconSrc(modelCode: string): string | null {
  const code = modelCode.toLowerCase()

  if (
    code.includes('seedream')
    || code.includes('seedance')
    || code.includes('jimeng')
    || code.includes('volc')
  ) {
    return LOCAL_MODEL_ICON_BY_FAMILY.volcengine
  }

  if (
    code.includes('gemini')
    || code.includes('banana')
    || code.includes('nano')
  ) {
    return LOCAL_MODEL_ICON_BY_FAMILY.nanoBanana
  }

  if (
    code.includes('gpt')
    || code.includes('openai')
  ) {
    return LOCAL_MODEL_ICON_BY_FAMILY.openai
  }

  return null
}

function resolveModelBrandIconSrc(modelCode: string, avatar?: string | null): string | null {
  return getLocalModelIconSrc(modelCode) ?? avatar ?? null
}

export function preloadModelBrandIcon(src?: string | null): Promise<void> | undefined {
  if (!src || loadedIconUrls.has(src)) return undefined
  const loading = loadingIconUrls.get(src)
  if (loading) return loading

  const promise = new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      loadedIconUrls.add(src)
      loadingIconUrls.delete(src)
      resolve()
    }
    image.onerror = () => {
      loadingIconUrls.delete(src)
      resolve()
    }
    image.src = src
  })

  loadingIconUrls.set(src, promise)
  return promise
}

export function preloadModelBrandIcons(models?: Array<{ code: string; avatar?: string | null }>): void {
  models?.forEach((model) => {
    void preloadModelBrandIcon(resolveModelBrandIconSrc(model.code, model.avatar))
  })
}

/**
 * 模型图标渲染：
 * 1. 有 avatar → 渲染 <img>，加载失败回退占位图标（避免裂图）
 * 2. 无 avatar → 渲染统一占位图标（lucide Sparkles）
 */
export function ModelBrandIcon({ avatar, modelCode, size, className }: ModelBrandIconProps): React.ReactElement {
  const [imgError, setImgError] = useState(false)
  const iconSrc = resolveModelBrandIconSrc(modelCode, avatar)
  const [isLoaded, setIsLoaded] = useState(() => Boolean(iconSrc && loadedIconUrls.has(iconSrc)))

  useEffect(() => {
    setImgError(false)
    setIsLoaded(Boolean(iconSrc && loadedIconUrls.has(iconSrc)))
    if (!iconSrc || loadedIconUrls.has(iconSrc)) return

    let cancelled = false
    void preloadModelBrandIcon(iconSrc)?.then(() => {
      if (!cancelled) setIsLoaded(loadedIconUrls.has(iconSrc))
    })

    return () => {
      cancelled = true
    }
  }, [iconSrc])

  if (iconSrc && !imgError) {
    return (
      <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        {!isLoaded && (
          <Sparkles
            style={{ width: size * 0.55, height: size * 0.55 }}
            className={cn('text-muted-foreground/60', className)}
          />
        )}
        <img
          src={iconSrc}
          alt={modelCode}
          width={size}
          height={size}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          onLoad={() => {
            loadedIconUrls.add(iconSrc)
            setIsLoaded(true)
          }}
          onError={() => setImgError(true)}
          className={cn(
            'absolute inset-0 object-contain transition-opacity duration-150',
            isLoaded ? 'opacity-100' : 'opacity-0',
            className,
          )}
          style={{ width: size, height: size }}
        />
      </span>
    )
  }

  return <Sparkles style={{ width: size, height: size }} className={cn('text-muted-foreground', className)} />
}
