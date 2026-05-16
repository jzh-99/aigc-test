'use client'

import { useCallback } from 'react'
import { apiPost, ApiError, reportClientSubmissionError } from '@/lib/api-client'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { generateUUID } from '@/lib/utils'
import type { BatchResponse, GenerateImageRequest } from '@aigc/types'

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 将图片 URL 转为 base64 data URL。
 * TOS 预签名 URL 是第三方域名，浏览器直接 fetch 会触发 CORS，
 * 改为通过后端 /assets/fetch 接口代理读取（服务端直接走 TOS SDK，无跨域问题）。
 */
async function imageUrlToDataUrl(url: string): Promise<string> {
  // 判断是否为同源 URL（相对路径或同域），同源直接 fetch
  const isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin)
  let fetchUrl = url

  if (!isSameOrigin) {
    // 尝试从 TOS 预签名 URL 提取 storageKey，走后端代理绕过 CORS
    // TOS 预签名 URL 格式：https://<bucket>.tos-<region>.volces.com/<key>?X-Tos-...
    try {
      const parsed = new URL(url)
      if (parsed.hostname.includes('.volces.com') || parsed.hostname.includes('.volccdn.com')) {
        const key = parsed.pathname.replace(/^\//, '')
        if (key) {
          fetchUrl = `/api/v1/assets/fetch?key=${encodeURIComponent(key)}`
        }
      }
    } catch {
      // URL 解析失败，保持原 URL
    }
  }

  const token = useAuthStore.getState().accessToken
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
  const resp = await fetch(fetchUrl, { headers })
  if (!resp.ok) throw new Error('reference image fetch failed')
  const blob = await resp.blob()
  return fileToDataUrl(new File([blob], 'reference', { type: blob.type || 'image/jpeg' }))
}

export function useGenerate() {
  const { prompt, modelType, resolution, quantity, aspectRatio, referenceImages, watermark, setIsGenerating, setActiveBatchId } = useGenerationStore()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)

  const generate = useCallback(async (): Promise<BatchResponse | null> => {
    if (!prompt.trim()) return null

    let resolvedModel: string | undefined
    setIsGenerating(true)
    try {
      // 直接用 modelType（DB code）作为 model 发给后端
      // API 侧会根据 params.resolution 从 params_pricing 查实际调用的底层 model code
      const model = modelType
      resolvedModel = model

      const params: Record<string, unknown> = {
        aspect_ratio: aspectRatio,
        ...(model === 'gpt-image-2' ? {} : { resolution }),
        watermark,
      }

      if (referenceImages.length > 0) {
        params.image = await Promise.all(referenceImages.map(async (img) => {
          if (img.dataUrl) return img.dataUrl
          if (img.file) return fileToDataUrl(img.file)
          return imageUrlToDataUrl(img.previewUrl)
        }))
      }

      const body: GenerateImageRequest = {
        idempotency_key: generateUUID(),
        model,
        prompt: prompt.trim(),
        quantity,
        params,
        workspace_id: activeWorkspaceId ?? '',
      }

      const batch = await apiPost<BatchResponse>('/generate/image', body)
      setActiveBatchId(batch.id)
      return batch
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
      const normalized = rawMessage.toLowerCase()
      const errorCode =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'TIMEOUT'
          : /failed to fetch|fetch failed|networkerror|network request failed|load failed/.test(normalized)
            ? 'NETWORK_ERROR'
            : err instanceof SyntaxError
              ? 'PARSE_ERROR'
              : 'CLIENT_ERROR'

      void reportClientSubmissionError({
        error_code: errorCode,
        detail: rawMessage.slice(0, 500) || undefined,
        http_status: err instanceof ApiError ? err.status : null,
        model: resolvedModel,
      })
      if (err && typeof err === 'object') {
        ;(err as { __clientErrorReported?: boolean }).__clientErrorReported = true
      }
      throw err
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, modelType, resolution, quantity, aspectRatio, referenceImages, watermark, activeWorkspaceId, setIsGenerating, setActiveBatchId])

  return { generate }
}
