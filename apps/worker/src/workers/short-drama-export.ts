import { Worker } from 'bullmq'
import pino_ from 'pino'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import type { ShortDramaExportEpisodeJobData } from '@aigc/types'
import { normalizeShortDramaState } from '@aigc/types'
import { getRedis } from '../lib/redis.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateShortDramaExportSegments, buildConcatManifest } from './short-drama-export-utils.js'
import { getBucket, getPublicUrl, getStorageRuntimeInfo, getTos } from '../lib/storage.js'

export { validateShortDramaExportSegments, buildConcatManifest } from './short-drama-export-utils.js'

const execFileAsync = promisify(execFile)
const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const INTERNAL_STORAGE_BASE = process.env.INTERNAL_STORAGE_BASE ?? 'http://localhost:9000'

// ============================================================================
// Internal Helpers
// ============================================================================

function resolveStorageUrl(url: string): string {
  if (url.startsWith('/')) {
    return `${INTERNAL_STORAGE_BASE}${url}`
  }
  return url
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const resolvedUrl = resolveStorageUrl(url)
  const response = await fetch(resolvedUrl)
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${resolvedUrl}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(destPath, buffer)
}

async function uploadToStorage(filePath: string, storageKey: string): Promise<string> {
  const body = await readFile(filePath)
  await getTos().putObject({
    bucket: getBucket(),
    key: storageKey,
    body,
    contentType: 'video/mp4',
  })

  return `${getPublicUrl()}/${storageKey}`
}

// ============================================================================
// Worker
// ============================================================================

