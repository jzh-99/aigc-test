'use client'

import { useRef, useState, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { uploadAssetFile, createNodeOutput } from '@/lib/canvas/canvas-api'
import { toast } from 'sonner'

/**
 * 封装节点文件上传完整流程：
 * 文件选择 → 上传到对象存储 → 持久化到 canvas_node_outputs → 写入 execution store
 * 上传属于替换操作：节点已有输出时直接替换，保证节点始终只显示最新上传的素材
 *
 * @param nodeId   - 当前节点 ID
 * @param canvasId - 画布 ID，用于持久化输出记录
 * @param accept   - input[accept] 属性，限制可选文件类型
 */
export function useNodeUpload(nodeId: string, canvasId: string, accept: string) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const token = useAuthStore((s) => s.accessToken)
  const replaceNodeOutput = useCanvasExecutionStore((s) => s.replaceNodeOutput)

  const triggerUpload = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ''

      if (!token) {
        toast.error('请先登录')
        return
      }

      setUploading(true)
      try {
        const url = await uploadAssetFile(file, token)
        // 后端已做 upsert：有 is_selected 记录则替换，无则新增
        const id = await createNodeOutput(canvasId, nodeId, url, token)
        const type = file.type.startsWith('video/') ? 'video' : 'image'
        // 上传是替换操作，覆盖节点当前输出
        replaceNodeOutput(nodeId, { id, url, type })
        toast.success('上传成功')
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '上传失败'
        toast.error(message)
      } finally {
        setUploading(false)
      }
    },
    [nodeId, canvasId, token, replaceNodeOutput],
  )

  return { inputRef, uploading, triggerUpload, handleChange }
}
