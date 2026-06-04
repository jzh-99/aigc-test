import { getDb } from '@aigc/db'
import type { ShortDramaBatchExport, ShortDramaMentionRef, ShortDramaSegment, ShortDramaState } from '@aigc/types'
import { normalizeShortDramaState } from '@aigc/types'
import type { Redis } from 'ioredis'
import { acquireRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'

// ============================================================================
// Constants
// ============================================================================

export const SHORT_DRAMA_SOURCE_MODULE = 'toby_studio'
export const SHORT_DRAMA_SOURCE_FEATURE = 'short_drama'
export const SHORT_DRAMA_EXPORT_QUEUE = 'short-drama-export-queue'
export const SHORT_DRAMA_EXPORT_COST_KEY = 'short_drama_episode_export_credits'

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * 从 AI 返回的文本中提取 JSON 对象
 * 支持 fenced code block 格式（```json\n{...}\n```）和普通 JSON
 * @param raw - AI 返回的原始文本
 * @returns 解析后的 JSON 对象
 * @throws 如果无法解析有效的 JSON
 */
export function extractShortDramaJsonObject(raw: string): Record<string, unknown> {
  try {
    // 尝试提取 fenced code block 中的 JSON
    const fencedMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
    if (fencedMatch) {
      const jsonStr = fencedMatch[1].trim()
      const parsed = JSON.parse(jsonStr)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    }

    // 尝试直接提取 JSON 对象
    const objectMatch = raw.match(/\{[\s\S]*\}/)
    if (objectMatch) {
      const parsed = JSON.parse(objectMatch[0])
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    }

    throw new Error('未找到有效的 JSON 对象')
  } catch (error) {
    throw new Error('AI 返回格式错误，请重试')
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * 校验短剧集数是否在允许范围内
 * @param value - 待校验的集数
 * @returns 校验通过的集数
 * @throws 如果集数不在 1-50 范围内或不是整数
 */
export function validateShortDramaEpisodeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('集数必须是整数')
  }

  if (value < 1 || value > 50) {
    throw new Error('集数必须在 1 到 50 之间')
  }

  return value
}

/**
 * 校验短剧时长是否在模型支持的档位中
 * @param durationSeconds - 待校验的时长（秒）
 * @param allowedDurations - 模型支持的时长档位列表
 * @throws 如果时长不在支持的档位中
 */
export function validateShortDramaDuration(
  durationSeconds: number,
  allowedDurations: number[]
): void {
  if (!allowedDurations.includes(durationSeconds)) {
    throw new Error(
      `当前模型不支持 ${durationSeconds} 秒时长，支持的时长为：${allowedDurations.join('、')} 秒`
    )
  }
}

// ============================================================================
// Credits Calculation
// ============================================================================

/**
 * 计算短剧文本生成所需积分
 * 按每 1000 字向上取整，最低 1 积分
 * @param outputChars - 输出字符数
 * @param creditsPerThousandChars - 每千字所需积分
 * @returns 所需积分数
 */
export function calculateShortDramaTextCredits(
  outputChars: number,
  creditsPerThousandChars: number
): number {
  if (outputChars <= 0) {
    return 1
  }

  const credits = Math.ceil(outputChars / 1000) * creditsPerThousandChars
  return Math.max(1, credits)
}

// ============================================================================
// Source Metadata
// ============================================================================

/**
 * 生成短剧资产的 source metadata
 * 用于资产和历史记录的模块隔离
 */
export function makeShortDramaSourceMetadata(input: {
  projectId: string
  episodeId?: string
  segmentId?: string
}): {
  source_module: string
  source_feature: string
  source_project_id: string
  source_episode_id: string | null
  source_segment_id: string | null
} {
  return {
    source_module: SHORT_DRAMA_SOURCE_MODULE,
    source_feature: SHORT_DRAMA_SOURCE_FEATURE,
    source_project_id: input.projectId,
    source_episode_id: input.episodeId ?? null,
    source_segment_id: input.segmentId ?? null,
  }
}

// ============================================================================
// Export State
// ============================================================================

function resolveBatchStatus(batch: ShortDramaBatchExport): ShortDramaBatchExport['status'] {
  if (batch.exports.length === 0) return 'failed'
  if (batch.exports.some(item => item.status === 'pending')) return 'pending'
  if (batch.exports.some(item => item.status === 'exporting')) return 'exporting'
  if (batch.exports.every(item => item.status === 'completed')) return 'completed'
  if (batch.exports.every(item => item.status === 'completed' || item.status === 'failed')) return 'failed'
  return batch.status
}

/**
 * 当某集片段视频发生变化或重新提交导出时，移除该集旧导出结果，避免旧 URL 继续可下载。
 * 多集批量导出中只剔除当前集，保留其它集的导出状态。
 */
export function invalidateShortDramaEpisodeExports(state: ShortDramaState, episodeNumber: number): void {
  const now = new Date().toISOString()
  state.exports.batches = state.exports.batches
    .map(batch => {
      if (!batch.episodeNumbers.includes(episodeNumber)) return batch

      const nextExports = batch.exports.filter(item => item.episodeNumber !== episodeNumber)
      const nextEpisodeNumbers = batch.episodeNumbers.filter(num => num !== episodeNumber)

      return {
        ...batch,
        episodeNumbers: nextEpisodeNumbers,
        exports: nextExports,
        status: resolveBatchStatus({ ...batch, episodeNumbers: nextEpisodeNumbers, exports: nextExports }),
        updatedAt: now,
      }
    })
    .filter(batch => batch.episodeNumbers.length > 0 && batch.exports.length > 0)
}

export function markShortDramaSegmentVideoGenerating(
  state: ShortDramaState,
  episodeNumber: number,
  segmentId: string,
  batchId: string,
  taskId: string,
): boolean {
  const episode = state.episodes.items.find(item => item.episodeNumber === episodeNumber)
  if (!episode) return false

  const segment = episode.segments.find(item => item.id === segmentId)
  if (!segment) return false

  const now = new Date().toISOString()
  segment.videoUrl = null
  segment.status = 'generating'
  segment.videoBatchId = batchId
  segment.videoTaskId = taskId
  episode.status = 'generating'
  episode.updatedAt = now
  state.episodes.status = 'generating'
  invalidateShortDramaEpisodeExports(state, episodeNumber)

  return true
}

export interface ShortDramaSegmentStateRow {
  episodeNumber: number
  segmentId: string
  orderIndex: number
  title: string
  prompt: string
  mentionRefs: ShortDramaMentionRef[]
  durationSeconds: number
  status: ShortDramaSegment['status']
  videoUrl: string | null
  videoBatchId: string | null
  videoTaskId: string | null
  updatedAt: string | Date
}

function parseMentionRefs(value: unknown): ShortDramaMentionRef[] {
  if (Array.isArray(value)) return value as ShortDramaMentionRef[]
  if (typeof value !== 'string') return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as ShortDramaMentionRef[] : []
  } catch {
    return []
  }
}

