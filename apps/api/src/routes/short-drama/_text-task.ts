import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import type { ShortDramaState } from '@aigc/types'

/**
 * 短剧 SSE 文本生成的任务记录与僵死自愈。
 *
 * 背景：5 个文本生成流程（剧本摘要/分集剧本/分集概述/素材描述/片段脚本）由 API 进程内
 * 同步执行（SSE），任务是否在跑只存在 state JSONB 的 status 字段。一旦 API 进程在生成中途
 * 重启，该字段永久停在 'generating' 且无自愈，前端永久卡在"生成中"。
 *
 * 方案：给每个文本生成流程在 task_batches 表写一条 module='text' 记录作为进程外状态来源，
 * 生成中定期心跳刷新 updated_at；/sync 轮询与进程启动扫描按"updated_at 超 10 分钟无刷新"
 * 判定僵死并重置对应 state 字段（纯函数 resetShortDramaTextTaskState）。
 */

/** 5 个 SSE 文本生成流程的标识，存入 task_batches.params.textType */
export type ShortDramaTextType =
  | 'script-summary'
  | 'episode-outlines'
  | 'episode-summaries'
  | 'asset-prompts'
  | 'episode-segments'

/** 心跳间隔：生成中每 15s 刷新一次 task_batches.updated_at */
export const TEXT_TASK_HEARTBEAT_INTERVAL_MS = 15_000
/** 僵死阈值：status=processing 且 updated_at 超 10 分钟无刷新即判僵死 */
export const TEXT_TASK_STUCK_THRESHOLD_MS = 10 * 60 * 1000

export interface ShortDramaTextTaskContext {
  projectId: string
  textType: ShortDramaTextType
  /** 仅 episode-segments 需要：集数（1-based） */
  episodeNumber?: number
  userId: string
  teamId: string
  workspaceId: string
  estimatedCredits?: number
}

/** 生成开始时创建 text 任务记录（status=processing），返回 batchId 供心跳/收尾使用 */
export async function createShortDramaTextTaskBatch(ctx: ShortDramaTextTaskContext): Promise<string> {
  const batch = await getDb()
    .insertInto('task_batches')
    .values({
      user_id: ctx.userId,
      team_id: ctx.teamId,
      workspace_id: ctx.workspaceId,
      idempotency_key: randomUUID(),
      source: 'studio',
      module: 'text',
      provider: 'qwen',
      model: 'qwen-max',
      prompt: '',
      params: JSON.stringify({ textType: ctx.textType, episodeNumber: ctx.episodeNumber ?? null }),
      quantity: 1,
      status: 'processing',
      estimated_credits: ctx.estimatedCredits ?? 0,
      short_drama_project_id: ctx.projectId,
      short_drama_episode_id: ctx.episodeNumber != null ? String(ctx.episodeNumber) : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return batch.id
}

/** 心跳：刷新 updated_at（表上有 BEFORE UPDATE trigger 也会刷，显式设确保） */
export async function heartbeatShortDramaTextTask(batchId: string): Promise<void> {
  await getDb()
    .updateTable('task_batches')
    .set({ updated_at: new Date() })
    .where('id', '=', batchId)
    .execute()
}

/** 成功：标记 completed 并记录实际积分 */
export async function completeShortDramaTextTask(batchId: string, actualCredits?: number): Promise<void> {
  await getDb()
    .updateTable('task_batches')
    .set({
      status: 'completed',
      completed_count: 1,
      ...(actualCredits != null ? { actual_credits: actualCredits } : {}),
    })
    .where('id', '=', batchId)
    .execute()
}

/** 失败：标记 failed */
export async function failShortDramaTextTask(batchId: string): Promise<void> {
  await getDb()
    .updateTable('task_batches')
    .set({ status: 'failed', failed_count: 1 })
    .where('id', '=', batchId)
    .execute()
}

// ============================================================================
// 僵死检测与 state 重置（纯函数，便于单测）
// ============================================================================

/** 判断某 text batch 是否僵死（processing 且 updated_at 超阈值无刷新） */
export function isShortDramaTextTaskStuck(
  batch: { status: string; updated_at: Date | string },
  now: Date = new Date(),
): boolean {
  if (batch.status !== 'processing') return false
  return now.getTime() - new Date(batch.updated_at).getTime() > TEXT_TASK_STUCK_THRESHOLD_MS
}

/**
 * 根据 textType 重置 state 对应字段。先检查"已有结果"，避免覆盖已成功的结果。
 * @returns 是否实际重置（false = 已有结果或无效，调用方据此决定是否标记 batch）
 */
export function resetShortDramaTextTaskState(
  state: ShortDramaState,
  textType: ShortDramaTextType,
  episodeNumber?: number,
): boolean {
  switch (textType) {
    case 'script-summary':
      if (state.script.refinedPrompt) return false
      state.script.status = 'idle'
      return true
    case 'episode-outlines':
      if (state.script.outlinesStatus === 'completed') return false
      state.script.status = 'idle'
      state.script.outlinesStatus = 'idle'
      state.script.outlinesErrorMessage = null
      return true
    case 'episode-summaries':
      if (state.script.episodeSummaries.length >= state.settings.episodeCount) return false
      state.script.episodeSummaryStatus = 'idle'
      state.script.episodeSummaryErrorMessage = null
      return true
    case 'asset-prompts':
      if (state.assets.status === 'completed') return false
      state.assets.status = 'idle'
      return true
    case 'episode-segments': {
      if (episodeNumber == null) return false
      const episode = state.episodes.items.find((ep) => ep.episodeNumber === episodeNumber)
      if (!episode) return false
      // 已有片段脚本且脚本非失败 → 保护，不重置
      if (episode.segments.length > 0 && episode.segmentsStatus !== 'failed') return false
      episode.segmentsStatus = 'idle'
      episode.errorMessage = null
      // 顶层 episodes.status 归视频流程维护（applyShortDramaSegmentRowsToState / post-sync-batches），
      // 脚本自愈不碰它，避免脚本重置误改视频维度状态。
      return true
    }
  }
  return false
}
