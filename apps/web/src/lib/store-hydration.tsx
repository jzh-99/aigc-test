'use client'

import { useEffect } from 'react'
import { useGenerationStore } from '@/stores/generation-store'

/**
 * 在客户端 mount 后触发 persist store 的手动 rehydrate。
 * 必须在客户端组件里调用，不能在服务端执行，否则会读不到 localStorage。
 */
export function StoreHydration() {
  useEffect(() => {
    useGenerationStore.persist.rehydrate()
  }, [])

  return null
}