export function applyShortDramaSegmentRowsToState(
  state: ShortDramaState,
  rows: ShortDramaSegmentStateRow[],
): ShortDramaState {
  const rowsByKey = new Map(rows.map(row => [`${row.episodeNumber}:${row.segmentId}`, row]))

  for (const episode of state.episodes.items) {
    let hasGenerating = false
    let hasFailed = false
    let allCompleted = episode.segments.length > 0

    episode.segments = episode.segments
      .map((segment) => {
        const row = rowsByKey.get(`${episode.episodeNumber}:${segment.id}`)
        const nextSegment = row
          ? {
              ...segment,
              order: row.orderIndex,
              title: row.title,
              prompt: row.prompt,
              mentionRefs: row.mentionRefs,
              durationSeconds: row.durationSeconds,
              status: row.status,
              videoUrl: row.videoUrl,
              videoBatchId: row.videoBatchId,
              videoTaskId: row.videoTaskId,
            }
          : segment

        if (nextSegment.status === 'pending' || nextSegment.status === 'generating') hasGenerating = true
        if (nextSegment.status === 'failed') hasFailed = true
        if (nextSegment.status !== 'completed') allCompleted = false

        return nextSegment
      })
      .sort((a, b) => a.order - b.order)

    if (hasGenerating) {
      episode.status = 'generating'
    } else if (allCompleted) {
      episode.status = 'completed'
    } else if (hasFailed) {
      episode.status = 'failed'
    }
  }

  const hasEpisodeGenerating = state.episodes.items.some(episode => episode.status === 'generating')
  const allEpisodesCompleted = state.episodes.items.length > 0 &&
    state.episodes.items.every(episode => episode.status === 'completed')
  const hasEpisodeFailed = state.episodes.items.some(episode => episode.status === 'failed')
  state.episodes.status = allEpisodesCompleted
    ? 'completed'
    : hasEpisodeGenerating
      ? 'generating'
      : hasEpisodeFailed
        ? 'failed'
        : state.episodes.status

  return state
}

