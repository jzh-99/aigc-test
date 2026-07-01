'use client'

import { useCallback } from 'react'
import { apiPost, ApiError, reportClientSubmissionError } from '@/lib/api-client'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { generateUUID } from '@/lib/utils'
import { validateImageReferencesForModel } from '@/lib/image-categories'
import type { BatchResponse, GenerateImageRequest } from '@aigc/types'

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function getReusableReferenceUrls(referenceImages: Array<{ file?: File; previewUrl: string; dataUrl?: string }>): string[] {
  return referenceImages
    .filter((img) => !img.file && !img.previewUrl.startsWith('blob:') && !img.previewUrl.startsWith('data:'))
    .map((img) => img.previewUrl)
}

async function resolveReferenceImagePayload(img: { file?: File; previewUrl: string; dataUrl?: string }): Promise<string> {
  if (img.file) return fileToDataUrl(img.file)
  if (img.dataUrl?.startsWith('data:')) return img.dataUrl
  return img.previewUrl
}

export function useGenerate() {
  const { prompt, modelType, resolution, quantity, aspectRatio, referenceImages, watermark, imageModels, setIsGenerating, setActiveBatchId } = useGenerationStore()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)

  const generate = useCallback(async (overridePrompt?: string): Promise<BatchResponse | null> => {
    const finalPrompt = (overridePrompt ?? prompt).trim()
    if (!finalPrompt) return null

    let resolvedModel: string | undefined
    const model = modelType
    const currentModel = imageModels.find((item) => item.code === model)
    const limitResult = validateImageReferencesForModel(currentModel, referenceImages.length)
    if (!limitResult.valid) {
      throw new Error(limitResult.message ?? '参考图数量不符合当前模型限制')
    }

    setIsGenerating(true)
    try {
      // 直接用 modelType（DB code）作为 model 发给后端
      // API 侧会根据 params.resolution 从 params_pricing 查实际调用的底层 model code
      resolvedModel = model

      const params: Record<string, unknown> = {
        aspect_ratio: aspectRatio,
        resolution,
        watermark,
      }

      if (referenceImages.length > 0) {
        const reusableReferenceUrls = getReusableReferenceUrls(referenceImages)
        if (reusableReferenceUrls.length > 0) {
          params.reference_image_urls = reusableReferenceUrls
        }
        params.image = await Promise.all(referenceImages.map(async (img) => {
          return resolveReferenceImagePayload(img)
        }))
      }

      const body: GenerateImageRequest = {
        idempotency_key: generateUUID(),
        model,
        prompt: finalPrompt,
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
  }, [prompt, modelType, resolution, quantity, aspectRatio, referenceImages, watermark, imageModels, activeWorkspaceId, setIsGenerating, setActiveBatchId])

  return { generate }
}
