import { getDb } from '@aigc/db'
import { randomUUID } from 'node:crypto'

// 画布上传临时目录
export const CANVAS_UPLOAD_DIR = '/tmp/canvas-uploads'

// 临时文件最大存活时间：10 分钟（足够外部存储拉取）
export const CANVAS_UPLOAD_MAX_AGE_MS = 10 * 60 * 1000

// 允许开启画布功能的团队类型
export const CANVAS_ENABLED_TEAM_TYPES = ['standard', 'avatar_enabled'] as const

// 安全的上传文件名正则（防路径穿越）
export const SAFE_CANVAS_ID = /^[\w-]+\.(jpg|jpeg|png|webp|gif|mp4|mov|webm)$/

/** 断言工作区所属团队已开通画布功能，否则抛出 CANVAS_DISABLED */
export async function assertCanvasEnabledForWorkspace(db: ReturnType<typeof getDb>, workspaceId: string) {
  const workspace = await db
    .selectFrom('workspaces')
    .innerJoin('teams', 'teams.id', 'workspaces.team_id')
    .select('teams.team_type')
    .where('workspaces.id', '=', workspaceId)
    .executeTakeFirst()

  if (!workspace || !CANVAS_ENABLED_TEAM_TYPES.includes(workspace.team_type as any)) {
    throw new Error('CANVAS_DISABLED')
  }
}

/** 查找用户在已开通画布功能的工作区中的成员关系，返回 workspace_id 或 null */
export async function resolveCanvasWorkspaceForUser(
  db: ReturnType<typeof getDb>,
  userId: string,
  workspaceId?: string,
): Promise<string | null> {
  let query = db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .innerJoin('teams', 'teams.id', 'workspaces.team_id')
    .select('workspace_members.workspace_id')
    .where('workspace_members.user_id', '=', userId)
    .where('teams.team_type', 'in', CANVAS_ENABLED_TEAM_TYPES)
    .orderBy('workspace_members.created_at', 'asc')
    .limit(1) as any

  if (workspaceId) query = query.where('workspace_members.workspace_id', '=', workspaceId)

  const membership = await query.executeTakeFirst()
  return membership?.workspace_id ?? null
}

/** 检查 S3 上传配置是否完整 */
export function hasS3UploadConfig(): boolean {
  return Boolean(
    process.env.STORAGE_ENDPOINT
    && process.env.STORAGE_ACCESS_KEY
    && process.env.STORAGE_SECRET_KEY
    && process.env.STORAGE_PUBLIC_URL
  )
}

/** 将外部存储返回的 URL 中的 host 替换为内网地址（如配置了 EXTERNAL_STORAGE_BASE） */
export function rewriteExternalStorageUrl(url: string): string {
  const base = process.env.EXTERNAL_STORAGE_BASE
  if (!base) return url
  try {
    const parsed = new URL(url)
    const internal = new URL(base)
    parsed.protocol = internal.protocol
    parsed.host = internal.host
    return parsed.toString()
  } catch {
    return url
  }
}

/** 先将文件写入本地临时目录，再通知外部存储服务拉取，返回最终存储 URL */
export async function uploadViaLocalTemp(fileId: string, mimeType: string): Promise<string> {
  const externalStorageUrl = process.env.EXTERNAL_STORAGE_URL
  if (!externalStorageUrl) throw new Error('上传存储服务未配置')

  const baseUrl = process.env.AI_UPLOAD_BASE_URL ?? process.env.INTERNAL_API_URL ?? ''
  const publicUrl = `${baseUrl}/api/v1/canvases/uploads/${fileId}`
  const fileType = mimeType.startsWith('video/') ? 'mp4' : 'jpg'

  const res = await fetch(externalStorageUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid: randomUUID(), url: publicUrl, type: fileType }),
  })

  if (!res.ok) throw new Error(`外部存储服务异常(${res.status})`)

  const payload = await res.json() as any
  if (payload?.code !== 10000 || !payload?.data?.url) {
    throw new Error(payload?.msg ?? '外部存储返回异常')
  }

  return rewriteExternalStorageUrl(payload.data.url)
}