export async function listShortDramaSegmentRows(projectId: string): Promise<ShortDramaSegmentStateRow[]> {
  const rows = await getDb()
    .selectFrom('short_drama_segments')
    .select([
      'episode_number',
      'segment_id',
      'order_index',
      'title',
      'prompt',
      'mention_refs',
      'duration_seconds',
      'status',
      'video_url',
      'video_batch_id',
      'video_task_id',
      'updated_at',
    ])
    .where('project_id', '=', projectId)
    .orderBy('episode_number', 'asc')
    .orderBy('order_index', 'asc')
    .execute()

  return rows.map(row => ({
    episodeNumber: row.episode_number,
    segmentId: row.segment_id,
    orderIndex: row.order_index,
    title: row.title,
    prompt: row.prompt,
    mentionRefs: parseMentionRefs(row.mention_refs),
    durationSeconds: row.duration_seconds,
    status: row.status,
    videoUrl: row.video_url,
    videoBatchId: row.video_batch_id,
    videoTaskId: row.video_task_id,
    updatedAt: row.updated_at,
  }))
}

export async function syncShortDramaSegmentsFromState(projectId: string, state: ShortDramaState): Promise<void> {
  const values = state.episodes.items.flatMap(episode =>
    episode.segments.map(segment => ({
      project_id: projectId,
      episode_number: episode.episodeNumber,
      segment_id: segment.id,
      order_index: segment.order,
      title: segment.title,
      prompt: segment.prompt,
      mention_refs: JSON.stringify(segment.mentionRefs ?? []),
      duration_seconds: segment.durationSeconds,
      status: segment.status,
      video_url: segment.videoUrl ?? null,
      video_batch_id: segment.videoBatchId ?? null,
      video_task_id: segment.videoTaskId ?? null,
      updated_at: new Date(),
    }))
  )

  if (values.length === 0) return

  await getDb()
    .insertInto('short_drama_segments')
    .values(values)
    .onConflict((oc) => oc
      .columns(['project_id', 'episode_number', 'segment_id'])
      .doUpdateSet({
        order_index: (eb) => eb.ref('excluded.order_index'),
        title: (eb) => eb.ref('excluded.title'),
        prompt: (eb) => eb.ref('excluded.prompt'),
        mention_refs: (eb) => eb.ref('excluded.mention_refs'),
        duration_seconds: (eb) => eb.ref('excluded.duration_seconds'),
        status: (eb) => eb.ref('excluded.status'),
        video_url: (eb) => eb.ref('excluded.video_url'),
        video_batch_id: (eb) => eb.ref('excluded.video_batch_id'),
        video_task_id: (eb) => eb.ref('excluded.video_task_id'),
        updated_at: (eb) => eb.ref('excluded.updated_at'),
      }))
    .execute()
}

