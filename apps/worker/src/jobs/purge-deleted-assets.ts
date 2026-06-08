import { getDb } from '@aigc/db'
import pino_ from 'pino'
import { getBucket, getPublicUrl, getTos } from '../lib/storage.js'

const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// 软删除 assets 保留天数（与 purge-deleted-projects 保持一致）
const ASSET_RETENTION_DAYS = 7
// 每批最多处理的记录数
const BATCH_LIMIT = 200

/**
 * 从存储 URL 提取 TOS object key。
 * 若 URL 不属于本存储则返回 null。
 */
function extractStorageKey(storageUrl: string | null | undefined): string | null {
  if (!storageUrl) return null
  const publicUrl = getPublicUrl()
  if (!publicUrl || !storageUrl.startsWith(publicUrl)) return null
  const key = storageUrl.slice(publicUrl.length + 1).split(/[?#]/)[0]
  return key || null
}

/**
 * 批量删除存储文件，错误隔离——单个文件删除失败不影响其他文件。
 * 返回成功删除数和失败数。
 */
async function deleteStoredUrls(
  urls: Array<string | null | undefined>,
): Promise<{ deleted: number; failed: number }> {
  const keys = Array.from(
    new Set(
      urls.flatMap((url) => {
        const key = extractStorageKey(url)
        return key ? [key] : []
      }),
    ),
  )

  if (keys.length === 0) return { deleted: 0, failed: 0 }

  const tos = getTos()
  const bucket = getBucket()

  let deleted = 0
  let failed = 0
  for (const key of keys) {
    try {
      await tos.deleteObject({ bucket, key })
      deleted += 1
    } catch (err) {
      // 文件可能已被其他流程删除，或 TOS 暂时不可用
      logger.warn({ err, key }, '删除存储文件失败，跳过')
      failed += 1
    }
  }
  return { deleted, failed }
}

/**
 * 清理软删除超过保留期的 assets，以及 transfer 失败超过保留期的孤立 assets。
 * 每次执行最多处理 BATCH_LIMIT 条。
 */
export async function runPurgeDeletedAssets(): Promise<void> {
  const db = getDb()
  const cutoff = new Date(Date.now() - ASSET_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  // ── 第一部分：清理 is_deleted=true 且 deleted_at 超过保留期的 assets ──
  const softDeletedAssets = await db
    .selectFrom('assets')
    .select(['id', 'storage_url', 'original_url', 'thumbnail_url'])
    .where('is_deleted', '=', true)
    .where('deleted_at', '<', cutoff as any)
    .limit(BATCH_LIMIT)
    .execute()

  let purgedSoftDeleted = 0
  let softDeletedFileStats = { deleted: 0, failed: 0 }

  for (const asset of softDeletedAssets) {
    try {
      const stats = await deleteStoredUrls([
        asset.storage_url,
        asset.original_url,
        asset.thumbnail_url,
      ])
      softDeletedFileStats.deleted += stats.deleted
      softDeletedFileStats.failed += stats.failed

      // 文件删除后，从 DB 硬删除记录
      await db.deleteFrom('assets').where('id', '=', asset.id).execute()
      purgedSoftDeleted += 1
    } catch (err) {
      logger.error({ err, assetId: asset.id }, '清理软删除 asset 失败，跳过')
    }
  }

  // ── 第二部分：清理 transfer_status='failed' 且创建超过保留期的 assets ──
  // 这些可能是 transfer 过程中文件已上传但后续步骤失败的孤立数据
  const failedTransferAssets = await db
    .selectFrom('assets')
    .select(['id', 'storage_url', 'original_url', 'thumbnail_url'])
    .where('transfer_status', '=', 'failed')
    .where('created_at', '<', cutoff as any)
    .where('is_deleted', '=', false)
    .limit(BATCH_LIMIT)
    .execute()

  let purgedFailedTransfers = 0
  let failedTransferFileStats = { deleted: 0, failed: 0 }

  for (const asset of failedTransferAssets) {
    try {
      const stats = await deleteStoredUrls([
        asset.storage_url,
        asset.original_url,
        asset.thumbnail_url,
      ])
      failedTransferFileStats.deleted += stats.deleted
      failedTransferFileStats.failed += stats.failed

      await db.deleteFrom('assets').where('id', '=', asset.id).execute()
      purgedFailedTransfers += 1
    } catch (err) {
      logger.error({ err, assetId: asset.id }, '清理 failed transfer asset 失败，跳过')
    }
  }

  // 汇总日志（仅在有清理动作或失败时输出）
  const totalPurged = purgedSoftDeleted + purgedFailedTransfers
  const totalFilesDeleted = softDeletedFileStats.deleted + failedTransferFileStats.deleted
  const totalFilesFailed = softDeletedFileStats.failed + failedTransferFileStats.failed

  if (totalPurged > 0 || totalFilesFailed > 0) {
    logger.info(
      {
        purgedSoftDeleted,
        purgedFailedTransfers,
        totalPurged,
        totalFilesDeleted,
        totalFilesFailed,
      },
      'Purged deleted/orphan assets',
    )
  }
}
