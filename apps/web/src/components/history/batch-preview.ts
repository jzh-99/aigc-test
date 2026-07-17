type PreviewAssetType = 'image' | 'video' | 'audio'

interface PreviewTask {
  status: string
  asset: {
    type?: PreviewAssetType
    storage_url?: string | null
    original_url?: string | null
  } | null
}

interface PreviewBatch {
  tasks?: PreviewTask[]
  thumbnail_urls?: string[]
  resources?: Array<{ url: string; type: PreviewAssetType }>
}

function getAssetUrl(task: PreviewTask): string | null {
  return task.asset?.storage_url ?? task.asset?.original_url ?? null
}

export function getBatchImagePreviewUrls(batch: PreviewBatch): string[] {
  // 优先使用 resources 中的图片 URL
  if (batch.resources && batch.resources.length > 0) {
    const imageUrls = batch.resources
      .filter((r) => r.type === 'image')
      .map((r) => r.url)
    if (imageUrls.length > 0) return imageUrls
  }

  // 回退到 tasks
  return (batch.tasks ?? [])
    .filter((task) => task.status === 'completed' && task.asset?.type === 'image')
    .map(getAssetUrl)
    .filter((url): url is string => Boolean(url))
}

export function getBatchVideoPreviewUrl(batch: PreviewBatch): string | undefined {
  // 优先使用 resources 中的视频 URL
  if (batch.resources && batch.resources.length > 0) {
    const videoUrl = batch.resources.find((r) => r.type === 'video')?.url
    if (videoUrl) return videoUrl
  }

  // 回退到 tasks
  return (batch.tasks ?? [])
    .filter((task) => task.status === 'completed' && task.asset?.type === 'video')
    .map(getAssetUrl)
    .find((url): url is string => Boolean(url))
}

/**
 * 获取批次的资源类型列表（去重，按出现顺序）
 * 优先从 resources 字段提取，否则从 completed tasks 的 asset.type 推导
 */
export function getBatchResourceTypes(batch: PreviewBatch): PreviewAssetType[] {
  // 优先使用 resources
  if (batch.resources && batch.resources.length > 0) {
    const seen = new Set<PreviewAssetType>()
    const types: PreviewAssetType[] = []
    for (const r of batch.resources) {
      if (!seen.has(r.type)) {
        seen.add(r.type)
        types.push(r.type)
      }
    }
    return types
  }

  // 回退到 tasks
  const seen = new Set<PreviewAssetType>()
  const types: PreviewAssetType[] = []
  for (const task of batch.tasks ?? []) {
    if (task.status === 'completed' && task.asset?.type) {
      if (!seen.has(task.asset.type)) {
        seen.add(task.asset.type)
        types.push(task.asset.type)
      }
    }
  }
  return types
}