export async function readShortDramaProjectState(projectId: string): Promise<ShortDramaState> {
  const row = await getDb()
    .selectFrom('short_drama_projects')
    .select('state')
    .where('id', '=', projectId)
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  if (!row) {
    throw new Error('项目不存在')
  }

  const rawState = typeof row.state === 'string'
    ? JSON.parse(row.state)
    : row.state
  const state = normalizeShortDramaState(rawState)
  const segmentRows = await listShortDramaSegmentRows(projectId)
  return applyShortDramaSegmentRowsToState(state, segmentRows)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function acquireShortDramaProjectStateLock(
  redis: Redis,
  projectId: string,
  options: { waitMs?: number; retryIntervalMs?: number; ttlSeconds?: number } = {},
): Promise<RedisLockHandle | null> {
  const waitMs = options.waitMs ?? 5000
  const retryIntervalMs = options.retryIntervalMs ?? 100
  const ttlSeconds = options.ttlSeconds ?? 60
  const lockKey = `lock:short-drama:${projectId}:state`
  const deadline = Date.now() + waitMs

  do {
    const lock = await acquireRedisLock(redis, lockKey, { ttlSeconds })
    if (lock) return lock
    await sleep(retryIntervalMs)
  } while (Date.now() < deadline)

  return null
}

// ============================================================================
// Access Control
// ============================================================================

/**
 * 校验用户对 workspace 的访问权限
 * @param workspaceId - workspace ID
 * @param userId - 用户 ID
 * @param write - 是否需要写权限（viewer 角色不能写）
 * @returns workspace 信息和用户角色
 * @throws 如果 workspace 不存在、已删除或用户无权限
 */
export async function assertShortDramaWorkspaceAccess(
  workspaceId: string,
  userId: string,
  write = false
): Promise<{
  workspace: { id: string; team_id: string; is_deleted: boolean }
  role: 'admin' | 'editor' | 'viewer'
}> {
  const db = getDb()

  // 检查 workspace 是否存在且未删除
  const workspace = await db
    .selectFrom('workspaces')
    .select(['id', 'team_id', 'is_deleted'])
    .where('id', '=', workspaceId)
    .executeTakeFirst()

  if (!workspace) {
    throw new Error('工作空间不存在')
  }

  if (workspace.is_deleted) {
    throw new Error('工作空间已删除')
  }

  // 检查用户是否是 workspace 成员
  const member = await db
    .selectFrom('workspace_members')
    .select('role')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  if (!member) {
    throw new Error('无权限访问此工作空间')
  }

  // 如果需要写权限，viewer 角色不能写
  if (write && member.role === 'viewer') {
    throw new Error('当前角色无写入权限')
  }

  return {
    workspace,
    role: member.role,
  }
}

/**
 * 校验用户对短剧项目的访问权限
 * @param projectId - 项目 ID
 * @param userId - 用户 ID
 * @param write - 是否需要写权限（viewer 角色不能写）
 * @returns 项目信息、workspace 信息和用户角色
 * @throws 如果项目不存在、已删除或用户无权限
 */
export async function assertShortDramaProjectAccess(
  projectId: string,
  userId: string,
  write = false
): Promise<{
  project: {
    id: string
    workspace_id: string
    team_id: string
    user_id: string
    title: string
    state: ShortDramaState
    is_deleted: boolean
  }
  workspace: { id: string; team_id: string; is_deleted: boolean }
  role: 'admin' | 'editor' | 'viewer'
}> {
  const db = getDb()

  // 检查项目是否存在且未删除
  const projectRow = await db
    .selectFrom('short_drama_projects')
    .select([
      'id',
      'workspace_id',
      'team_id',
      'user_id',
      'title',
      'state',
      'is_deleted',
    ])
    .where('id', '=', projectId)
    .executeTakeFirst()

  if (!projectRow) {
    throw new Error('项目不存在')
  }

  if (projectRow.is_deleted) {
    throw new Error('项目已删除')
  }

  // 校验 workspace 访问权限
  const { workspace, role } = await assertShortDramaWorkspaceAccess(
    projectRow.workspace_id,
    userId,
    write
  )

  // 解析并规范化 state
  let state: ShortDramaState
  try {
    const rawState = typeof projectRow.state === 'string'
      ? JSON.parse(projectRow.state)
      : projectRow.state
    state = normalizeShortDramaState(rawState)
  } catch (error) {
    throw new Error('项目状态数据损坏')
  }

  return {
    project: {
      id: projectRow.id,
      workspace_id: projectRow.workspace_id,
      team_id: projectRow.team_id,
      user_id: projectRow.user_id,
      title: projectRow.title,
      state,
      is_deleted: projectRow.is_deleted,
    },
    workspace,
    role,
  }
}
