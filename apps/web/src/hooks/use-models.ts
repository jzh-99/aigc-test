'use client'

import useSWR from 'swr'
import type { AigcModule, ModelItem } from '@aigc/types'

/** API 响应结构 */
interface ModelsResponse {
  data: ModelItem[]
}

/**
 * 获取模型列表
 * @param module 可选，按模块过滤（image/video/tts 等）
 * @returns models 列表、加载状态、错误信息
 */
export function useModels(module?: AigcModule) {
  // 根据是否传入 module 决定请求 URL
  const url = module ? `/models?module=${module}` : '/models'

  const { data, isLoading, error } = useSWR<ModelsResponse>(url, {
    revalidateOnFocus: false, // 高频接口，避免切换标签页时频繁请求
  })

  return {
    models: data?.data ?? [],
    isLoading,
    error,
  }
}
