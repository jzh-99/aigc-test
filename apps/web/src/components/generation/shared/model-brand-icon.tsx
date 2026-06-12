'use client'

import { ModelIcon, ProviderIcon } from '@lobehub/icons'
import { getModelDirectIcon, getModelIconProvider } from '@/lib/model-images'

interface ModelBrandIconProps {
  modelCode: string
  providerCode?: string
  size: number
}

/** 模型图标：直接图标 > ProviderIcon 映射 > ModelIcon 自动匹配 */
export function ModelBrandIcon({ modelCode, providerCode, size }: ModelBrandIconProps) {
  const DirectIcon = getModelDirectIcon(modelCode)
  if (DirectIcon) return <DirectIcon size={size} />

  const mappedProvider = getModelIconProvider(modelCode, providerCode)
  if (mappedProvider) return <ProviderIcon provider={mappedProvider} size={size} />

  return <ModelIcon model={modelCode} size={size} />
}