export const shortDramaExportWorker = new Worker<ShortDramaExportEpisodeJobData>(
  'short-drama-export-queue',
  async (job) => {
    const { projectId, episodeId, exportId, userId, teamId, creditAccountId, estimatedCredits } = job.data
    const episodeNumber = parseInt(episodeId, 10)
    let tmpDir: string | null = null

    try {
      const db = getDb()

      // 加载项目 state
      const projectRow = await db
        .selectFrom('short_drama_projects')
        .select(['id', 'state'])
        .where('id', '=', projectId)
        .executeTakeFirst()

      if (!projectRow) throw new Error(`项目 ${projectId} 不存在`)

      const rawState = typeof projectRow.state === 'string'
        ? JSON.parse(projectRow.state)
        : projectRow.state
      const state = normalizeShortDramaState(rawState)

      // 查找 episode
      const episode = state.episodes.items.find(ep => ep.episodeNumber === episodeNumber)
      if (!episode) throw new Error(`第 ${episodeNumber} 集不存在`)

      // 校验 segments
      validateShortDramaExportSegments(
        episode.segments.map(s => ({ id: s.id, videoUrl: s.videoUrl ?? undefined }))
      )

      // 更新导出状态为 exporting
      const batchExport = state.exports.batches.find(b => b.id === exportId)
      if (batchExport) {
        batchExport.status = 'exporting'
        const epExport = batchExport.exports.find(e => e.episodeNumber === episodeNumber)
        if (epExport) epExport.status = 'exporting'
        batchExport.updatedAt = new Date().toISOString()
      }

      await db.updateTable('short_drama_projects')
        .set({ state: JSON.stringify(state), updated_at: new Date() })
        .where('id', '=', projectId)
        .execute()

      // 创建临时目录
      tmpDir = await mkdtemp(join(tmpdir(), 'sd-export-'))

      // 下载所有 segment 视频
      const localPaths: string[] = []
      for (let i = 0; i < episode.segments.length; i++) {
        const segment = episode.segments[i]
        const ext = 'mp4'
        const localPath = join(tmpDir, `segment_${i}.${ext}`)
        await downloadFile(segment.videoUrl!, localPath)
        localPaths.push(localPath)
      }

      // 生成 concat manifest
      const manifestContent = buildConcatManifest(localPaths)
      const manifestPath = join(tmpDir, 'manifest.txt')
      await writeFile(manifestPath, manifestContent)

      const outputPath = join(tmpDir, 'output.mp4')

      // 尝试 concat demuxer（快速拼接）
      let concatSuccess = false
      try {
        await execFileAsync('ffmpeg', [
          '-f', 'concat', '-safe', '0',
          '-i', manifestPath,
          '-c', 'copy',
          '-y', outputPath,
        ], { timeout: 300_000 })
        concatSuccess = true
      } catch (err) {
        logger.warn({ err, episodeNumber }, 'Fast concat failed, falling back to transcode')
      }

      // 如果快速拼接失败，转码后再拼接
      if (!concatSuccess) {
        const transcodedPaths: string[] = []
        for (let i = 0; i < localPaths.length; i++) {
          const transcodedPath = join(tmpDir, `transcoded_${i}.mp4`)
          await execFileAsync('ffmpeg', [
            '-i', localPaths[i],
            '-c:v', 'libx264', '-preset', 'fast',
            '-c:a', 'aac', '-ar', '44100',
            '-r', '30',
            '-y', transcodedPath,
          ], { timeout: 300_000 })
          transcodedPaths.push(transcodedPath)
        }

        const transManifest = buildConcatManifest(transcodedPaths)
        const transManifestPath = join(tmpDir, 'manifest_trans.txt')
        await writeFile(transManifestPath, transManifest)

        await execFileAsync('ffmpeg', [
          '-f', 'concat', '-safe', '0',
          '-i', transManifestPath,
          '-c', 'copy',
          '-y', outputPath,
        ], { timeout: 300_000 })
      }

      // 上传到存储
      const storageKey = `exports/short-drama/${projectId}/ep${episodeNumber}_${randomUUID()}.mp4`
      const outputUrl = await uploadToStorage(outputPath, storageKey)

      // 更新 state：标记导出完成
      const freshRow = await db
        .selectFrom('short_drama_projects')
        .select('state')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow()

      const freshState = normalizeShortDramaState(
        typeof freshRow.state === 'string' ? JSON.parse(freshRow.state) : freshRow.state
      )

      const freshBatch = freshState.exports.batches.find(b => b.id === exportId)
      if (freshBatch) {
        const epExport = freshBatch.exports.find(e => e.episodeNumber === episodeNumber)
        if (epExport) {
          epExport.status = 'completed'
          epExport.videoUrl = outputUrl
        }
        // 检查 batch 是否全部完成
        const allDone = freshBatch.exports.every(
          e => e.status === 'completed' || e.status === 'failed'
        )
        if (allDone) {
          const allCompleted = freshBatch.exports.every(e => e.status === 'completed')
          freshBatch.status = allCompleted ? 'completed' : 'failed'
        }
        freshBatch.updatedAt = new Date().toISOString()
      }

      // 保存 state 并确认积分
      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('short_drama_projects')
          .set({ state: JSON.stringify(freshState), updated_at: new Date() })
          .where('id', '=', projectId)
          .execute()

        // 确认扣费：解冻 + 从余额扣除
        await trx.updateTable('credit_accounts')
          .set({
            frozen_credits: sql`frozen_credits - ${estimatedCredits}`,
            total_spent: sql`total_spent + ${estimatedCredits}`,
            balance: sql`balance - ${estimatedCredits}`,
          })
          .where('id', '=', creditAccountId)
          .execute()

        await trx.insertInto('credits_ledger').values({
          credit_account_id: creditAccountId,
          user_id: userId,
          amount: -estimatedCredits,
          type: 'confirm',
          description: `Short drama episode ${episodeNumber} export`,
        }).execute()
      })

      logger.info({ projectId, episodeNumber, exportId, outputUrl }, 'Episode export completed')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error({ err, projectId, episodeNumber, exportId, storage: getStorageRuntimeInfo() }, 'Episode export failed')

      // 标记导出失败
      try {
        const db = getDb()
        const row = await db
          .selectFrom('short_drama_projects')
          .select('state')
          .where('id', '=', projectId)
          .executeTakeFirst()

        if (row) {
          const failState = normalizeShortDramaState(
            typeof row.state === 'string' ? JSON.parse(row.state) : row.state
          )
          const batch = failState.exports.batches.find(b => b.id === exportId)
          if (batch) {
            const epExport = batch.exports.find(e => e.episodeNumber === episodeNumber)
            if (epExport) {
              epExport.status = 'failed'
              epExport.errorMessage = errorMessage.slice(0, 500)
            }
            const allDone = batch.exports.every(
              e => e.status === 'completed' || e.status === 'failed'
            )
            if (allDone) batch.status = 'failed'
            batch.updatedAt = new Date().toISOString()
          }

          await db.updateTable('short_drama_projects')
            .set({ state: JSON.stringify(failState), updated_at: new Date() })
            .where('id', '=', projectId)
            .execute()
        }
      } catch (stateErr) {
        logger.error({ stateErr }, 'Failed to update export failure state')
      }

      // 退款（直接 DB 操作，与 failPipeline 模式一致）
      try {
        const db = getDb()
        await db.transaction().execute(async (trx: any) => {
          await trx.updateTable('credit_accounts')
            .set({ frozen_credits: sql`GREATEST(frozen_credits - ${estimatedCredits}, 0)` })
            .where('id', '=', creditAccountId)
            .execute()

          await trx.updateTable('team_members')
            .set({ credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)` })
            .where('team_id', '=', teamId)
            .where('user_id', '=', userId)
            .execute()

          await trx.insertInto('credits_ledger').values({
            credit_account_id: creditAccountId,
            user_id: userId,
            amount: estimatedCredits,
            type: 'refund',
            description: `Short drama export failed: ${errorMessage.slice(0, 200)}`,
          }).execute()
        })
      } catch (refundErr) {
        logger.error({ refundErr }, 'CRITICAL: Failed to refund export credits')
      }
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  },
  {
    connection: getRedis(),
    concurrency: 2,
  }
)

shortDramaExportWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Short drama export job failed')
})

shortDramaExportWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Short drama export job completed')
})
